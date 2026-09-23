import json
from datetime import datetime, timezone
from typing import Any, Optional

import psycopg2
import psycopg2.extras

from app import config

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS videos (
    id             TEXT PRIMARY KEY,
    filename       TEXT NOT NULL,
    file_path      TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    overall_status TEXT,
    pillar_results JSONB,
    reasons        JSONB,
    size_bytes     INTEGER,
    user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_CREATE_USERS_TABLE = """
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    account_type  TEXT NOT NULL DEFAULT 'viewer',
    department    TEXT,
    credits       INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_CREATE_FOLLOWS_TABLE = """
CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);
"""

_CREATE_COMMENTS_TABLE = """
CREATE TABLE IF NOT EXISTS comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""

_CREATE_COMMENTS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id)
"""

_CREATE_HOUSES_TABLE = """
CREATE TABLE IF NOT EXISTS houses (
    id          TEXT PRIMARY KEY,
    owner_id    UUID REFERENCES users(id),
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_CREATE_HOUSE_CREATOR_MEMBERS_TABLE = """
CREATE TABLE IF NOT EXISTS house_creator_members (
    house_id   TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (house_id, creator_id)
);
"""

_CREATE_HOUSE_VIDEO_MEMBERS_TABLE = """
CREATE TABLE IF NOT EXISTS house_video_members (
    house_id   TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
    video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (house_id, video_id)
);
"""



def _connect():
    conn = psycopg2.connect(config.POSTGRES_URL)
    conn.autocommit = True
    return conn


def _ensure_schema() -> None:
    with _connect() as conn:
        with conn.cursor() as cur:
            # Core tables (order matters: users before videos before follows/comments)
            cur.execute(_CREATE_USERS_TABLE)
            cur.execute(_CREATE_TABLE)
            cur.execute(_CREATE_FOLLOWS_TABLE)
            cur.execute(_CREATE_COMMENTS_TABLE)
            cur.execute(_CREATE_COMMENTS_INDEX)
            cur.execute(_CREATE_HOUSES_TABLE)
            cur.execute(_CREATE_HOUSE_CREATOR_MEMBERS_TABLE)
            cur.execute(_CREATE_HOUSE_VIDEO_MEMBERS_TABLE)
            # Column migrations — safe to re-run because of IF NOT EXISTS
            cur.execute("ALTER TABLE videos ADD COLUMN IF NOT EXISTS user_id TEXT")
            cur.execute("ALTER TABLE videos ADD COLUMN IF NOT EXISTS file_hash TEXT")
            cur.execute("ALTER TABLE users  ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE users  ADD COLUMN IF NOT EXISTS department TEXT")



def create_job(job_id: str, filename: str, file_path: Optional[str] = None, user_id: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc)
    sql = """
        INSERT INTO videos (id, filename, file_path, status, user_id, created_at, updated_at)
        VALUES (%s, %s, %s, 'pending', %s, %s, %s)
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (job_id, filename, file_path, user_id, now, now))


def update_job(job_id: str, fields: dict[str, Any]) -> None:
    fields = dict(fields)
    fields["updated_at"] = datetime.now(timezone.utc)

    # Serialize list/dict values to JSON strings for JSONB columns
    jsonb_cols = {"pillar_results", "reasons"}
    set_parts = []
    values = []
    for col, val in fields.items():
        set_parts.append(f"{col} = %s")
        if col in jsonb_cols and val is not None:
            values.append(json.dumps(val))
        else:
            values.append(val)
    values.append(job_id)

    sql = f"UPDATE videos SET {', '.join(set_parts)} WHERE id = %s"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, values)


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    sql = "SELECT * FROM videos WHERE id = %s"
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (job_id,))
            row = cur.fetchone()
    if row is None:
        return None
    d = dict(row)
    # Remap 'id' → '_id' so existing main.py callers (j["job_id"] = j.pop("_id")) work unchanged
    d["_id"] = d.pop("id")
    return d


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    sql = "SELECT * FROM videos ORDER BY created_at DESC LIMIT %s"
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (limit,))
            rows = cur.fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["_id"] = d.pop("id")
        result.append(d)
    return result


def get_feed(limit: int = 50, viewer_id: Optional[str] = None) -> dict[str, Any]:
    """Return the smart feed split into two buckets:
    - 'enrouted': approved videos from creators the viewer follows (newest first)
    - 'recommended': remaining approved videos ranked by creator credits + recency

    If viewer_id is None (logged-out), only the recommended bucket is populated.
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:

            enrouted: list[dict] = []
            if viewer_id:
                cur.execute("""
                    SELECT v.*, u.name AS creator_name, u.department AS creator_department,
                           u.credits AS creator_credits
                    FROM videos v
                    JOIN users u ON v.user_id::uuid = u.id
                    JOIN follows f ON f.following_id = u.id
                    WHERE v.overall_status IN ('approved', 'flagged')
                      AND f.follower_id = %s::uuid
                    ORDER BY v.created_at DESC
                    LIMIT %s
                """, (viewer_id, limit))
                enrouted = [dict(r) for r in cur.fetchall()]

            # Exclude already-enrouted video ids from recommendations
            enrouted_ids = tuple(r["id"] for r in enrouted) or ("",)

            cur.execute("""
                SELECT v.*, u.name AS creator_name, u.department AS creator_department,
                       u.credits AS creator_credits
                FROM videos v
                JOIN users u ON v.user_id::uuid = u.id
                WHERE v.overall_status IN ('approved', 'flagged')
                  AND v.id NOT IN %s
                ORDER BY
                    u.credits DESC,
                    v.created_at DESC
                LIMIT %s
            """, (enrouted_ids, limit))
            recommended = [dict(r) for r in cur.fetchall()]

    def _normalise(rows: list[dict]) -> list[dict]:
        out = []
        for row in rows:
            d = dict(row)
            d["_id"] = d.pop("id")
            out.append(d)
        return out

    return {
        "enrouted": _normalise(enrouted),
        "recommended": _normalise(recommended),
    }


def create_user(name: str, email: str, password_hash: str) -> dict:
    sql = """
        INSERT INTO users (name, email, password_hash)
        VALUES (%s, %s, %s)
        RETURNING id, name, email, account_type, department, created_at
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (name, email, password_hash))
            return dict(cur.fetchone())


def get_user_by_id(user_id: str) -> Optional[dict]:
    sql = "SELECT * FROM users WHERE id = %s"
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (user_id,))
            row = cur.fetchone()
    return dict(row) if row else None


def get_user_by_email(email: str) -> Optional[dict]:
    sql = "SELECT * FROM users WHERE email = %s"
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (email,))
            row = cur.fetchone()
    return dict(row) if row else None


def upgrade_to_creator(user_id: str, department: str) -> dict:
    sql = """
        UPDATE users
        SET account_type = 'creator', department = %s
        WHERE id = %s
        RETURNING id, name, email, account_type, department
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (department, user_id))
            return dict(cur.fetchone())


