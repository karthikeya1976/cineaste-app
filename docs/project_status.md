# Project Status — Editor Club

## Phase 0: Environment Setup ✅
- [x] Python 3.11+ installed and verified (3.12.10)
- [x] Node.js / npm verified (v24.15.0 / 11.12.1)
- [x] Docker / docker compose verified
- [x] Project repo initialized with docs scaffold

## Milestone 1–3: Pipeline, Moderation, Dashboard ✅
- [x] FastAPI gateway with upload + status endpoints
- [x] Celery + Redis async task queue
- [x] Four moderation pillars (adult content, AI/deepfake, duplicate, filmmaking relevance)
- [x] Decision engine: approved / flagged / blocked
- [x] PostgreSQL for job persistence

## Milestone 4: v2 Architecture ✅
- [x] PostgreSQL replaces MongoDB; S3 replaces local disk
- [x] `decision_engine.py` (renamed from `aggregator.py`)
- [x] E2E tests updated and passing

## Redactor MVP (2026-09-08) ✅
- [x] JWT auth: register, login, upgrade viewer → creator
- [x] `users` table with `account_type`, `department`, `credits`
- [x] Creator-gated upload (`POST /videos` requires Creator JWT)
- [x] S3 video storage via boto3 + IAM instance profile
- [x] Real moderation APIs: Sightengine (nudity + deepfake), AWS Rekognition (filmmaking relevance)
- [x] SHA-256 duplicate detection pillar
- [x] Dark-theme frontend redesign (selenium blue, `#0a0a0f` bg)
- [x] Collapsible vertical sidebar

## AWS Deployment (2026-09-09) ✅
- [x] CloudFormation stack: VPC, subnets, IGW, security groups
- [x] RDS PostgreSQL 15 (db.t3.micro)
- [x] ElastiCache Redis (cache.t3.micro)
- [x] EC2 t3.small (Amazon Linux 2023)
- [x] Nginx + Let's Encrypt TLS via DuckDNS (`redactor-api.duckdns.org`)
- [x] Systemd services: `redactor-api` + `redactor-celery` (auto-restart)
- [x] Frontend deployed to Vercel (`https://distributed-video-moderation.vercel.app`)
- [x] End-to-end verified: register → login → upload → S3 → Celery → RDS → feed

## Editor Club — Social Features (2026-09-10) ✅

### Feed
- [x] Smart feed algorithm: `{enrouted, recommended}` buckets
  - Enrouted = videos from followed creators, ordered by recency
  - Recommended = all others, ordered by `creator.credits DESC, created_at DESC`
- [x] Section dividers in feed (`Following` / `Recommended`)
- [x] Swipe navigation: drag up/down on the reel card (mouse + touch); tap to pause
- [x] Arrow keys still work alongside swipe
- [x] S3 presigned URLs for in-browser video streaming

### Upload
- [x] Format toggle: **Scene** (landscape 16:9) vs **Shot** (portrait 9:16)
- [x] Drop zone shape matches selected format aspect ratio
- [x] Moderation result shown inline after upload (pillar score bars + reasons)

### Credits
- [x] `users.credits` integer column (incremented per-video by any viewer)
- [x] `POST /videos/{id}/credit` endpoint
- [x] Star button in feed with live count display

### Follow / Enroute
- [x] `follows` table: `(follower_id, following_id)` primary key
- [x] `POST /creators/{id}/follow` and `DELETE /creators/{id}/follow`
- [x] Enroute/Deroute button in feed overlay (creator info bar)
- [x] Enroute/Deroute button on creator profile page
- [x] Enroute/Deroute button in search results

### Comments
- [x] `comments` table: `(id, video_id, user_id, body, created_at)`
- [x] `GET /videos/{id}/comments` and `POST /videos/{id}/comments`
- [x] Comment drawer in feed: fetches on open, posts with author attribution
- [x] Author name + initials shown per comment

### Search
- [x] `GET /search?q=` — ILIKE across creator names, departments, video filenames
- [x] Debounced search (400ms) via `useEffect` + `useRef` timer
- [x] Error state (API unreachable), no-results state, animated loading dots
- [x] Clear button (×) in search input
- [x] Creator results: clickable name → profile, Enroute/Deroute button
- [x] Video results: filename, creator, moderation status chip

### Creator Profile
- [x] `/creators/[id]` page: avatar (initials), name, department, CREATOR chip
- [x] Stat tiles: follower count, video count, credits
- [x] Enroute/Deroute with optimistic update + revert on error
- [x] Back button

### NavBar / Branding
- [x] Logo: "EC" collapsed → "Editor Club" expanded (with home link)
- [x] Nav items: Home (`/feed`), Search (`/search`), Upload (`/upload`, creator only)
- [x] Profile pinned to bottom slot; logout only on `/profile`

### Bug Fixes
- [x] Same-origin proxy (`next.config.ts`) eliminates mixed-content HTTPS→HTTP block
- [x] `isDivider(undefined)` crash at Next.js build time fixed (null guard)
- [x] `videos.user_id::uuid` JOIN cast fixed (EC2 schema has UUID type, not TEXT)
- [x] `_CREATE_COMMENTS_TABLE` split into two separate `execute()` calls (psycopg2 single-statement limit)

