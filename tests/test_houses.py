"""
Integration tests for the Houses backend surface: backend/app/db.py's new
House query functions, backend/app/main.py's new House routes, and the
POST /auth/upgrade department-validation check added alongside them.

Unlike tests/test_decision_engine.py (which imports decision_engine.py
directly by path specifically BECAUSE that module is pure logic with no DB
dependency), every function under test here does real SQL I/O — list/get/
create/delete a House, add/remove membership, read a House-scoped feed. That
logic cannot be meaningfully unit-tested without a live Postgres connection
(there is no DB-mocking layer anywhere in this repo's backend, confirmed
during plan research), so this file follows the plan's own documented
fallback: exercise it against a real, disposable database instead of
py_compile-only or a mocked connection that would just assert psycopg2 was
called correctly rather than that the SQL itself is correct (the ::uuid
casts and the OR'd-WHERE dedup are exactly the kind of thing a mock would
paper over).

Requires a live Postgres reachable via POSTGRES_URL (same instance local dev
already uses): `docker compose up -d postgres`, then run with POSTGRES_URL
set, e.g.:

    POSTGRES_URL=postgresql://postgres:redactor123@localhost:5434/video_moderation \
        pytest tests/test_houses.py -v

Each test creates its own users/houses/videos and cleans them up in a
fixture teardown, so this file is safe to run repeatedly against a
persistent dev database without accumulating rows or colliding with data
left by other tests/sessions (every row this file creates is tagged with a
per-test-run UUID suffix in email/filename so cleanup can target exactly
its own rows even under concurrent runs).
"""
import os
import sys
import uuid
from pathlib import Path

import pytest

# Import the app package directly by path, matching test_decision_engine.py's
# technique — this avoids depending on the package being pip-installed.
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
    """A short unique tag per test, used to namespace created rows so
    parallel/repeated runs never collide and teardown only ever deletes rows
    this specific test created."""
    return uuid.uuid4().hex[:8]


@pytest.fixture
def make_user(run_tag):
    """Factory: create a user (viewer by default), return the full row dict.
    Tracks created ids for teardown."""
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
    """Factory: create a video row directly (bypassing S3/Celery — this file
    tests the House query/route layer, not the moderation pipeline) with a
    given owner and overall_status. Tracks created ids for teardown."""
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


@pytest.fixture
def make_house(run_tag):
    """Factory: create a custom House. Tracks created ids for teardown
    (membership rows cascade automatically via ON DELETE CASCADE)."""
    created_ids = []

    def _make(owner_id: str, name=None, description="A test house"):
        house_id = str(uuid.uuid4())
        db.create_house(house_id, owner_id, name or f"House {run_tag}", description)
        created_ids.append(house_id)
        return house_id

    yield _make

    with db._connect() as conn:
        with conn.cursor() as cur:
            for hid in created_ids:
                cur.execute("DELETE FROM houses WHERE id = %s", (hid,))


# ── db.py: create_house / get_house / list_custom_houses / delete_house ──────