def find_duplicate_hash(file_hash: str, exclude_job_id: str) -> bool:
    """Return True if another completed video with the same SHA-256 hash exists."""
    sql = """
        SELECT 1 FROM videos
        WHERE file_hash = %s AND id != %s AND status = 'done'
        LIMIT 1
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (file_hash, exclude_job_id))
            return cur.fetchone() is not None


# ── Credits ──────────────────────────────────────────────────────────────────

def add_credit(video_id: str) -> int:
    """Add 1 credit to the creator of a video. Returns new credit total."""
    sql = """
        UPDATE users SET credits = credits + 1
        WHERE id = (SELECT user_id::uuid FROM videos WHERE id = %s)
        RETURNING credits
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (video_id,))
            row = cur.fetchone()
    return row[0] if row else 0


# ── Follows ───────────────────────────────────────────────────────────────────

def follow_user(follower_id: str, following_id: str) -> None:
    sql = """
        INSERT INTO follows (follower_id, following_id)
        VALUES (%s::uuid, %s::uuid)
        ON CONFLICT DO NOTHING
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (follower_id, following_id))


def unfollow_user(follower_id: str, following_id: str) -> None:
    sql = "DELETE FROM follows WHERE follower_id = %s::uuid AND following_id = %s::uuid"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (follower_id, following_id))


def is_following(follower_id: str, following_id: str) -> bool:
    sql = "SELECT 1 FROM follows WHERE follower_id = %s::uuid AND following_id = %s::uuid"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (follower_id, following_id))
            return cur.fetchone() is not None


def get_creator_profile(creator_id: str, viewer_id: Optional[str] = None) -> Optional[dict]:
    """Return creator public profile with follower count, credit total, and follow status."""
    sql = """
        SELECT u.id, u.name, u.department, u.account_type, u.credits, u.created_at,
               COUNT(DISTINCT f.follower_id) AS follower_count,
               COUNT(DISTINCT v.id) AS video_count
        FROM users u
        LEFT JOIN follows f ON f.following_id = u.id
        LEFT JOIN videos v ON v.user_id::uuid = u.id AND v.overall_status IN ('approved','flagged')
        WHERE u.id = %s::uuid
        GROUP BY u.id
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (creator_id,))
            row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    d["id"] = str(d["id"])
    d["is_following"] = is_following(viewer_id, creator_id) if viewer_id else False
    return d


