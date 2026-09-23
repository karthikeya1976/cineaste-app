# Architecture — Editor Club

## System Diagram

```
[Next.js Frontend — Vercel HTTPS]
        │
        │  /api/backend/* (same-origin rewrite)
        ▼
[Vercel Edge — next.config.ts rewrite]
        │
        │  HTTPS proxy → redactor-api.duckdns.org
        ▼
[Nginx reverse proxy — EC2]
        │  TLS termination (Let's Encrypt via DuckDNS)
        ▼
[FastAPI Gateway — EC2 :8088]
  ├── Auth endpoints (/auth/*)
  ├── Upload: save to S3 → instant ack {task_id}
  ├── Social endpoints (/feed, /search, /creators/*)
  └── Comment + credit endpoints
        │
        │  Redis queue (Celery)
        ▼
[ElastiCache Redis]
        │
        ▼
[Celery Worker — EC2]
   │         │           │            │
   ▼         ▼           ▼            ▼
Adult     AI/Deepfake  Duplicate   Filmmaking
Content   (Sightengine) Content    Relevance
(Sightengine)         (SHA-256    (AWS Rekognition)
                       S3 hash)
   └─────────┴───────────┴────────────┘
                         │
                  [Decision Engine]
               approved / flagged / blocked
                         │
                         ▼
              [RDS PostgreSQL 15 — AWS]
         (videos, users, follows, comments tables)
                         │
                         ▼
             [FastAPI GET /feed, /search, etc.]
                         │
                         ▼
         [Next.js — swipeable reel feed + social UI]
```

---

## Components

### Same-Origin Proxy (`frontend/next.config.ts`)
Rewrites all `/api/backend/*` requests to `https://redactor-api.duckdns.org/*`
at the Vercel edge. The browser always calls its own origin (same-origin, no
mixed-content blocks, no CORS preflight). Locally, the rewrite targets
`http://localhost:8088` so no env var is needed in either environment.

### FastAPI Gateway (`backend/app/main.py`)

**Auth**
- `POST /auth/register` — create account (`viewer` by default)
- `POST /auth/login` — returns JWT
- `POST /auth/upgrade` — viewer → creator (requires JWT + department)

**Videos**
- `POST /videos` — Creator JWT required; saves file to S3, creates DB row, enqueues Celery task, returns `{task_id, status: "processing"}` instantly
- `GET /videos/{job_id}/status` — returns full job row including pillar results
- `GET /videos` — list all jobs (admin/debug use)

**Feed & Discovery**
- `GET /feed?token=<jwt>` — returns `{enrouted: Job[], recommended: Job[]}`. Enrouted = approved videos from followed creators ordered by recency. Recommended = all other approved videos ordered by `creator.credits DESC, created_at DESC`. Both buckets include presigned S3 URLs for streaming.
- `GET /search?q=<query>` — ILIKE search over creator names/departments and video filenames; returns `{creators, videos}`
- `GET /creators/{id}?token=<jwt>` — creator profile with follower count, video count, credit total, and `is_following` for the viewer

**Social**
- `POST /creators/{id}/follow` — JWT required; inserts into `follows` table
- `DELETE /creators/{id}/follow` — JWT required; removes follow
- `POST /videos/{job_id}/credit` — increments `users.credits` for the video's creator
- `GET /videos/{job_id}/comments` — list comments newest-first
- `POST /videos/{job_id}/comments?token=<jwt>` — insert comment with optional author attribution

### Storage (`backend/app/storage.py`)
- `save_video(object_name, src_path)` — uploads file to S3 bucket `amzn-s3-bucket-dvm` (us-east-2)
- `get_presigned_url(object_name)` — generates a time-limited S3 URL for streaming
- `cleanup_video(object_name)` — deletes the S3 object after processing (frames are cleaned up separately)

On EC2 with an IAM instance profile, boto3 uses the instance role automatically. No hardcoded credentials needed.

### Database (`backend/app/db.py`)

```sql
-- Core moderation table
videos (
  id             TEXT PRIMARY KEY,   -- UUID, same as Celery task_id
  filename       TEXT,
  file_path      TEXT,               -- s3://bucket/object
  status         TEXT,               -- pending | processing | done
  overall_status TEXT,               -- approved | flagged | blocked
  pillar_results JSONB,
  reasons        JSONB,
  size_bytes     INTEGER,
  user_id        UUID REFERENCES users(id),
  file_hash      TEXT,               -- SHA-256 for duplicate detection
  created_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ
)

-- Auth / social graph
users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,
  email         TEXT UNIQUE,
  password_hash TEXT,
  account_type  TEXT,    -- viewer | creator
  department    TEXT,    -- e.g. "Cinematography"
  credits       INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ
)

-- Follow graph (Enroute/Deroute)
follows (
  follower_id  UUID REFERENCES users(id),
  following_id UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ,
  PRIMARY KEY (follower_id, following_id)
)

-- Comments
comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id   TEXT REFERENCES videos(id),
  user_id    UUID REFERENCES users(id),
  body       TEXT,
  created_at TIMESTAMPTZ
)

-- Custom Houses (curated video collections; built-in department Houses
-- are derived from users.department at query time and have no table)
houses (
  id          TEXT PRIMARY KEY,
  owner_id    UUID REFERENCES users(id),
  name        TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ
)

-- House membership: whole creator catalogs (present + future uploads)
house_creator_members (
  house_id   TEXT REFERENCES houses(id),
  creator_id UUID REFERENCES users(id),
  added_at   TIMESTAMPTZ,
  PRIMARY KEY (house_id, creator_id)
)

-- House membership: individually curated videos, independent of creator
house_video_members (
  house_id   TEXT REFERENCES houses(id),
  video_id   TEXT REFERENCES videos(id),
  added_at   TIMESTAMPTZ,
  PRIMARY KEY (house_id, video_id)
)
```

