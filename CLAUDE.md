# Misence

A filmmaker discovery platform with AI-powered video moderation.  
FastAPI + Celery + Redis + PostgreSQL backend on AWS EC2.  
Next.js 16 frontend on Vercel.

---

## Area 1: Project Goals

- Build a working version of the "Distributed Video Moderation System" from the resume — demonstrable and explainable end-to-end.
- Creators upload scenes and shots; a distributed pipeline checks for nudity, AI-generated content, duplicates, and filmmaking relevance before content appears in the public reel feed.
- Social layer: viewers follow creators (Enroute/Deroute), give credits, comment, and discover content through a smart feed and search.
- Deployed on real AWS infrastructure (EC2, RDS, ElastiCache, S3) with real moderation APIs (Sightengine, AWS Rekognition).

---

## Area 2: Architecture Overview

```
[Next.js — Vercel HTTPS]
      │ /api/backend/* (same-origin rewrite → redactor-api.duckdns.org)
      ▼
[Nginx + Let's Encrypt — EC2]
      ▼
[FastAPI — :8088]
  ├── Auth:    /auth/register  /auth/login  /auth/upgrade
  ├── Video:   POST /videos  GET /videos/{id}/status
  ├── Feed:    GET /feed  (enrouted + recommended buckets)
  ├── Social:  /creators/*  /search  /videos/{id}/comments  /videos/{id}/credit
      │
      │ Redis queue (Celery)
      ▼
[Celery Worker]
  ├── adult_content    (Sightengine nudity-2.1)
  ├── ai_deepfake      (Sightengine genai)
  ├── duplicate_content (SHA-256 S3 hash)
  └── filmmaking_relevance (AWS Rekognition DetectLabels)
      │
      ▼
[Decision Engine] → approved / flagged / blocked
      │
      ▼
[RDS PostgreSQL] — videos, users, follows, comments
```

Full design: `docs/architecture.md`  
Threshold rules: `docs/moderation_policies.md`

---

## Area 3: Design Style Guide

- **Backend**: small single-purpose modules. `main.py` routes only — business logic in `db.py`, `storage.py`, `decision_engine.py`, `tasks.py`.
- **Pillars**: each exposes `async def check(job_id: str) -> dict` returning `{"pillar", "score", "flags"}` — swappable without touching orchestration.
- **Frontend**: Next.js App Router, Tailwind CSS, inline styles for component-specific overrides. No shadcn/ui (removed). CSS variables for theming (`--fg`, `--bg`, `--surface`, `--accent`, `--border`).
- **API calls**: all use `/api/backend` prefix — routed through `next.config.ts` rewrite, never direct to EC2 IP.
- **Auth**: JWT passed as `?token=<jwt>` on GET endpoints (avoids CORS preflight); `Authorization: Bearer` on POST/DELETE.
- No premature abstraction — add retries, webhooks, rate-limiting only when a real need arises.

---

## Area 4: Constraints & Policies

- **Real APIs**: Sightengine (nudity + deepfake), AWS Rekognition (filmmaking). SHA-256 for duplicate detection.
- **AWS infra**: EC2 t3.small (Amazon Linux 2023), RDS PostgreSQL 15, ElastiCache Redis, S3 `amzn-s3-bucket-dvm`.
- **EC2 runs as `ssm-user`**: no SSH key, access via AWS Session Manager. Repo lives at `/app`, owned by root — use `sudo git -C /app pull`.
- **Systemd services**: `redactor-api` and `redactor-celery`. Restart both after any backend change: `sudo systemctl restart redactor-api redactor-celery`.
- **No `.env` committed**: credentials in `.env` (gitignored). EC2 reads from systemd `EnvironmentFile`. See `.env.example` for required vars.
- **Local dev ports**: API 8088, Redis 6380, PostgreSQL 5434.
- **Frontend proxy**: `next.config.ts` rewrites `/api/backend/*` → `https://redactor-api.duckdns.org/*` on Vercel, `http://localhost:8088/*` locally.

---

## Area 5: Repository Etiquette

- Commit on logical feature boundaries with a clear message.
- `.gitignore` covers: `backend/venv/`, `node_modules/`, `.next/`, `__pycache__/`, `uploads/`, `frames/`, `.env*`.
- A pre-commit hook (`.git/hooks/pre-commit`) runs `scripts/scan-repo.py` automatically before every `git commit`. It blocks on secrets / `.env.example` drift and warns on dead files / TODOs. Run `python scripts/scan-repo.py --fix` to interactively delete dead files.
- **PRs** run `.github/workflows/pr-review-bot.yml`: lint/typecheck → build+artifact-scan → regression tests vs. baseline → auto-merge if all green. Branch protection is scripted (`scripts/setup_branch_protection.sh`) but **not yet applied** to `main` — run it only when ready to require these checks before every merge.
- **Parallel agent work**: use `scripts/spawn-agent-worktree.sh <task-id> <slug>` to create an isolated git worktree + branch per agent, avoiding shared working-directory/lockfile collisions.
- Update `docs/project_status.md` and `docs/changelog.md` with every significant change.

---

## Area 6: Key Files

| File | Purpose |
|------|---------|
| `backend/app/main.py` | All FastAPI routes |
| `backend/app/db.py` | All SQL queries + schema migrations |
| `backend/app/tasks.py` | Celery task: runs pillars, writes verdict |
| `backend/app/decision_engine.py` | Aggregates pillar scores → verdict |
| `backend/app/storage.py` | S3 upload, presigned URL, cleanup |
| `frontend/lib/api.ts` | Typed client for every backend endpoint |
| `frontend/lib/auth.ts` | JWT localStorage helpers |
| `frontend/next.config.ts` | Same-origin proxy rewrite |
| `frontend/app/feed/page.tsx` | Swipeable reel feed |
| `frontend/app/upload/page.tsx` | Scene/Shot upload with format toggle |
| `scripts/scan-repo.py` | Repo health scanner (dead files, stale docs, secrets) |
| `tests/test_decision_engine.py` | Unit tests for the decision engine (pure logic, no DB) |
| `frontend/lib/auth.test.ts` | Unit tests for auth localStorage helpers |
| `scripts/verify_artifacts.py` | CI: validates Next.js build output isn't corrupted/incomplete |
| `scripts/compare_baseline.py` | CI: blocks PRs only on *new* test regressions vs. `main` |
| `scripts/review_bot.py` | CI: auto-merge decision logic for the PR review bot |
| `scripts/spawn-agent-worktree.sh` | Creates an isolated git worktree + branch per agent/task |
| `.github/workflows/pr-review-bot.yml` | PR pipeline: lint/typecheck → artifact-scan → regression-tests → auto-merge |
| `docs/architecture.md` | System design, feed algorithm, DB schema |
| `docs/moderation_policies.md` | Per-pillar thresholds and aggregation rules |
| `docs/project_status.md` | Milestone tracker (what's done / pending) |
| `docs/changelog.md` | Implementation history |

---

## Area 7: Documentation Update Rule

After any feature, fix, or architectural change:
1. `docs/changelog.md` — append a dated entry
2. `docs/project_status.md` — check off items / add new ones
3. `docs/architecture.md` — if system design or DB schema changed
4. `docs/moderation_policies.md` — if pillar thresholds or logic changed
5. `README.md` — if API surface, setup steps, or interview answers changed

Stale docs = bug. Run `python scripts/scan-repo.py` to detect drift.
