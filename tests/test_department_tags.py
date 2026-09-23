"""
Integration tests for the multi-department content tagging feature:
backend/app/db.py's video_department_tags functions, POST /videos'
departments form field, and the /videos/{id}/departments management routes.

Follows tests/test_houses.py's pattern exactly (live-DB integration tests,
skipped without POSTGRES_URL) since every function under test here does real
SQL I/O — the partial unique index enforcing "exactly one primary tag per
video" is exactly the kind of constraint a mock would paper over.

Requires a live Postgres reachable via POSTGRES_URL:

    POSTGRES_URL=postgresql://postgres:redactor123@localhost:5434/video_moderation \
        pytest tests/test_department_tags.py -v
"""
import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

if not os.environ.get("POSTGRES_URL"):
    pytest.skip(
        "POSTGRES_URL not set — these are live-DB integration tests, not "
        "pure-logic unit tests. Start Postgres (docker compose up -d "
        "postgres) and set POSTGRES_URL to run this file.",
        allow_module_level=True,
    )

from app import db  # noqa: E402

db._ensure_schema()

DEPARTMENTS = [
    "Cinematography", "Directing", "Screenwriting", "Editing",
    "Sound Design", "Visual Effects", "Production Design", "Acting", "Other",
]


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def run_tag():
    return uuid.uuid4().hex[:8]


@pytest.fixture
def make_user(run_tag):
    created_ids = []

    def _make(name_prefix="User", department=None, as_creator=False):
        email = f"{name_prefix.lower()}-{run_tag}-{len(created_ids)}@test.local"
        user = db.create_user(f"{name_prefix} {run_tag}", email, "not-a-real-hash")
        user_id = str(user["id"])
        created_ids.append(user_id)
        if as_creator:
            dept = department or DEPARTMENTS[0]
            db.upgrade_to_creator(user_id, dept)
            user = db.get_user_by_id(user_id)
        return user

    yield _make

    with db._connect() as conn:
        with conn.cursor() as cur:
            for uid in created_ids:
                cur.execute("DELETE FROM users WHERE id = %s::uuid", (uid,))


@pytest.fixture
def make_video(run_tag):
    created_ids = []

    def _make(owner_id: str, overall_status="approved", filename=None):
        video_id = str(uuid.uuid4())
        fname = filename or f"{run_tag}-{len(created_ids)}.mp4"
        db.create_job(video_id, fname, f"s3://test-bucket/{video_id}.mp4", user_id=owner_id)
        db.update_job(video_id, {"status": "done", "overall_status": overall_status})
        created_ids.append(video_id)
        return video_id

    yield _make

    with db._connect() as conn:
        with conn.cursor() as cur:
            for vid in created_ids:
                cur.execute("DELETE FROM videos WHERE id = %s", (vid,))


# ── db.py: set_video_department_tags / get_video_department_tags ─────────────

class TestSetVideoDepartmentTags:
    def test_primary_tag_written_and_marked(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))

        db.set_video_department_tags(video_id, "Editing", [])
        tags = db.get_video_department_tags(video_id)

        assert len(tags) == 1
        assert tags[0]["department"] == "Editing"
        assert tags[0]["is_primary"] is True

    def test_additional_tags_written_as_non_primary(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))

        db.set_video_department_tags(video_id, "Editing", ["Directing", "Sound Design"])
        tags = db.get_video_department_tags(video_id)

        by_dept = {t["department"]: t["is_primary"] for t in tags}
        assert by_dept == {"Editing": True, "Directing": False, "Sound Design": False}

    def test_primary_appears_first_in_ordering(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))

        db.set_video_department_tags(video_id, "Editing", ["Directing"])
        tags = db.get_video_department_tags(video_id)

        assert tags[0]["is_primary"] is True

    def test_duplicate_of_primary_in_additional_list_collapses(self, make_user, make_video):
        """Edge case from the design doc: selecting the primary department as
        an additional pick too must not create two rows or crash."""
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))

        db.set_video_department_tags(video_id, "Editing", ["Editing", "Directing"])
        tags = db.get_video_department_tags(video_id)

        assert len(tags) == 2
        assert sum(1 for t in tags if t["is_primary"]) == 1

    def test_exactly_one_primary_per_video_enforced_by_db(self, make_user, make_video):
        """The partial unique index (idx_video_dept_tags_one_primary) must
        reject a second primary row inserted directly, not just via the
        higher-level helper — confirms DB-level enforcement, not just
        application discipline."""
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])

        with pytest.raises(Exception):
            with db._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO video_department_tags (video_id, department, is_primary) "
                        "VALUES (%s, %s, TRUE)",
                        (video_id, "Directing"),
                    )


