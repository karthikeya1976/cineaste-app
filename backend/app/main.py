import os
import tempfile
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from jose import jwt, JWTError
from app import db, storage
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from app.tasks import process_video

app = FastAPI(title="Video Moderation API")

# Ensure DB tables exist on every startup — safe because CREATE TABLE IF NOT EXISTS is idempotent
db._ensure_schema()

# Canonical department list — duplicated from frontend/app/profile/page.tsx's
# DEPARTMENTS constant (per the plan's Open Questions: no shared source exists
# across the frontend/backend boundary today; both lists are short and
# human-maintained). Used to validate POST /auth/upgrade and to build the
# built-in Houses list on GET /houses.
#
# Deliberately scoped to craftsmanship/creativity roles only — logistics and
# support departments (Locations, Continuity, Transportation, Catering &
# Craft Services) were removed and replaced with genuine, distinct craft
# roles (Choreography, Foley Artistry, Storyboarding / Previsualization,
# Prosthetics & Creature Design) — see the frontend's copy for the full
# rationale on why each replacement is distinct from existing entries.
#
# MUST be kept byte-for-byte identical (same strings, same order) to the
# frontend's copy — mismatched entries here would either reject a valid
# selection from the frontend's dropdown (400 on upgrade) or leave a real
# frontend option unable to ever get accepted server-side.
DEPARTMENTS = [
    "Cinematography", "Directing", "Screenwriting", "Editing",
    "Sound Design", "Visual Effects", "Production Design", "Acting",
    "Producing", "Camera", "Grip & Electric", "Art Department",
    "Set Decoration", "Costume Design", "Hair & Makeup", "Sound Recording",
    "Music", "Special Effects", "Stunts", "Casting",
    "Production Management", "Script Supervision", "Choreography",
    "Foley Artistry", "Storyboarding / Previsualization",
    "Prosthetics & Creature Design", "Colorist / Post-Production",
    "Animation", "Other",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://distributed-video-moderation.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Auth setup ---
pwd_context = CryptContext(schemes=["bcrypt"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-prod")

# --- Request models ---
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class UpgradeRequest(BaseModel):
    department: str

# --- Auth endpoints ---
@app.post("/auth/register")
def register(req: RegisterRequest) -> dict:
    if db.get_user_by_email(req.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    password_hash = pwd_context.hash(req.password)
    user = db.create_user(req.name, req.email, password_hash)
    return {"message": "Account created", "user": user}


@app.post("/auth/login")
def login(req: LoginRequest) -> dict:
    user = db.get_user_by_email(req.email)
    if not user or not pwd_context.verify(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = jwt.encode({"sub": str(user["id"])}, JWT_SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}


@app.post("/auth/upgrade")
def upgrade(req: UpgradeRequest, token: str = Depends(oauth2_scheme)) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if req.department not in DEPARTMENTS:
        raise HTTPException(status_code=400, detail="Invalid department")
    user = db.upgrade_to_creator(user_id, req.department)
    return {"message": "Account upgraded to creator", "user": user}





@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/debug/feed")
def debug_feed() -> dict:
    """Temporary debug endpoint — returns the actual exception from get_feed()."""
    import traceback
    try:
        data = db.get_feed(5, None)
        return {"ok": True, "enrouted": len(data["enrouted"]), "recommended": len(data["recommended"])}
    except Exception as e:
        return {"ok": False, "error": str(e), "trace": traceback.format_exc()}


@app.get("/debug/search")
def debug_search() -> dict:
    """Temporary debug endpoint — returns the actual exception from search()."""
    import traceback
    try:
        data = db.search("test")
        return {"ok": True, "creators": len(data["creators"]), "videos": len(data["videos"])}
    except Exception as e:
        return {"ok": False, "error": str(e), "trace": traceback.format_exc()}


def _require_creator(token: str = Depends(oauth2_scheme)) -> str:
    """Decode JWT and verify account_type == creator. Returns user_id."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user["account_type"] != "creator":
        raise HTTPException(status_code=403, detail="Creator account required to upload")
    return user_id


@app.post("/videos")
async def upload_video(file: UploadFile, user_id: str = Depends(_require_creator)) -> dict:
    task_id = str(uuid.uuid4())
    object_name = f"{task_id}.mp4"

    # Write upload to a temp file first, then upload to S3
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = os.path.join(tmp_dir, object_name)
        with open(tmp_path, "wb") as f:
            f.write(await file.read())
        file_path = storage.save_video(object_name, tmp_path)

    db.create_job(task_id, file.filename or object_name, file_path, user_id=user_id)
    process_video.delay(task_id)

    # Flow-graph response: instant acknowledgment with tracking ID
    return {"status": "processing", "task_id": task_id}


def _enrich(jobs: list) -> list:
    """Shared enrichment transform for any list of raw video rows (dicts with
    a '_id' key from db.py) headed to the frontend: renames '_id' -> 'job_id'
    (the frontend Job type has no _id field), 'pillar_results' -> 'pillars',
    and converts file_path (an s3://... URI) into a real playable video_url
    via a live presigned-URL call. None of this is a DB column — every route
    returning Job-shaped rows (GET /feed, GET /houses/{id}/feed,
    GET /houses/department/{name}/feed) must run its rows through this exact
    helper, not a re-implementation, or cards silently render with no
    job_id/video_url ("No video available")."""
    for j in jobs:
        j["job_id"] = j.pop("_id")
        if "pillar_results" in j:
            j["pillars"] = j.pop("pillar_results")
        file_path = j.get("file_path", "")
        if file_path.startswith("s3://"):
            object_name = file_path.split("/", 3)[-1]
            try:
                j["video_url"] = storage.get_presigned_url(object_name)
            except Exception:
                j["video_url"] = None
        else:
            j["video_url"] = None
    return jobs


@app.get("/feed")
def get_feed(limit: int = 50, token: Optional[str] = None) -> dict:
    """Smart feed — returns {enrouted, recommended} buckets.
    Pass ?token=<jwt> to personalise with enrouted content.
    Both buckets contain approved/flagged videos with presigned S3 URLs."""
    viewer_id = None
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            viewer_id = payload["sub"]
        except JWTError:
            pass

    data = db.get_feed(limit, viewer_id)

    return {
        "enrouted":    _enrich(data["enrouted"]),
        "recommended": _enrich(data["recommended"]),
    }


@app.get("/videos")
def list_videos(limit: int = 50) -> list:
    jobs = db.list_jobs(limit)
    for j in jobs:
        j["job_id"] = j.pop("_id")
        if "pillar_results" in j:
            j["pillars"] = j.pop("pillar_results")
    return jobs


@app.get("/videos/{job_id}/status")
def get_status(job_id: str) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")

    job["job_id"] = job.pop("_id")
    if "pillar_results" in job:
        job["pillars"] = job.pop("pillar_results")
    return job


# ── Credits ───────────────────────────────────────────────────────────────────

@app.post("/videos/{job_id}/credit")
def give_credit(job_id: str) -> dict:
    """Add 1 credit to the creator of a video."""
    new_total = db.add_credit(job_id)
    return {"credits": new_total}


# ── Follow / Unfollow ─────────────────────────────────────────────────────────

def _require_auth(token: str = Depends(oauth2_scheme)) -> str:
    """Decode JWT, return user_id. Any logged-in user can use this."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.post("/creators/{creator_id}/follow")
def follow(creator_id: str, viewer_id: str = Depends(_require_auth)) -> dict:
    db.follow_user(viewer_id, creator_id)
    return {"following": True}


@app.delete("/creators/{creator_id}/follow")
def unfollow(creator_id: str, viewer_id: str = Depends(_require_auth)) -> dict:
    db.unfollow_user(viewer_id, creator_id)
    return {"following": False}


@app.get("/creators/{creator_id}")
def get_creator(creator_id: str, token: Optional[str] = None) -> dict:
    viewer_id = None
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            viewer_id = payload["sub"]
        except JWTError:
            pass
    profile = db.get_creator_profile(creator_id, viewer_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Creator not found")
    return profile


# ── Search ────────────────────────────────────────────────────────────────────

@app.get("/search")
def search(q: str = "") -> dict:
    if not q.strip():
        return {"creators": [], "videos": []}
    return db.search(q.strip())


class SearchUsersByIdsRequest(BaseModel):
    ids: list[str]


@app.get("/search-users")
def search_users(q: str = "", user_id: str = Depends(_require_auth)) -> list:
    if not q.strip():
        return []
    return db.search_users(q.strip())


@app.post("/search-users/by-ids")
def search_users_by_ids(req: SearchUsersByIdsRequest, user_id: str = Depends(_require_auth)) -> list:
    if not req.ids:
        return []
    if len(req.ids) > 50:
        raise HTTPException(status_code=400, detail="Cannot look up more than 50 IDs per call")
    return db.search_users_by_ids(req.ids)


# ── Comments ──────────────────────────────────────────────────────────────────

class CommentRequest(BaseModel):
    body: str


@app.get("/videos/{job_id}/comments")
def list_comments(job_id: str) -> list:
    return db.get_comments(job_id)


@app.post("/videos/{job_id}/comments")
def post_comment(job_id: str, req: CommentRequest, token: Optional[str] = None) -> dict:
    user_id = None
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            user_id = payload["sub"]
        except JWTError:
            pass
    if not req.body.strip():
        raise HTTPException(status_code=400, detail="Comment body cannot be empty")
    return db.add_comment(job_id, req.body.strip(), user_id)


# ── Houses ────────────────────────────────────────────────────────────────────
# Built-in Houses (one per department) have no table — derived from
# users.department at query time (KTD1). Custom Houses are owned entities
# curated by a creator via house_creator_members / house_video_members.

class CreateHouseRequest(BaseModel):
    name: str
    description: Optional[str] = None


def _require_house_owner(house_id: str, token: str = Depends(oauth2_scheme)) -> str:
    """First resource-ownership check in this codebase (KTD5). Decodes the
    token the same way _require_auth does, fetches the house, raises 404 if
    it doesn't exist, raises 403 if the caller isn't the owner. Returns the
    viewer_id so callers can reuse it without re-decoding."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        viewer_id = payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    house = db.get_house(house_id)
    if not house:
        raise HTTPException(status_code=404, detail="House not found")
    if house["owner_id"] != viewer_id:
        raise HTTPException(status_code=403, detail="Only the House owner can do this")
    return viewer_id


@app.get("/houses")
def list_houses() -> dict:
    """Returns {builtIn: [{name}], custom: [House]}. builtIn is the hardcoded
    DEPARTMENTS list (no DB query); custom is every real houses row with
    creator_count/video_count for the listing card."""
    return {
        "builtIn": [{"name": d} for d in DEPARTMENTS],
        "custom": db.list_custom_houses(),
    }


@app.post("/houses")
def create_house(req: CreateHouseRequest, owner_id: str = Depends(_require_creator)) -> dict:
    """Only creators can make a House (matches the confirmed requirement),
    reusing the existing role check exactly."""
    house_id = str(uuid.uuid4())
    return db.create_house(house_id, owner_id, req.name, req.description)


@app.delete("/houses/{house_id}")
def remove_house(house_id: str, _owner_id: str = Depends(_require_house_owner)) -> dict:
    db.delete_house(house_id)
    return {"deleted": True}


@app.get("/houses/department/{name}/feed")
def get_department_house_feed(name: str) -> dict:
    """Built-in House feed — every approved/flagged video from creators whose
    department exactly matches `name`. Flat list (KTD4), run through the
    shared _enrich() transform (job_id/pillars/video_url), not a re-implementation."""
    rows = db.get_department_house_feed(name)
    return {"videos": _enrich(rows)}


@app.get("/houses/{house_id}/feed")
def get_house_feed(house_id: str) -> dict:
    """Custom House feed — unioned creator+video membership, flat list (KTD4),
    run through the shared _enrich() transform. No ownership check: any
    House's feed is publicly browsable (KTD6)."""
    rows = db.get_house_feed(house_id)
    return {"videos": _enrich(rows)}


@app.post("/houses/{house_id}/members/creators/{creator_id}")
def add_house_creator(house_id: str, creator_id: str, _owner_id: str = Depends(_require_house_owner)) -> dict:
    db.add_house_creator_member(house_id, creator_id)
    return {"added": True}


@app.delete("/houses/{house_id}/members/creators/{creator_id}")
def remove_house_creator(house_id: str, creator_id: str, _owner_id: str = Depends(_require_house_owner)) -> dict:
    db.remove_house_creator_member(house_id, creator_id)
    return {"added": False}


@app.post("/houses/{house_id}/members/videos/{video_id}")
def add_house_video(house_id: str, video_id: str, _owner_id: str = Depends(_require_house_owner)) -> dict:
    """No ownership check on the video's creator (KTD2a, deliberate): a House
    owner can curate any existing public video into their House, regardless
    of who created it — matching follow_user()'s no-consent-required posture."""
    db.add_house_video_member(house_id, video_id)
    return {"added": True}


@app.delete("/houses/{house_id}/members/videos/{video_id}")
def remove_house_video(house_id: str, video_id: str, _owner_id: str = Depends(_require_house_owner)) -> dict:
    db.remove_house_video_member(house_id, video_id)
    return {"added": False}
