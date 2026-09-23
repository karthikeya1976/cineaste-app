"""
Integration tests for the feed ranking rework: per-video/per-user credit
toggling (backend/app/db.py's video_credits functions), the weighted
ranking score in get_feed, and "not interested" video dismissal.

Follows tests/test_houses.py's pattern exactly (live-DB integration tests,
skipped without POSTGRES_URL) — the ranking SQL (recency decay, join
fan-out on credits/comments) is exactly the kind of thing a mock would
paper over.

Requires a live Postgres reachable via POSTGRES_URL:

    POSTGRES_URL=postgresql://postgres:redactor123@localhost:5434/video_moderation \
        pytest tests/test_feed_ranking.py -v
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
        owner = db.get_user_by_id(owner_id)
        if owner and owner.get("department"):
            db.set_video_department_tags(video_id, owner["department"], [])
        created_ids.append(video_id)
        return video_id

    yield _make

    with db._connect() as conn:
        with conn.cursor() as cur:
            for vid in created_ids:
                cur.execute("DELETE FROM videos WHERE id = %s", (vid,))


# ── db.py: toggle_video_credit ────────────────────────────────────────────────

class TestToggleVideoCredit:
    def test_first_credit_marks_credited_true(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]))

        result = db.toggle_video_credit(video_id, str(viewer["id"]))

        assert result == {"credited": True, "credits": 1}

    def test_second_toggle_uncredits(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]))
        db.toggle_video_credit(video_id, str(viewer["id"]))

        result = db.toggle_video_credit(video_id, str(viewer["id"]))

        assert result == {"credited": False, "credits": 0}

    def test_multiple_users_credit_same_video(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        v1 = make_user("Viewer1")
        v2 = make_user("Viewer2")
        video_id = make_video(str(creator["id"]))

        db.toggle_video_credit(video_id, str(v1["id"]))
        result = db.toggle_video_credit(video_id, str(v2["id"]))

        assert result == {"credited": True, "credits": 2}

    def test_one_user_credit_is_deduplicated_not_additive(self, make_user, make_video):
        """Calling toggle twice in a row (credit, un-credit) never produces
        more than 1 credit for a single user — confirms the PK on
        (video_id, user_id) is what actually enforces this, not just app logic."""
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]))

        db.toggle_video_credit(video_id, str(viewer["id"]))  # credit
        db.toggle_video_credit(video_id, str(viewer["id"]))  # un-credit
        result = db.toggle_video_credit(video_id, str(viewer["id"]))  # credit again

        assert result == {"credited": True, "credits": 1}


class TestGetVideoCreditState:
    def test_returns_true_after_crediting(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]))
        db.toggle_video_credit(video_id, str(viewer["id"]))

        assert db.get_video_credit_state(video_id, str(viewer["id"])) is True

    def test_returns_false_for_uncredited_video(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]))

        assert db.get_video_credit_state(video_id, str(viewer["id"])) is False

    def test_one_users_credit_does_not_affect_anothers_state(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        v1 = make_user("Viewer1")
        v2 = make_user("Viewer2")
        video_id = make_video(str(creator["id"]))
        db.toggle_video_credit(video_id, str(v1["id"]))

        assert db.get_video_credit_state(video_id, str(v1["id"])) is True
        assert db.get_video_credit_state(video_id, str(v2["id"])) is False


class TestGetEngagementCountsForVideos:
    def test_batch_fetch_returns_credit_and_comment_counts(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        v1 = make_user("Viewer1")
        v2 = make_user("Viewer2")
        video_id = make_video(str(creator["id"]))
        db.toggle_video_credit(video_id, str(v1["id"]))
        db.toggle_video_credit(video_id, str(v2["id"]))
        db.add_comment(video_id, "nice work", str(v1["id"]))

        result = db.get_engagement_counts_for_videos([video_id])

        assert result[video_id] == {"credits": 2, "comments": 1}

    def test_video_with_no_engagement_returns_zeros(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        video_id = make_video(str(creator["id"]))

        result = db.get_engagement_counts_for_videos([video_id])

        assert result[video_id] == {"credits": 0, "comments": 0}

    def test_empty_input_returns_empty_dict(self):
        assert db.get_engagement_counts_for_videos([]) == {}

    def test_counts_are_independent_per_video(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        v1 = make_video(str(creator["id"]))
        v2 = make_video(str(creator["id"]))
        db.toggle_video_credit(v1, str(viewer["id"]))

        result = db.get_engagement_counts_for_videos([v1, v2])

        assert result[v1]["credits"] == 1
        assert result[v2]["credits"] == 0


# ── db.py: dismiss_video ──────────────────────────────────────────────────────

class TestDismissVideo:
    def test_dismissed_video_excluded_from_recommended_bucket(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]), overall_status="approved")

        feed_before = db.get_feed(50, str(viewer["id"]))
        assert video_id in [v["_id"] for v in feed_before["recommended"]]

        db.dismiss_video(str(viewer["id"]), video_id)
        feed_after = db.get_feed(50, str(viewer["id"]))

        assert video_id not in [v["_id"] for v in feed_after["recommended"]]

    def test_dismissed_video_excluded_from_enrouted_bucket_too(self, make_user, make_video):
        """A dismissed video from a FOLLOWED creator must also disappear —
        dismissal is a stronger, more explicit signal than a follow."""
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        db.follow_user(str(viewer["id"]), str(creator["id"]))
        video_id = make_video(str(creator["id"]), overall_status="approved")

        db.dismiss_video(str(viewer["id"]), video_id)
        feed = db.get_feed(50, str(viewer["id"]))

        assert video_id not in [v["_id"] for v in feed["enrouted"]]
        assert video_id not in [v["_id"] for v in feed["recommended"]]

    def test_dismissal_is_per_user_not_global(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        v1 = make_user("Viewer1")
        v2 = make_user("Viewer2")
        video_id = make_video(str(creator["id"]), overall_status="approved")

        db.dismiss_video(str(v1["id"]), video_id)

        feed_v1 = db.get_feed(50, str(v1["id"]))
        feed_v2 = db.get_feed(50, str(v2["id"]))
        assert video_id not in [v["_id"] for v in feed_v1["recommended"]]
        assert video_id in [v["_id"] for v in feed_v2["recommended"]]

    def test_dismiss_twice_does_not_raise(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]))

        db.dismiss_video(str(viewer["id"]), video_id)
        db.dismiss_video(str(viewer["id"]), video_id)  # no raise expected

    def test_logged_out_viewer_sees_undismissed_feed(self, make_user, make_video):
        """viewer_id=None (logged out) has no dismissal history to exclude —
        confirms the query doesn't error or behave strangely with no viewer."""
        creator = make_user("Creator", as_creator=True)
        video_id = make_video(str(creator["id"]), overall_status="approved")

        feed = db.get_feed(50, None)

        assert video_id in [v["_id"] for v in feed["recommended"]]