# ── db.py: add/remove additional tags — primary is structurally protected ────

class TestAddRemoveDepartmentTag:
    def test_add_additional_tag(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])

        db.add_video_department_tag(video_id, "Directing")
        tags = db.get_video_department_tags(video_id)

        assert any(t["department"] == "Directing" and not t["is_primary"] for t in tags)

    def test_add_additional_tag_twice_does_not_raise(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])

        db.add_video_department_tag(video_id, "Directing")
        db.add_video_department_tag(video_id, "Directing")  # no raise expected

        tags = db.get_video_department_tags(video_id)
        assert sum(1 for t in tags if t["department"] == "Directing") == 1

    def test_remove_additional_tag_succeeds(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", ["Directing"])

        removed = db.remove_video_department_tag(video_id, "Directing")
        tags = db.get_video_department_tags(video_id)

        assert removed is True
        assert all(t["department"] != "Directing" for t in tags)

    def test_remove_primary_tag_is_a_noop(self, make_user, make_video):
        """Design doc's core guarantee: the primary tag can never be removed,
        even via a direct db.py call that bypasses the route layer entirely."""
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])

        removed = db.remove_video_department_tag(video_id, "Editing")
        tags = db.get_video_department_tags(video_id)

        assert removed is False
        assert len(tags) == 1
        assert tags[0]["department"] == "Editing"
        assert tags[0]["is_primary"] is True


# ── db.py: get_department_tags_for_videos (batch fetch) ──────────────────────

class TestGetDepartmentTagsForVideos:
    def test_batch_fetch_groups_by_video_id(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        v1 = make_video(str(creator["id"]))
        v2 = make_video(str(creator["id"]))
        db.set_video_department_tags(v1, "Editing", ["Directing"])
        db.set_video_department_tags(v2, "Editing", [])

        result = db.get_department_tags_for_videos([v1, v2])

        assert len(result[v1]) == 2
        assert len(result[v2]) == 1

    def test_video_with_no_tags_returns_empty_list_not_missing_key(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))

        result = db.get_department_tags_for_videos([video_id])

        assert result[video_id] == []

    def test_empty_input_returns_empty_dict(self):
        assert db.get_department_tags_for_videos([]) == {}


# ── db.py: backfill migration for videos that predate this feature ───────────

class TestBackfillMissingPrimaryTags:
    def test_ensure_schema_backfills_untagged_video_with_creators_department(
        self, make_user, make_video
    ):
        """Critical backward-compat edge case: every video uploaded before
        this feature shipped has zero video_department_tags rows. Since
        get_department_house_feed is now tag-based (no fallback to
        users.department), an unpatched pre-existing video would silently
        vanish from every department feed the instant this deploys —
        discovered via test_houses.py's own suite regressing, not the
        original design. _ensure_schema()'s backfill INSERT must give it a
        primary tag on the very next startup."""
        creator = make_user("Creator", as_creator=True, department="Acting")
        # This file's make_video fixture bypasses set_video_department_tags
        # entirely (raw db.create_job) — matching exactly how a real
        # pre-migration production row looks: zero tag rows.
        video_id = make_video(str(creator["id"]), overall_status="approved")

        assert db.get_video_department_tags(video_id) == []

        db._ensure_schema()  # re-run, as happens on every real deploy/restart

        tags = db.get_video_department_tags(video_id)
        assert len(tags) == 1
        assert tags[0]["department"] == "Acting"
        assert tags[0]["is_primary"] is True

    def test_backfill_does_not_touch_video_with_existing_tags(self, make_user, make_video):
        """The backfill must never overwrite a real tag set written after
        this feature shipped — WHERE NOT EXISTS should make it strictly
        additive for untagged rows only."""
        creator = make_user("Creator", as_creator=True, department="Acting")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.set_video_department_tags(video_id, "Acting", ["Directing"])

        db._ensure_schema()

        tags = {t["department"] for t in db.get_video_department_tags(video_id)}
        assert tags == {"Acting", "Directing"}

    def test_backfill_skips_video_whose_creator_has_no_department(self, make_user, make_video):
        """A video from a user with no department set (e.g. was never
        upgraded to creator through the normal flow) has nothing sensible to
        backfill — must not raise, must leave it untagged rather than
        writing a NULL/empty department row."""
        viewer = make_user("Viewer")  # never upgraded — department is NULL
        video_id = make_video(str(viewer["id"]), overall_status="approved")

        db._ensure_schema()  # must not raise

        assert db.get_video_department_tags(video_id) == []