class TestHouseCrud:
    def test_create_house_returns_correct_owner_id(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        house_id = make_house(str(owner["id"]), name="My House")
        house = db.get_house(house_id)
        assert house is not None
        assert house["owner_id"] == str(owner["id"])
        assert house["name"] == "My House"

    def test_list_custom_houses_includes_created_house(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        house_id = make_house(str(owner["id"]))
        all_houses = db.list_custom_houses()
        assert any(h["id"] == house_id for h in all_houses)

    def test_list_custom_houses_includes_member_counts(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        db.add_house_creator_member(house_id, str(creator["id"]))
        rows = db.list_custom_houses()
        row = next(h for h in rows if h["id"] == house_id)
        assert row["creator_count"] == 1
        assert row["video_count"] == 0

    def test_get_house_returns_none_for_missing_id(self):
        assert db.get_house("definitely-not-a-real-house-id") is None

    def test_delete_house_removes_it(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        house_id = make_house(str(owner["id"]))
        db.delete_house(house_id)
        assert db.get_house(house_id) is None

    def test_delete_house_cascades_membership_rows(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        db.add_house_creator_member(house_id, str(creator["id"]))
        db.delete_house(house_id)
        with db._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM house_creator_members WHERE house_id = %s", (house_id,)
                )
                assert cur.fetchone() is None


# ── db.py: get_house_feed (custom House union + dedup) ───────────────────────

class TestGetHouseFeed:
    def test_creator_membership_includes_that_creators_approved_videos(
        self, make_user, make_house, make_video
    ):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(creator["id"]), overall_status="approved")

        db.add_house_creator_member(house_id, str(creator["id"]))
        feed = db.get_house_feed(house_id)

        assert any(v["_id"] == video_id for v in feed)

    def test_individual_video_membership_from_non_member_creator_included(
        self, make_user, make_house, make_video
    ):
        """A video added individually from a creator who is NOT otherwise a
        creator-member of the House still appears — the base case for
        individual video curation."""
        owner = make_user("Owner", as_creator=True)
        other_creator = make_user("Other", as_creator=True, department="Acting")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(other_creator["id"]), overall_status="approved")

        db.add_house_video_member(house_id, video_id)
        feed = db.get_house_feed(house_id)

        ids = [v["_id"] for v in feed]
        assert ids == [video_id]

    def test_cross_creator_video_add_succeeds_ktd2a(
        self, make_user, make_house, make_video
    ):
        """KTD2a: adding a video whose creator is a DIFFERENT user than the
        House owner succeeds and the video appears — there is no ownership
        check on the video's creator, only on the House itself. This is the
        plan's explicit not-a-403-case scenario."""
        owner = make_user("Owner", as_creator=True, department="Cinematography")
        other_creator = make_user("Other", as_creator=True, department="Sound Design")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(other_creator["id"]), overall_status="approved")

        # No exception, no rejection — add_house_video_member performs no
        # ownership/consent check on video_id's creator.
        db.add_house_video_member(house_id, video_id)
        feed = db.get_house_feed(house_id)

        assert video_id in [v["_id"] for v in feed]
        assert str(owner["id"]) != str(other_creator["id"])

    def test_video_qualifying_via_both_branches_appears_exactly_once(
        self, make_user, make_house, make_video
    ):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(creator["id"]), overall_status="approved")

        db.add_house_creator_member(house_id, str(creator["id"]))
        db.add_house_video_member(house_id, video_id)  # same video, added both ways
        feed = db.get_house_feed(house_id)

        matching = [v for v in feed if v["_id"] == video_id]
        assert len(matching) == 1

    def test_zero_members_returns_empty_list_not_error(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        house_id = make_house(str(owner["id"]))
        feed = db.get_house_feed(house_id)
        assert feed == []

    def test_flagged_videos_included_matching_get_feed_visibility(
        self, make_user, make_house, make_video
    ):
        """Mirrors get_feed()'s overall_status IN ('approved','flagged') rule
        — a House feed shouldn't be stricter or looser than the main feed."""
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(creator["id"]), overall_status="flagged")

        db.add_house_creator_member(house_id, str(creator["id"]))
        feed = db.get_house_feed(house_id)

        assert video_id in [v["_id"] for v in feed]

    def test_blocked_video_excluded_even_when_still_a_member(
        self, make_user, make_house, make_video
    ):
        """Membership rows have no overall_status gate at write time, only at
        feed-read time: a video that becomes blocked disappears from the
        feed without its membership row being touched."""
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(creator["id"]), overall_status="approved")

        db.add_house_video_member(house_id, video_id)
        assert video_id in [v["_id"] for v in db.get_house_feed(house_id)]

        db.update_job(video_id, {"overall_status": "blocked"})
        feed_after = db.get_house_feed(house_id)
        assert video_id not in [v["_id"] for v in feed_after]

        # Membership row itself is untouched.
        with db._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM house_video_members WHERE house_id = %s AND video_id = %s",
                    (house_id, video_id),
                )
                assert cur.fetchone() is not None

    def test_feed_ordered_by_created_at_desc(self, make_user, make_house, make_video):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        db.add_house_creator_member(house_id, str(creator["id"]))

        v_older = make_video(str(creator["id"]), overall_status="approved", filename="older.mp4")
        v_newer = make_video(str(creator["id"]), overall_status="approved", filename="newer.mp4")

        feed = db.get_house_feed(house_id)
        ids_in_order = [v["_id"] for v in feed]
        assert ids_in_order.index(v_newer) < ids_in_order.index(v_older)


# ── db.py: get_department_house_feed (built-in Houses, KTD1) ─────────────────