### Repo Health Tooling
- [x] `scripts/scan-repo.py`: 6-check scanner (secrets, dead code, .env drift, stale docs, TODOs)
- [x] `.git/hooks/pre-commit`: auto-runs scanner before every commit; blocks on critical issues, warns on non-blocking ones; Windows-compatible (shell script, not Python shebang)

### CI/CD: PR Review Bot & Test Infrastructure (2026-09-10)
- [x] `tests/test_decision_engine.py`: 14 unit tests, pure-logic (no DB) — every threshold branch covered
- [x] `frontend/lib/auth.test.ts`: 5 Vitest tests for auth localStorage helpers
- [x] `npm run lint` / `npm run typecheck` — both 100% clean, zero baseline exceptions
- [x] `.github/workflows/pr-review-bot.yml`: lint-typecheck + artifact-scan + regression-tests → auto-merge on all-green
- [x] `.github/workflows/update-baseline.yml`: refreshes `.ci/baseline-results.json` after every merge to `main`
- [x] `scripts/verify_artifacts.py`: validates Next.js build output against its own routes manifest
- [x] `scripts/compare_baseline.py` + `generate_baseline.py`: JUnit-based regression diffing
- [x] `scripts/review_bot.py`: decision logic — merges only if every required job is exactly `success`
- [x] `scripts/spawn-agent-worktree.sh`: isolated git worktree + branch per agent/task, own npm/pip install
- [x] `scripts/setup_branch_protection.sh` applied to the live repo — `main` now requires the 3 PR-bot status checks before merge; direct `git push` to `main` is rejected (`GH006: Protected branch update failed`), confirmed firsthand during doc updates on 2026-09-22. All work since lands via PR + auto-merge.
- [x] `BOT_PAT` repo secret configured (2026-09-11) — decision job can now comment/merge PRs

## Messenger Channel Fixes (2026-09-19 – 2026-09-21) ✅
- [x] Nav restructure: removed the New Message / Requests / Conversations tab bar; `/messages` redirects to `/messages/conversations` (default landing page), which gains a New Requests link with pending count and a New message button. Compose/search moved to `/messages/compose`.
- [x] `nav-bar.tsx` Messages-link fallback (requests vs. conversations by badge state) re-scoped to the Messages item only — a prior version applied it to every nav item's `href`, which silently made Home/Search no-op while already on a `/messages/*` page (found and fixed via scripted browser repro, PR #27)
- [x] Per-message timestamps and day separators in the thread view (`DaySeparator.tsx`, `lib/messageDayGroups.ts`)
- [x] Message action menus: received messages get Copy/Reply/Report, sent get Edit/Reply/Copy (`MessageActionMenu.tsx`), each wired to a real action; menu trigger positioning fixed to render after the message bubble, not before (PR #25)
- [x] Duplicate-channel prevention (`idx_chat_requests_one_pending` partial unique index, oracle-denial-preserving) — confirmed already correct on the backend, not rebuilt
- [x] Abusive first-message handling changed from silent-drop to a visible `OffensiveBanner.tsx` in the recipient's requests inbox in place of the decrypted text — sender-side response stays non-distinguishing (oracle-denial preserved); the chat request row is now created (piggybacking on the existing `chat_requests.scan_verdict='abusive'` value) rather than dropped
- [x] Blocked users list under Settings → Privacy (`/settings/privacy`, PR #26)
- [x] Supporting pure-logic modules + tests: `lib/clipboard.ts`, `lib/messageSupersession.ts`, `lib/offensiveContent.ts`, `lib/pendingOutboundRequests.ts`

## Feed Redesign: Horizontal Swipe + Long-Press Thumbnail Picker (2026-09-21 – 2026-09-22) ✅
- [x] Full replacement of vertical swipe-up/down with horizontal swipe/flick — single-card index architecture (`current`/`items`) reused unchanged, only the gesture axis and animation are new (PR #28)
- [x] Tap/swipe/long-press gesture classification extracted to pure, unit-tested `lib/gestureClassifier.ts` (no component-render harness in this repo — matches the `messageDayGroups.ts` precedent)
- [x] Long-press (3s hold) opens `ThumbnailStrip.tsx` — windowed horizontal thumbnail strip (own `VideoThumbnail.tsx` pool, `<video preload="metadata" muted>`, never touching the main player) for jumping directly to any video; selecting one closes the strip
- [x] Live drag-follow: card tracks the pointer 1:1 during drag (zero-transition), then animates a commit-and-exit or snap-back-to-center on release instead of an instant cut (PR #29)
- [x] Velocity-based flick detection: a fast short drag advances even under the 40px distance threshold, tracked live move-to-move rather than at the final move-to-pointerup gap (which undercounts real flicks due to lift latency — found via real-browser timestamp logging, PR #30)
- [x] All gesture/windowing logic verified via Vitest (`gestureClassifier.test.ts`, `feedItems.test.ts`) and real-browser Playwright checks (temporary installs, cleaned up after each PR)

## Pending / Future
- [ ] Creator profile: list their approved videos inline
- [ ] Notifications for new followers and credits received
- [ ] Saved videos (bookmark persisted to DB, not just local state)
- [ ] CloudFormation UserData fully automated (no manual `pip install` step)
- [ ] Remove `/debug/feed` and `/debug/search` endpoints before public launch