# ── db.py: get_department_house_feed now tag-based, not creator-department ───

class TestDepartmentFeedIsTagBased:
    def test_video_tagged_into_non_home_department_appears_in_that_feed(
        self, make_user, make_video
    ):
        """The core behavior change: a video surfaces in a department's feed
        because it carries a TAG for that department, independent of its
        creator's own home department."""
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.set_video_department_tags(video_id, "Editing", ["Directing"])

        feed = db.get_department_house_feed("Directing")

        assert video_id in [v["_id"] for v in feed]

    def test_video_still_appears_in_primary_departments_feed(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.set_video_department_tags(video_id, "Editing", ["Directing"])

        feed = db.get_department_house_feed("Editing")

        assert video_id in [v["_id"] for v in feed]

    def test_untagged_department_does_not_include_video(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.set_video_department_tags(video_id, "Editing", ["Directing"])

        feed = db.get_department_house_feed("Acting")

        assert video_id not in [v["_id"] for v in feed]

    def test_removing_creators_home_department_video_no_longer_untagged(
        self, make_user, make_video
    ):
        """Confirms the feed no longer falls back to users.department at all
        — a video with tags written stays visible strictly by tag, even if
        (hypothetically) its creator's own department later changed."""
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.set_video_department_tags(video_id, "Editing", [])

        db.upgrade_to_creator(str(creator["id"]), "Acting")  # creator's dept changes later

        feed = db.get_department_house_feed("Editing")
        assert video_id in [v["_id"] for v in feed]  # frozen primary tag still holds


# ── main.py: routes (TestClient, no network) ──────────────────────────────────

@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from app import main as app_main

    return TestClient(app_main.app)


@pytest.fixture(scope="module")
def jwt_secret():
    from app import main as app_main

    return app_main.JWT_SECRET


def _token_for(user_id: str, jwt_secret: str) -> str:
    from jose import jwt

    return jwt.encode({"sub": user_id}, jwt_secret, algorithm="HS256")


class TestUploadValidation:
    """These validate and reject BEFORE reaching storage.save_video (real S3
    upload) — see upload_video's ordering: departments is parsed and checked
    against DEPARTMENTS/MAX_ADDITIONAL_DEPARTMENTS first, so a 400 here never
    touches S3. Confirmed the hard way: an earlier bug (missing Form(...) on
    the departments parameter — FastAPI does not auto-treat a plain str
    alongside UploadFile as a form field) made this validation silently
    never fire at all, falling through to a real S3 call instead. These
    tests always run, unlike TestUploadDepartmentTagsRequiringS3 below."""

    def test_upload_with_invalid_department_rejected(self, client, jwt_secret, make_user):
        creator = make_user("Creator", as_creator=True, department="Editing")
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.post(
            "/videos",
            data={"departments": "Not A Real Department"},
            files={"file": ("clip.mp4", b"fake-bytes", "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 400

    def test_upload_exceeding_max_additional_departments_rejected(
        self, client, jwt_secret, make_user
    ):
        from app import main as app_main

        creator = make_user("Creator", as_creator=True, department="Editing")
        token = _token_for(str(creator["id"]), jwt_secret)
        too_many = ",".join(DEPARTMENTS[1: app_main.MAX_ADDITIONAL_DEPARTMENTS + 2])

        resp = client.post(
            "/videos",
            data={"departments": too_many},
            files={"file": ("clip.mp4", b"fake-bytes", "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 400


@pytest.mark.skipif(
    not os.environ.get("AWS_ACCESS_KEY_ID"),
    reason=(
        "POST /videos calls storage.save_video (real S3 upload) after "
        "validation passes — this repo has no S3 mock/moto dependency "
        "(matching test_houses.py's own precedent of bypassing S3 entirely "
        "via direct db.create_job calls). These 3 tests need a real S3 "
        "bucket reachable with AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/"
        "AWS_S3_BUCKET set — TestUploadValidation's 2 tests short-circuit "
        "before S3 and always run regardless."
    ),
)
class TestUploadDepartmentTagsRequiringS3:
    def test_upload_with_no_departments_field_writes_only_primary(
        self, client, jwt_secret, make_user
    ):
        creator = make_user("Creator", as_creator=True, department="Editing")
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.post(
            "/videos",
            files={"file": ("clip.mp4", b"fake-bytes", "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        task_id = resp.json()["task_id"]
        tags = db.get_video_department_tags(task_id)
        assert len(tags) == 1
        assert tags[0]["department"] == "Editing"
        assert tags[0]["is_primary"] is True

        db._connect().cursor().execute("DELETE FROM videos WHERE id = %s", (task_id,))

    def test_upload_with_additional_departments_writes_all_tags(
        self, client, jwt_secret, make_user
    ):
        creator = make_user("Creator", as_creator=True, department="Editing")
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.post(
            "/videos",
            data={"departments": "Directing,Sound Design"},
            files={"file": ("clip.mp4", b"fake-bytes", "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        task_id = resp.json()["task_id"]
        tags = {t["department"] for t in db.get_video_department_tags(task_id)}
        assert tags == {"Editing", "Directing", "Sound Design"}

        with db._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM videos WHERE id = %s", (task_id,))

    def test_status_response_includes_department_tags(self, client, jwt_secret, make_user):
        creator = make_user("Creator", as_creator=True, department="Editing")
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.post(
            "/videos",
            files={"file": ("clip.mp4", b"fake-bytes", "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )
        task_id = resp.json()["task_id"]

        status_resp = client.get(f"/videos/{task_id}/status")

        assert status_resp.status_code == 200
        assert status_resp.json()["department_tags"][0]["is_primary"] is True

        with db._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM videos WHERE id = %s", (task_id,))


class TestDepartmentTagRoutes:
    def test_owner_can_add_additional_tag(self, client, jwt_secret, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.post(
            f"/videos/{video_id}/departments",
            json={"department": "Directing"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        depts = {t["department"] for t in resp.json()["department_tags"]}
        assert depts == {"Editing", "Directing"}

    def test_non_owner_cannot_add_tag(self, client, jwt_secret, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        intruder = make_user("Intruder", as_creator=True, department="Acting")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])
        token = _token_for(str(intruder["id"]), jwt_secret)

        resp = client.post(
            f"/videos/{video_id}/departments",
            json={"department": "Directing"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 403

    def test_invalid_department_name_rejected(self, client, jwt_secret, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.post(
            f"/videos/{video_id}/departments",
            json={"department": "Not A Real Department"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 400

    def test_owner_can_remove_additional_tag(self, client, jwt_secret, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", ["Directing"])
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.delete(
            f"/videos/{video_id}/departments/Directing",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        depts = {t["department"] for t in resp.json()["department_tags"]}
        assert depts == {"Editing"}

    def test_removing_primary_tag_via_route_is_a_noop_not_error(
        self, client, jwt_secret, make_user, make_video
    ):
        """The route never distinguishes primary from additional before
        calling into db.py — the DB layer's own guard is what actually
        prevents removal. This test confirms that defense-in-depth holds
        through the full HTTP route, not just the direct db.py call."""
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", [])
        token = _token_for(str(creator["id"]), jwt_secret)

        resp = client.delete(
            f"/videos/{video_id}/departments/Editing",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        depts = [t["department"] for t in resp.json()["department_tags"]]
        assert depts == ["Editing"]  # still present, untouched

    def test_non_owner_cannot_remove_tag(self, client, jwt_secret, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Editing")
        intruder = make_user("Intruder", as_creator=True, department="Acting")
        video_id = make_video(str(creator["id"]))
        db.set_video_department_tags(video_id, "Editing", ["Directing"])
        token = _token_for(str(intruder["id"]), jwt_secret)

        resp = client.delete(
            f"/videos/{video_id}/departments/Directing",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 403


class TestEnrichIncludesDepartmentTags:
    def test_feed_route_rows_include_department_tags(
        self, client, jwt_secret, make_user, make_video
    ):
        creator = make_user("Creator", as_creator=True, department="Editing")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.set_video_department_tags(video_id, "Editing", ["Directing"])

        resp = client.get("/houses/department/Editing/feed")

        assert resp.status_code == 200
        row = next(v for v in resp.json()["videos"] if v["job_id"] == video_id)
        depts = {t["department"] for t in row["department_tags"]}
        assert depts == {"Editing", "Directing"}