class TestGetDepartmentHouseFeed:
    def test_returns_approved_videos_for_matching_department(
        self, make_user, make_video
    ):
        creator = make_user("Creator", as_creator=True, department="Directing")
        video_id = make_video(str(creator["id"]), overall_status="approved")

        feed = db.get_department_house_feed("Directing")

        assert video_id in [v["_id"] for v in feed]

    def test_exact_string_match_required_case_sensitive(self, make_user, make_video):
        """Confirms the KTD1-precondition failure mode directly: an exact-
        case mismatch returns zero rows, silently — which is exactly why
        POST /auth/upgrade now validates against DEPARTMENTS server-side."""
        creator = make_user("Creator", as_creator=True, department="Directing")
        make_video(str(creator["id"]), overall_status="approved")

        feed = db.get_department_house_feed("directing")  # lowercase mismatch

        assert feed == []

    def test_zero_creators_in_department_returns_empty_not_error(self):
        feed = db.get_department_house_feed("NoSuchDepartmentAtAll")
        assert feed == []

    def test_does_not_include_other_departments_videos(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True, department="Acting")
        video_id = make_video(str(creator["id"]), overall_status="approved")

        feed = db.get_department_house_feed("Editing")

        assert video_id not in [v["_id"] for v in feed]

    def test_uuid_cast_join_does_not_raise(self, make_user, make_video):
        """Regression guard for the confirmed will-fail-at-runtime bug an
        earlier plan draft had (missing ::uuid cast on the videos.user_id /
        users.id join -> 'operator does not exist: text = uuid'). If the
        cast is ever removed, this call raises instead of returning."""
        creator = make_user("Creator", as_creator=True, department="Visual Effects")
        make_video(str(creator["id"]), overall_status="approved")

        # No exception is the assertion here.
        db.get_department_house_feed("Visual Effects")


# ── db.py: membership add/remove idempotency ──────────────────────────────────

class TestMembershipIdempotency:
    def test_add_creator_member_twice_does_not_raise(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))

        db.add_house_creator_member(house_id, str(creator["id"]))
        db.add_house_creator_member(house_id, str(creator["id"]))  # no raise expected

        with db._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM house_creator_members WHERE house_id = %s", (house_id,)
                )
                assert cur.fetchone()[0] == 1

    def test_remove_creator_member_twice_does_not_raise(self, make_user, make_house):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        db.add_house_creator_member(house_id, str(creator["id"]))

        db.remove_house_creator_member(house_id, str(creator["id"]))
        db.remove_house_creator_member(house_id, str(creator["id"]))  # no raise expected

    def test_add_video_member_twice_does_not_raise(self, make_user, make_house, make_video):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(creator["id"]), overall_status="approved")

        db.add_house_video_member(house_id, video_id)
        db.add_house_video_member(house_id, video_id)  # no raise expected

    def test_remove_video_member_twice_does_not_raise(self, make_user, make_house, make_video):
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.add_house_video_member(house_id, video_id)

        db.remove_house_video_member(house_id, video_id)
        db.remove_house_video_member(house_id, video_id)  # no raise expected


# ── main.py: routes (TestClient, no network) ──────────────────────────────────
# Imported lazily inside this section (not at module scope) since app.main
# calls db._ensure_schema() at import time and wires up real dependencies —
# consistent with why test_decision_engine.py avoids importing app.main at
# all for its pure-logic tests. Here we DO want the live DB, so it's safe.

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