`_ensure_schema()` runs on every API startup — all `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` are idempotent.

### Task Queue (`backend/app/tasks.py`)
- `process_video(task_id)` Celery task:
  1. Sets `status = "processing"` in DB
  2. Downloads video from S3 to temp file
  3. Extracts 5 frames with OpenCV → uploads to S3
  4. Runs all four pillar checks concurrently (`asyncio.gather`)
  5. Passes results to Decision Engine
  6. Writes final `pillar_results`, `overall_status`, `reasons` to DB; sets `status = "done"`
  7. Cleans up temp file and frame S3 objects

### Moderation Pillars (`backend/app/pillars/`)

Each pillar exposes the same interface:
```python
async def check(job_id: str) -> dict
# → {"pillar": str, "score": float (0–1), "flags": [...]}
```

| File | API | What it checks |
|------|-----|----------------|
| `adult_content.py` | Sightengine nudity-2.1 | Explicit / suggestive imagery |
| `ai_deepfake.py` | Sightengine genai | AI-generated / synthetic video |
| `duplicate_content.py` | SHA-256 of S3 object | Identical file already on platform |
| `filmmaking_relevance.py` | AWS Rekognition DetectLabels | Scene labels match filmmaking vocabulary |

Pillars are swappable: replacing a mock with a real API client means editing one file, not the orchestration code.

### Decision Engine (`backend/app/decision_engine.py`)
Reads all four pillar results, applies thresholds from `docs/moderation_policies.md`:
- Any pillar above its `block` threshold → `blocked`
- Any pillar above its `flag` threshold (or `filmmaking_relevance` below 0.3) → `flagged`
- Otherwise → `approved`

Returns `{overall_status, reasons}` written back to the DB row.

### Frontend (`frontend/`)

**Pages**

| Route | File | Description |
|-------|------|-------------|
| `/` | `app/page.tsx` | Login / register with JWT storage |
| `/feed` | `app/feed/page.tsx` | Horizontal-swipe reel feed — drag/flick left-right or ← → keys; long-press (3s) opens a thumbnail strip to jump directly to any video |
| `/upload` | `app/upload/page.tsx` | Scene (16:9) or Shot (9:16) upload with format toggle |
| `/profile` | `app/profile/page.tsx` | Account info, creator upgrade, settings, logout |
| `/search` | `app/search/page.tsx` | Debounced creator + video search |
| `/creators/[id]` | `app/creators/[id]/page.tsx` | Creator profile with stats and Enroute/Deroute |
| `/settings/privacy` | `app/settings/privacy/page.tsx` | Blocked users list — unblock removes a person from the list without restoring any prior conversation |
| `/messages/conversations` | `app/messages/conversations/page.tsx` | Default landing page for the messenger — accepted chat threads |
| `/messages/requests` | `app/messages/requests/page.tsx` | Incoming chat requests awaiting accept/decline, including abusive-first-message banners in place of the decrypted text |
| `/messages/compose` | `app/messages/compose/page.tsx` | Person search + new-chat compose flow, reached via the Conversations page's "New message" button or a creator profile's Message button |
| `/messages/conversations/[conversationId]` | `app/messages/conversations/[conversationId]/page.tsx` | Thread view — per-message timestamps, day separators, and Copy/Reply/Report (received) or Edit/Reply/Copy (sent) action menus |

`/messages` itself redirects to `/messages/conversations` — there is no longer a standalone tab bar switching between New Message / Requests / Conversations views (removed in favor of landing directly on Conversations, with Requests reachable via a link and a pending-count badge).

**Shared components**
- `components/nav-bar.tsx` — collapsible sidebar: "EC" monogram collapsed, "Editor Club" expanded; Home, Search, Messages (badge dot for pending requests/unread), Upload (creator only), Profile (pinned bottom). The Messages link routes to `/messages/requests` while the badge is visible, `/messages/conversations` otherwise — scoped only to the Messages item, since a past regression once let this fallback apply to every nav item's `href`.
- `components/MessageActionMenu.tsx`, `components/DaySeparator.tsx`, `components/OffensiveBanner.tsx` — thread-view building blocks for U5/U6/U7 of the messenger channel fixes (see Feed Gestures and the changelog for the full list)
- `components/ThumbnailStrip.tsx`, `components/VideoThumbnail.tsx` — the feed's long-press jump-to-video picker (see Feed Gestures below)