# ── Search ────────────────────────────────────────────────────────────────────

def search(query: str) -> dict:
    """Search creators by name/department and videos by filename."""
    like = f"%{query}%"

    creator_sql = """
        SELECT id, name, department, account_type, credits,
               (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS follower_count
        FROM users u
        WHERE (name ILIKE %s OR department ILIKE %s) AND account_type = 'creator'
        LIMIT 10
    """
    video_sql = """
        SELECT v.id, v.filename, v.overall_status, v.created_at,
               u.name AS creator_name, u.department AS creator_department
        FROM videos v
        LEFT JOIN users u ON v.user_id::uuid = u.id
        WHERE v.filename ILIKE %s AND v.overall_status IN ('approved','flagged')
        LIMIT 10
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(creator_sql, (like, like))
            creators = [dict(r) for r in cur.fetchall()]
            cur.execute(video_sql, (like,))
            videos = [dict(r) for r in cur.fetchall()]

    for c in creators:
        c["id"] = str(c["id"])
    for v in videos:
        v["id"] = str(v["id"])
    return {"creators": creators, "videos": videos}


def search_users(query: str) -> list:
    """Search all users (any account_type) by name. Used by the messaging 'find people' flow."""
    like = f"%{query}%"

    sql = """
        SELECT id, name, account_type
        FROM users
        WHERE name ILIKE %s
        LIMIT 10
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (like,))
            users = [dict(r) for r in cur.fetchall()]

    for u in users:
        u["id"] = str(u["id"])
    return users


def search_users_by_ids(ids: list[str]) -> list:
    """Batch-resolve user IDs to {id, name, account_type}. Missing IDs are silently omitted."""
    sql = """
        SELECT id, name, account_type
        FROM users
        WHERE id::text = ANY(%s)
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (ids,))
            users = [dict(r) for r in cur.fetchall()]

    for u in users:
        u["id"] = str(u["id"])
    return users


# ── Comments ──────────────────────────────────────────────────────────────────

def add_comment(video_id: str, body: str, user_id: Optional[str] = None) -> dict:
    """Insert a comment and return it with author name."""
    sql = """
        INSERT INTO comments (video_id, user_id, body)
        VALUES (%s, %s::uuid, %s)
        RETURNING id, video_id, user_id, body, created_at
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (video_id, user_id, body))
            row = dict(cur.fetchone())
    row["id"] = str(row["id"])
    row["user_id"] = str(row["user_id"]) if row["user_id"] else None
    return row


def get_comments(video_id: str, limit: int = 50) -> list[dict]:
    """Return comments for a video, newest first, with author name."""
    sql = """
        SELECT c.id, c.body, c.created_at,
               u.name AS author_name
        FROM comments c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.video_id = %s
        ORDER BY c.created_at ASC
        LIMIT %s
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (video_id, limit))
            rows = cur.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        result.append(d)
    return result


# ── Houses ────────────────────────────────────────────────────────────────────
# Built-in Houses (one per department) have no table — they're derived from
# users.department at query time (KTD1). Only custom Houses are real rows here.

def create_house(house_id: str, owner_id: str, name: str, description: Optional[str]) -> dict:
    """Insert a new custom House. house_id is generated by the caller (main.py),
    matching create_job's id-generation pattern (a UUID string, not DB-generated)."""
    sql = """
        INSERT INTO houses (id, owner_id, name, description)
        VALUES (%s, %s::uuid, %s, %s)
        RETURNING id, owner_id, name, description, created_at
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (house_id, owner_id, name, description))
            row = dict(cur.fetchone())
    row["owner_id"] = str(row["owner_id"])
    return row


def get_house(house_id: str) -> Optional[dict]:
    """Return a single custom House row, or None if it doesn't exist.
    Used by _require_house_owner (404 if None) and by ownership checks."""
    sql = "SELECT id, owner_id, name, description, created_at FROM houses WHERE id = %s"
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (house_id,))
            row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    d["owner_id"] = str(d["owner_id"])
    return d


def delete_house(house_id: str) -> None:
    """Delete a House. Membership rows cascade via ON DELETE CASCADE."""
    sql = "DELETE FROM houses WHERE id = %s"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (house_id,))


def list_custom_houses() -> list[dict]:
    """Return every custom House with a creator-member count and video-member
    count for display on the Houses listing card."""
    sql = """
        SELECT h.id, h.owner_id, h.name, h.description, h.created_at,
               COUNT(DISTINCT hcm.creator_id) AS creator_count,
               COUNT(DISTINCT hvm.video_id) AS video_count
        FROM houses h
        LEFT JOIN house_creator_members hcm ON hcm.house_id = h.id
        LEFT JOIN house_video_members hvm ON hvm.house_id = h.id
        GROUP BY h.id
        ORDER BY h.created_at DESC
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["owner_id"] = str(r["owner_id"])
    return rows


