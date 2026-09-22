# Editor Club

**A filmmaker discovery platform with AI-powered video moderation.**

Creators upload scenes and shots; the platform runs them through a distributed moderation pipeline (nudity detection, AI/deepfake detection, duplicate check, filmmaking relevance) before they appear in the public reel feed. Viewers follow creators, give credits, and discover new filmmaking work.

🌐 **Live**: https://distributed-video-moderation.vercel.app  
🔌 **API**: https://redactor-api.duckdns.org

---

## Architecture

```
[Next.js Frontend — Vercel]
        │  HTTPS (proxy: /api/backend/* → redactor-api.duckdns.org)
        ▼
[FastAPI Gateway — EC2 :8088 behind Nginx + Let's Encrypt]
        │  save to S3 → instant ack {task_id}
        ▼
[ElastiCache Redis]  ← task queue
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
              [RDS PostgreSQL — AWS]
                  videos, users, follows, comments
                         │
                         ▼
      [FastAPI social endpoints: /feed, /search, /creators]
                         │
                         ▼
      [Next.js — swipeable reel feed + creator profiles]
```

### Key design decisions
- **Same-origin proxy**: Next.js rewrites `/api/backend/*` → `https://redactor-api.duckdns.org/*` at the Vercel edge — eliminates mixed-content blocks with zero env-var config
- **Pillars are swappable**: each exposes `async def check(job_id) -> dict` — mock vs real API is one file change
- **S3 objects are kept** after processing so the feed streams via presigned URLs
- **Duplicate detection** uses SHA-256 hash — exact-match, zero API cost
- **Filmmaking relevance uses inverse scoring** — low score = off-topic = blocked
- **Smart feed**: enrouted (followed creators) content first, then recommendations ranked by creator credits + recency

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS (light cream theme, peach accent) |
| API Gateway | FastAPI + Uvicorn |
| Task Queue | Celery + Redis (ElastiCache) |
| Storage | AWS S3 (video files + extracted frames) |
| Database | PostgreSQL 15 (RDS) — videos, users, follows, comments |
| Moderation | Sightengine (nudity + deepfake), AWS Rekognition (scene labels) |
| Infra | AWS EC2 t3.small, CloudFormation, Nginx, Let's Encrypt (DuckDNS) |
| Auth | JWT (`python-jose`), bcrypt (`passlib`) |

---

## Pages

| Route | Who | What |
|-------|-----|------|
| `/` | Anyone | Login / register |
| `/feed` | Logged-in | Horizontal-swipe reel feed — drag/flick left-right, tap to pause, long-press (3s) opens a jump-to-video thumbnail strip |
| `/upload` | Creators | Upload a Scene (16:9) or Shot (9:16) for moderation |
| `/profile` | Logged-in | Account card, creator upgrade, settings, logout |
| `/search` | Logged-in | Debounced search for creators and videos |
| `/creators/[id]` | Logged-in | Creator profile: stats, videos, Enroute/Deroute |
| `/settings/privacy` | Logged-in | Blocked users list |
| `/messages/conversations` | Logged-in | Messenger landing page — accepted chat threads |
| `/messages/requests` | Logged-in | Incoming chat requests, including abusive-first-message banners |
| `/messages/compose` | Logged-in | New chat: person search + compose |

---

## Moderation Pillars

| Pillar | API | Threshold | Action |
|--------|-----|-----------|--------|
| `adult_content` | Sightengine nudity-2.1 | score ≥ 0.8 → blocked, ≥ 0.5 → flagged | Only explicit nudity |
| `ai_deepfake` | Sightengine genai | score ≥ 0.7 → flagged | AI-generated / synthetic media |
| `duplicate_content` | SHA-256 S3 hash | score = 1.0 → blocked | Same file already on platform |
| `filmmaking_relevance` | AWS Rekognition DetectLabels | score < 0.3 → blocked | Off-topic content removed |

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | — | Liveness check |
| POST | `/auth/register` | — | Create account |
| POST | `/auth/login` | — | Get JWT token |
| POST | `/auth/upgrade` | JWT | Upgrade viewer → creator |
| POST | `/videos` | JWT (creator) | Upload video for moderation |
| GET | `/videos/{job_id}/status` | — | Poll moderation result |
| GET | `/videos/{job_id}/comments` | — | List comments |
| POST | `/videos/{job_id}/comments` | JWT (query param) | Post a comment |
| POST | `/videos/{job_id}/credit` | — | Give a credit to the creator |
| GET | `/feed` | JWT optional | Smart feed `{enrouted, recommended}` |
| GET | `/search?q=` | — | Search creators + videos |
| GET | `/creators/{id}` | JWT optional | Creator profile + follow state |
| POST | `/creators/{id}/follow` | JWT | Enroute a creator |
| DELETE | `/creators/{id}/follow` | JWT | Deroute a creator |

---

## Database Schema

```sql
users    (id UUID, name, email, password_hash, account_type, department, credits)
videos   (id TEXT, filename, file_path, status, overall_status,
          pillar_results JSONB, reasons JSONB, user_id, created_at, updated_at)
follows  (follower_id UUID, following_id UUID, created_at)  -- PK both columns
comments (id UUID, video_id TEXT, user_id UUID, body, created_at)
```

---

## Local Development

### Prerequisites
Python 3.9+, Node.js 18+, Docker

### 1. Start local infrastructure
```bash
docker compose up -d   # Redis + PostgreSQL
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in: POSTGRES_URL, REDIS_URL, AWS_S3_BUCKET, AWS_S3_REGION,
#          AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
#          SIGHTENGINE_USER, SIGHTENGINE_SECRET, JWT_SECRET
```

### 3. Start the API
```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload
```

### 4. Start a Celery worker
```bash
cd backend
python -m celery -A app.tasks worker --loglevel=info --pool=solo
```

### 5. Start the frontend
```bash
cd frontend
npm install && npm run dev
# No env vars needed — next.config.ts proxies /api/backend/* to localhost:8088
```

Open **http://localhost:3000**

---

## Project Docs
- `docs/architecture.md` — system design and component breakdown
- `docs/moderation_policies.md` — per-pillar thresholds and aggregation rules
- `docs/project_status.md` — milestone tracker
- `docs/changelog.md` — implementation history
- `docs/project_spec.md` — original product specification and roadmap