class TestUpgradeValidation:
    """POST /auth/upgrade's new department validation (KTD1's precondition
    note): reject any department value that isn't an exact DEPARTMENTS match."""

    def test_valid_exact_match_succeeds(self, client, jwt_secret, make_user):
        user = make_user("Viewer")
        token = _token_for(str(user["id"]), jwt_secret)

        resp = client.post(
            "/auth/upgrade", json={"department": "Editing"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        assert resp.json()["user"]["department"] == "Editing"
        assert resp.json()["user"]["account_type"] == "creator"

    def test_case_mismatch_rejected(self, client, jwt_secret, make_user):
        user = make_user("Viewer")
        token = _token_for(str(user["id"]), jwt_secret)

        resp = client.post(
            "/auth/upgrade", json={"department": "editing"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 400

    def test_whitespace_padded_rejected(self, client, jwt_secret, make_user):
        user = make_user("Viewer")
        token = _token_for(str(user["id"]), jwt_secret)

        resp = client.post(
            "/auth/upgrade", json={"department": " Editing "},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 400

    def test_unknown_department_rejected(self, client, jwt_secret, make_user):
        user = make_user("Viewer")
        token = _token_for(str(user["id"]), jwt_secret)

        resp = client.post(
            "/auth/upgrade", json={"department": "Not A Real Department"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 400

        # Confirm the bad value was never written — account_type stays viewer.
        reloaded = db.get_user_by_id(str(user["id"]))
        assert reloaded["account_type"] == "viewer"


class TestHouseRoutes:
    def test_create_house_as_creator_succeeds(self, client, jwt_secret, make_user):
        owner = make_user("Owner", as_creator=True)
        token = _token_for(str(owner["id"]), jwt_secret)

        resp = client.post(
            "/houses", json={"name": "Route Test House", "description": "d"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["owner_id"] == str(owner["id"])

        db.delete_house(body["id"])  # cleanup (not covered by make_house fixture)

    def test_create_house_as_viewer_returns_403(self, client, jwt_secret, make_user):
        viewer = make_user("Viewer")  # not upgraded to creator
        token = _token_for(str(viewer["id"]), jwt_secret)

        resp = client.post(
            "/houses", json={"name": "Should Fail"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 403

    def test_delete_house_by_non_owner_returns_403(
        self, client, jwt_secret, make_user, make_house
    ):
        owner = make_user("Owner", as_creator=True)
        intruder = make_user("Intruder", as_creator=True)
        house_id = make_house(str(owner["id"]))
        token = _token_for(str(intruder["id"]), jwt_secret)

        resp = client.delete(
            f"/houses/{house_id}", headers={"Authorization": f"Bearer {token}"}
        )

        assert resp.status_code == 403

    def test_add_member_by_non_owner_returns_403(
        self, client, jwt_secret, make_user, make_house
    ):
        owner = make_user("Owner", as_creator=True)
        intruder = make_user("Intruder", as_creator=True)
        other = make_user("Other", as_creator=True)
        house_id = make_house(str(owner["id"]))
        token = _token_for(str(intruder["id"]), jwt_secret)

        resp = client.post(
            f"/houses/{house_id}/members/creators/{other['id']}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 403

    def test_owner_gated_route_against_missing_house_returns_404(
        self, client, jwt_secret, make_user
    ):
        owner = make_user("Owner", as_creator=True)
        token = _token_for(str(owner["id"]), jwt_secret)

        resp = client.delete(
            "/houses/not-a-real-house-id", headers={"Authorization": f"Bearer {token}"}
        )

        assert resp.status_code == 404

    def test_get_houses_lists_builtin_departments(self, client):
        resp = client.get("/houses")

        assert resp.status_code == 200
        body = resp.json()
        names = [d["name"] for d in body["builtIn"]]
        assert names == DEPARTMENTS

    def test_house_feed_route_runs_enrich_job_id_present(
        self, client, make_user, make_house, make_video
    ):
        """Confirms _enrich() reuse end-to-end through the route layer: a raw
        db.py row has '_id', never 'job_id' — if the route forgot to enrich,
        this key would be missing/None and video_url would be absent."""
        owner = make_user("Owner", as_creator=True)
        creator = make_user("Creator", as_creator=True, department="Editing")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.add_house_creator_member(house_id, str(creator["id"]))

        resp = client.get(f"/houses/{house_id}/feed")

        assert resp.status_code == 200
        videos = resp.json()["videos"]
        assert len(videos) == 1
        assert videos[0]["job_id"] == video_id
        assert "_id" not in videos[0]
        assert "video_url" in videos[0]

    def test_department_feed_route_runs_enrich_job_id_present(
        self, client, make_user, make_video
    ):
        creator = make_user("Creator", as_creator=True, department="Production Design")
        video_id = make_video(str(creator["id"]), overall_status="approved")

        resp = client.get("/houses/department/Production Design/feed")

        assert resp.status_code == 200
        videos = resp.json()["videos"]
        assert any(v["job_id"] == video_id for v in videos)
        assert all("_id" not in v for v in videos)

    def test_video_member_add_no_ownership_check_ktd2a(
        self, client, jwt_secret, make_user, make_house, make_video
    ):
        """Route-level confirmation of KTD2a: POST .../members/videos/{id}
        succeeds for a video owned by a creator who has nothing to do with
        the House or its owner — no 403, no video-ownership check at all."""
        owner = make_user("Owner", as_creator=True, department="Cinematography")
        unrelated_creator = make_user("Unrelated", as_creator=True, department="Acting")
        house_id = make_house(str(owner["id"]))
        video_id = make_video(str(unrelated_creator["id"]), overall_status="approved")
        token = _token_for(str(owner["id"]), jwt_secret)

        resp = client.post(
            f"/houses/{house_id}/members/videos/{video_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        feed = client.get(f"/houses/{house_id}/feed").json()["videos"]
        assert any(v["job_id"] == video_id for v in feed)