# ── db.py: get_feed ranking score ─────────────────────────────────────────────

class TestFeedRankingScore:
    def test_more_credited_video_ranks_above_uncredited_newer_video(
        self, make_user, make_video
    ):
        """The core fix: an older, well-credited video should be able to
        outrank a brand-new, uncredited one — this was impossible under the
        old u.credits-DESC-then-recency sort whenever the creators differed,
        since it sorted by CREATOR lifetime credits, not video quality."""
        creator = make_user("Creator", as_creator=True)
        viewers = [make_user(f"Viewer{i}") for i in range(5)]
        older_popular = make_video(str(creator["id"]), overall_status="approved", filename="older.mp4")
        newer_unpopular = make_video(str(creator["id"]), overall_status="approved", filename="newer.mp4")

        for v in viewers:
            db.toggle_video_credit(older_popular, str(v["id"]))

        feed = db.get_feed(50, None)
        ids_in_order = [v["_id"] for v in feed["recommended"]]

        assert ids_in_order.index(older_popular) < ids_in_order.index(newer_unpopular)

    def test_comments_also_contribute_to_ranking(self, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        commenter = make_user("Commenter")
        commented_video = make_video(str(creator["id"]), overall_status="approved", filename="commented.mp4")
        quiet_video = make_video(str(creator["id"]), overall_status="approved", filename="quiet.mp4")

        for i in range(5):
            db.add_comment(commented_video, f"comment {i}", str(commenter["id"]))

        feed = db.get_feed(50, None)
        ids_in_order = [v["_id"] for v in feed["recommended"]]

        assert ids_in_order.index(commented_video) < ids_in_order.index(quiet_video)

    def test_zero_engagement_videos_still_rank_by_recency(self, make_user, make_video):
        """With no credits/comments on either video, the score reduces to
        pure recency decay — confirms COALESCE handles the no-engagement
        case correctly rather than erroring on NULL from the LEFT JOINs."""
        creator = make_user("Creator", as_creator=True)
        older = make_video(str(creator["id"]), overall_status="approved", filename="older.mp4")
        newer = make_video(str(creator["id"]), overall_status="approved", filename="newer.mp4")

        feed = db.get_feed(50, None)
        ids_in_order = [v["_id"] for v in feed["recommended"]]

        assert ids_in_order.index(newer) < ids_in_order.index(older)

    def test_enrouted_bucket_stays_purely_chronological(self, make_user, make_video):
        """Confirms the enrouted (followed-creator) bucket is deliberately
        NOT re-ranked by the engagement score — a follow means 'show me
        everything from this creator', so heavy engagement on an older post
        must not bury a brand-new one from the same followed creator."""
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        other_viewers = [make_user(f"Other{i}") for i in range(5)]
        db.follow_user(str(viewer["id"]), str(creator["id"]))

        older_popular = make_video(str(creator["id"]), overall_status="approved", filename="older.mp4")
        newer_unpopular = make_video(str(creator["id"]), overall_status="approved", filename="newer.mp4")
        for v in other_viewers:
            db.toggle_video_credit(older_popular, str(v["id"]))

        feed = db.get_feed(50, str(viewer["id"]))
        ids_in_order = [v["_id"] for v in feed["enrouted"]]

        assert ids_in_order.index(newer_unpopular) < ids_in_order.index(older_popular)


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


class TestCreditRoute:
    def test_credit_requires_auth(self, client, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        video_id = make_video(str(creator["id"]))

        resp = client.post(f"/videos/{video_id}/credit")

        assert resp.status_code == 401

    def test_credit_toggles_and_returns_state(self, client, jwt_secret, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]))
        token = _token_for(str(viewer["id"]), jwt_secret)

        resp1 = client.post(f"/videos/{video_id}/credit", headers={"Authorization": f"Bearer {token}"})
        assert resp1.status_code == 200
        assert resp1.json() == {"credited": True, "credits": 1}

        resp2 = client.post(f"/videos/{video_id}/credit", headers={"Authorization": f"Bearer {token}"})
        assert resp2.json() == {"credited": False, "credits": 0}

    def test_feed_route_reflects_viewers_own_credit_state(
        self, client, jwt_secret, make_user, make_video
    ):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        token = _token_for(str(viewer["id"]), jwt_secret)
        client.post(f"/videos/{video_id}/credit", headers={"Authorization": f"Bearer {token}"})

        resp = client.get(f"/feed?token={token}")

        row = next(v for v in resp.json()["recommended"] if v["job_id"] == video_id)
        assert row["credited"] is True
        assert row["credit_count"] == 1

    def test_feed_route_credited_false_for_logged_out(self, client, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        video_id = make_video(str(creator["id"]), overall_status="approved")

        resp = client.get("/feed")

        row = next(v for v in resp.json()["recommended"] if v["job_id"] == video_id)
        assert row["credited"] is False


class TestDismissRoute:
    def test_dismiss_requires_auth(self, client, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        video_id = make_video(str(creator["id"]))

        resp = client.post(f"/videos/{video_id}/dismiss")

        assert resp.status_code == 401

    def test_dismiss_removes_video_from_subsequent_feed_fetch(
        self, client, jwt_secret, make_user, make_video
    ):
        creator = make_user("Creator", as_creator=True)
        viewer = make_user("Viewer")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        token = _token_for(str(viewer["id"]), jwt_secret)

        resp = client.post(f"/videos/{video_id}/dismiss", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json() == {"dismissed": True}

        feed = client.get(f"/feed?token={token}").json()
        assert video_id not in [v["job_id"] for v in feed["recommended"]]


class TestCreatorProfileCreditsIsLive:
    def test_profile_credits_reflects_video_credits_not_frozen_column(
        self, client, make_user, make_video
    ):
        """Confirms get_creator_profile's 'credits' field is the live sum of
        video_credits, not the old u.credits column (which toggle_video_credit
        never writes to — see its module comment)."""
        creator = make_user("Creator", as_creator=True)
        v1 = make_user("Viewer1")
        v2 = make_user("Viewer2")
        video_id = make_video(str(creator["id"]), overall_status="approved")
        db.toggle_video_credit(video_id, str(v1["id"]))
        db.toggle_video_credit(video_id, str(v2["id"]))

        resp = client.get(f"/creators/{creator['id']}")

        assert resp.status_code == 200
        assert resp.json()["credits"] == 2

    def test_profile_credits_sums_across_multiple_videos(self, client, make_user, make_video):
        creator = make_user("Creator", as_creator=True)
        v1 = make_user("Viewer1")
        video_a = make_video(str(creator["id"]), overall_status="approved", filename="a.mp4")
        video_b = make_video(str(creator["id"]), overall_status="approved", filename="b.mp4")
        db.toggle_video_credit(video_a, str(v1["id"]))
        db.toggle_video_credit(video_b, str(v1["id"]))

        resp = client.get(f"/creators/{creator['id']}")

        assert resp.json()["credits"] == 2