def add_house_creator_member(house_id: str, creator_id: str) -> None:
    """Idempotent add — matches follow_user's INSERT ... ON CONFLICT DO NOTHING pattern."""
    sql = """
        INSERT INTO house_creator_members (house_id, creator_id)
        VALUES (%s, %s::uuid)
        ON CONFLICT DO NOTHING
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (house_id, creator_id))


def remove_house_creator_member(house_id: str, creator_id: str) -> None:
    """Matches unfollow_user's plain DELETE WHERE pattern — no error if absent."""
    sql = "DELETE FROM house_creator_members WHERE house_id = %s AND creator_id = %s::uuid"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (house_id, creator_id))


def add_house_video_member(house_id: str, video_id: str) -> None:
    """Idempotent add. No ownership check on the video's creator — cross-creator
    video curation is intentional (KTD2a), enforced (as a non-check) at the
    main.py route level, not here."""
    sql = """
        INSERT INTO house_video_members (house_id, video_id)
        VALUES (%s, %s)
        ON CONFLICT DO NOTHING
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (house_id, video_id))


def remove_house_video_member(house_id: str, video_id: str) -> None:
    sql = "DELETE FROM house_video_members WHERE house_id = %s AND video_id = %s"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (house_id, video_id))


def get_house_feed(house_id: str) -> list[dict]:
    """Return a custom House's unioned creator+video membership feed, newest
    first. A single SELECT with an OR'd WHERE over one base table (videos) —
    no DISTINCT needed, since one SELECT over one table cannot return the same
    v.id row twice no matter how many OR-branches it satisfies (KTD4/U2 design).

    Both v.user_id::uuid casts are required: v.user_id is TEXT (ALTER TABLE
    migration), while u.id and house_creator_members.creator_id are UUID —
    same cast pattern already used in get_feed/get_creator_profile/search/add_credit.
    """
    sql = """
        SELECT v.*, u.name AS creator_name, u.department AS creator_department
        FROM videos v
        JOIN users u ON v.user_id::uuid = u.id
        WHERE v.overall_status IN ('approved', 'flagged')
          AND (
            v.user_id::uuid IN (SELECT creator_id FROM house_creator_members WHERE house_id = %s)
            OR
            v.id IN (SELECT video_id FROM house_video_members WHERE house_id = %s)
          )
        ORDER BY v.created_at DESC
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (house_id, house_id))
            rows = [dict(r) for r in cur.fetchall()]
    result = []
    for row in rows:
        d = dict(row)
        d["_id"] = d.pop("id")
        result.append(d)
    return result


def get_department_house_feed(department_name: str) -> list[dict]:
    """Return every approved/flagged video from creators whose users.department
    exactly matches department_name, newest first (built-in House, KTD1 — no
    table, derived entirely from existing data).

    The ::uuid cast on the join is required, not optional: videos.user_id is
    TEXT while users.id is UUID — omitting the cast raises
    'operator does not exist: text = uuid' at query time (confirmed via plan
    review as a hard runtime failure). Mirrors get_feed's identical cast.
    """
    sql = """
        SELECT v.*, u.name AS creator_name, u.department AS creator_department
        FROM videos v
        JOIN users u ON v.user_id::uuid = u.id
        WHERE u.department = %s AND v.overall_status IN ('approved', 'flagged')
        ORDER BY v.created_at DESC
    """
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (department_name,))
            rows = [dict(r) for r in cur.fetchall()]
    result = []
    for row in rows:
        d = dict(row)
        d["_id"] = d.pop("id")
        result.append(d)
    return result