**Libraries**
- `lib/api.ts` — typed wrapper for every backend endpoint; all calls use `/api/backend` prefix (same-origin proxy)
- `lib/auth.ts` — localStorage JWT helpers: `getToken`, `setAuth`, `clearAuth`, `isLoggedIn`, `isCreator`

---

## Feed Algorithm

```
GET /feed?token=<jwt>

1. Decode token → viewer_id (optional)
2. If viewer_id:
   enrouted = SELECT videos JOIN follows
              WHERE follower_id = viewer_id
              ORDER BY created_at DESC
3. recommended = SELECT videos
                 WHERE id NOT IN (enrouted_ids)
                 ORDER BY users.credits DESC, videos.created_at DESC
4. Return {enrouted, recommended}
   (both contain presigned S3 video_url)

Frontend merges with section dividers:
  [Following]     ← enrouted bucket (if non-empty)
  video, video, …
  [Recommended]   ← recommended bucket (if non-empty)
  video, video, …
```

---

## Feed Gestures

The feed is a single-card, index-based interface (`current: number` into the
flat `items` array above) — only one `<video>` is ever mounted/playing at a
time. All gesture handling is hand-rolled on top of Pointer Events in
`SwipeCard` (`app/feed/page.tsx`); no gesture/animation/carousel library is
used. Tap, swipe, and long-press share one `onPointerDown` origin and are
disambiguated in `frontend/lib/gestureClassifier.ts` (pure, unit-tested
logic — `classifyPointerUp`, `shouldCancelLongPress`):

- **Tap** — pointer released with no meaningful movement → toggles pause.
- **Swipe** — horizontal drag past `SWIPE_THRESHOLD` (40px), with the
  horizontal delta dominant over the vertical one (an accidental vertical
  scroll attempt must not misfire as a swipe) → advances/retreats `current`.
- **Flick** — a fast short drag that never reaches `SWIPE_THRESHOLD` still
  swipes if its release velocity exceeds `FLICK_VELOCITY_THRESHOLD`
  (0.5px/ms), matching native carousel feel where speed matters as much as
  distance. Velocity is tracked live during `pointermove`, computed
  move-to-move rather than from the last move to `pointerup` — the pointer
  typically sits still for 15-40ms between the last move and the actual
  lift, and measuring over that trailing gap undercounts real flicks.
- **Long-press** — held below the movement tolerance for `LONG_PRESS_MS`
  (3000ms) → pauses the current video and opens `ThumbnailStrip`, a
  windowed horizontally-scrollable strip (own pool of `<video preload=
  "metadata" muted>` elements, never touching the main player's) for
  jumping directly to any video in the feed. Selecting a thumbnail calls
  `setCurrent` directly and closes the strip.

On release past the swipe/flick threshold, the card animates fully
off-screen (`COMMIT_MS`, 200ms) before the navigation callback fires; below
threshold, it eases back to center (`SNAP_BACK_MS`, 220ms) instead of
snapping instantly. Both mouse and touch are driven by the same Pointer
Events handlers, so this behavior is uniform across desktop and mobile.

---

## Infrastructure (AWS)

| Resource | Type | Detail |
|----------|------|--------|
| EC2 | t3.small, Amazon Linux 2023 | API + Celery worker; public IP 18.216.199.64 |
| RDS | PostgreSQL 15, db.t3.micro | `redactor-db.c1qooqeoynjz.us-east-2.rds.amazonaws.com` |
| ElastiCache | Redis, cache.t3.micro | `redactor-redis.5v2cub.0001.use2.cache.amazonaws.com` |
| S3 | `amzn-s3-bucket-dvm` | us-east-2; videos + extracted frames |
| Nginx | EC2 | TLS termination; proxies :443 → :8088 |
| Let's Encrypt | DuckDNS `redactor-api.duckdns.org` | Auto-renewed HTTPS cert |
| Vercel | Next.js | `https://distributed-video-moderation.vercel.app` |

Defined in `infra/cloudformation.yml`. EC2 systemd services: `redactor-api` and `redactor-celery`.

---

## Local Development Topology

```
Browser (localhost:3000)
  └── Next.js dev server
        └── /api/backend/* rewrite → http://localhost:8088
              └── FastAPI (uvicorn, port 8088)
                    ├── PostgreSQL (Docker, host port 5434)
                    └── Redis (Docker, host port 6380)
              └── Celery worker (pool=solo for Windows)
```

No `NEXT_PUBLIC_API_URL` env var needed — `next.config.ts` handles routing in both environments.
