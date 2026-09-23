"""
Integration tests for two security fixes (Phase 0 of the security hardening
plan): JWT expiration and the removal of JWT_SECRET's hardcoded fallback.

Follows tests/test_houses.py's pattern (live-DB integration tests, skipped
without POSTGRES_URL) since the startup-failure behavior specifically needs
to import app.main under a controlled environment, which a pure-logic test
can't meaningfully exercise.

Requires a live Postgres reachable via POSTGRES_URL:

    POSTGRES_URL=postgresql://postgres:redactor123@localhost:5434/video_moderation \
        pytest tests/test_auth_security.py -v
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
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


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def run_tag():
    return uuid.uuid4().hex[:8]


@pytest.fixture
def make_user(run_tag):
    created_ids = []

    def _make(name_prefix="User"):
        email = f"{name_prefix.lower()}-{run_tag}-{len(created_ids)}@test.local"
        user = db.create_user(f"{name_prefix} {run_tag}", email, "not-a-real-hash")
        user_id = str(user["id"])
        created_ids.append(user_id)
        return user

    yield _make

    with db._connect() as conn:
        with conn.cursor() as cur:
            for uid in created_ids:
                cur.execute("DELETE FROM users WHERE id = %s::uuid", (uid,))


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from app import main as app_main

    return TestClient(app_main.app)


@pytest.fixture(scope="module")
def jwt_secret():
    from app import main as app_main

    return app_main.JWT_SECRET


def _token_for(user_id: str, jwt_secret: str, exp: "datetime | None" = None) -> str:
    from jose import jwt

    payload = {"sub": user_id}
    if exp is not None:
        payload["exp"] = exp
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


# ── JWT_SECRET startup failure ────────────────────────────────────────────────
# Confirms the hardcoded "dev-secret-change-in-prod" fallback is genuinely
# gone, not just renamed — a misconfigured deploy with JWT_SECRET unset must
# fail loudly at import time, not silently sign every token with a secret
# visible in the app's own source history.

class TestJwtSecretRequired:
    def test_app_import_fails_without_jwt_secret(self, monkeypatch):
        monkeypatch.delenv("JWT_SECRET", raising=False)
        # Force a fresh import of app.main so module-level JWT_SECRET
        # resolution actually re-runs (it's cached in sys.modules otherwise).
        for mod in list(sys.modules):
            if mod == "app.main" or mod.startswith("app.main."):
                del sys.modules[mod]

        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            import app.main  # noqa: F401

    def test_app_import_succeeds_with_jwt_secret_set(self, monkeypatch):
        monkeypatch.setenv("JWT_SECRET", "a-real-test-secret")
        for mod in list(sys.modules):
            if mod == "app.main" or mod.startswith("app.main."):
                del sys.modules[mod]

        import app.main  # noqa: F401 — must not raise

        assert app.main.JWT_SECRET == "a-real-test-secret"


# ── JWT expiration ─────────────────────────────────────────────────────────────

class TestJwtExpiration:
    def test_login_response_token_has_exp_claim(self, client, make_user):
        from jose import jwt as jose_jwt
        from app import main as app_main

        password_hash = app_main.pwd_context.hash("correct-horse-battery-staple")
        with db._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (name, email, password_hash) VALUES (%s, %s, %s) RETURNING id",
                    ("Login Test", "logintest@test.local", password_hash),
                )
                user_id = str(cur.fetchone()[0])

        try:
            resp = client.post(
                "/auth/login",
                json={"email": "logintest@test.local", "password": "correct-horse-battery-staple"},
            )
            assert resp.status_code == 200
            token = resp.json()["access_token"]

            claims = jose_jwt.get_unverified_claims(token)
            assert "exp" in claims
            # exp should be roughly 24h out (JWT_EXPIRY), not decades — a
            # sanity bound so a future regression that sets exp to e.g. the
            # epoch or year 9999 doesn't silently pass this test.
            now = datetime.now(timezone.utc).timestamp()
            assert now < claims["exp"] < now + timedelta(hours=25).total_seconds()
        finally:
            with db._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM users WHERE id = %s::uuid", (user_id,))

    def test_expired_token_rejected_on_protected_route(self, client, jwt_secret, make_user):
        user = make_user("Viewer")
        expired = _token_for(
            str(user["id"]), jwt_secret,
            exp=datetime.now(timezone.utc) - timedelta(hours=1),
        )

        resp = client.post(
            "/auth/upgrade",
            json={"department": "Editing"},
            headers={"Authorization": f"Bearer {expired}"},
        )

        assert resp.status_code == 401

    def test_not_yet_expired_token_accepted(self, client, jwt_secret, make_user):
        user = make_user("Viewer")
        valid = _token_for(
            str(user["id"]), jwt_secret,
            exp=datetime.now(timezone.utc) + timedelta(hours=1),
        )

        resp = client.post(
            "/auth/upgrade",
            json={"department": "Editing"},
            headers={"Authorization": f"Bearer {valid}"},
        )

        assert resp.status_code == 200

    def test_token_with_no_exp_claim_still_accepted(self, client, jwt_secret, make_user):
        """Tokens minted without an exp claim (e.g. by an older client, or
        this test file's own _token_for with exp=None) remain valid per the
        JWT spec — exp is optional, not mandatory, at the decode layer. This
        confirms the fix didn't retroactively invalidate every existing
        session; it only adds an expiry to NEWLY issued tokens going
        forward."""
        user = make_user("Viewer")
        no_exp_token = _token_for(str(user["id"]), jwt_secret)  # exp=None

        resp = client.post(
            "/auth/upgrade",
            json={"department": "Editing"},
            headers={"Authorization": f"Bearer {no_exp_token}"},
        )

        assert resp.status_code == 200
