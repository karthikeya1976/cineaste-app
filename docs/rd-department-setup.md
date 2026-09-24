# R&D Department — Setup & What's Left

Scaffolding for the autonomous R&D agent department described in the
published architecture doc (see `docs/changelog.md`'s entry for this
feature for the link and context). This file is the honest status: what's
built and verified, what's built but unverified, and what genuinely
requires the repo owner to do something outside this codebase.

## What's built and fully verified

- `docs/plans/templates/rd-proposal-template.md` — the plan-document
  format a Worker Agent's proposal must follow, matching this repo's
  existing human-authored `docs/plans/*.md` convention (KTDs, Scope
  Boundaries, Implementation Units) plus a Decision Record section.
- `docs/rd-research-log.md` — append-only cycle history, seeded empty.
- `scripts/check_worker_file_scope.py` — enforces "no worker touches a
  file outside its assigned unit's declared file list." Parses a real
  plan document's `**Files:**` sections; verified against this repo's own
  existing `docs/plans/2026-09-22-001-feat-houses-navigation-plan.md`
  (not just a synthetic fixture) — see `tests/test_check_worker_file_scope.py`.
- `scripts/compute_worker_matrix.py` — computes a dependency-ordered wave
  schedule from a plan's `**Dependencies:**` annotations. Also verified
  against the real Houses plan doc — see `tests/test_compute_worker_matrix.py`.
  Its output for that real plan (`[U1,U3] → [U2] → [U4] → [U5]`) is a
  *stricter*, more-correct schedule than this session's own historical
  manual execution of that same plan, which ran U4+U5 in parallel despite
  U5's own Dependencies line listing U4.
- `.github/workflows/rd-approval-watcher.yml`'s **`validate-approval`
  job** — confirms a PR is genuinely plan-only (touches nothing outside
  `docs/plans/`, exactly one new file) and that an `/approve` comment
  came from someone with real write access. No Claude invocation, no
  untested surface.

## What's built but NOT yet verified end-to-end

Everything that requires an actual `ANTHROPIC_API_KEY` and a real headless
Claude Code invocation could not be tested in the session that wrote it —
there was no key to test against. Confirmed real (not guessed) via the
current first-party docs (`code.claude.com/docs/en/headless`,
`code.claude.com/docs/en/github-actions`, and the `anthropics/claude-code-action`
repo's own `action.yml`/`docs/usage.md` at the time this was written) but
**never actually run**:

- `.github/workflows/rd-department.yml` — the R&D Decision Agent + Tech
  Lead Agent two-step invocation (session-resume via `--continue`,
  `--allowedTools`, `--permission-prompts none`, `--output-format json`).
- `.github/workflows/rd-approval-watcher.yml`'s **`dispatch-workers`
  job** — only goes as far as computing and reporting the wave schedule.
  The actual per-unit Worker Agent invocation step is a documented `TODO`,
  intentionally left unwritten rather than shipped with unverified
  `claude_args` syntax that might be subtly wrong in a way nobody would
  catch until a real cycle failed confusingly.

**Before trusting either workflow on a real cycle:**
1. Provision `ANTHROPIC_API_KEY` as a repository secret (Settings →
   Secrets and variables → Actions → New repository secret).
2. Run `rd-department.yml` once via `workflow_dispatch` with
   `dry_run: false` and watch it closely — read the Decision Agent and
   Tech Lead Agent step logs in full, don't just check the exit code.
3. If it produces a plan-only PR, walk it through `rd-approval-watcher.yml`
   manually (via `workflow_dispatch` with the PR number) before ever
   commenting a real `/approve` on a real cycle's output.
4. Only then uncomment the `schedule:` cron trigger in `rd-department.yml`.
5. Write and verify the `dispatch-workers` job's actual per-unit Worker
   Agent step — this is real, non-trivial work this session didn't
   attempt, precisely because it couldn't be tested safely without a key.

## Cost controls — what's real, what isn't

The Claude Code CLI (confirmed against current first-party docs) has
**no `--max-budget-usd` or similar dollar-cap flag** — an earlier research
pass into this design incorrectly assumed one existed. The real, confirmed
cost controls actually wired into these workflows:

- `--max-turns` on every Claude invocation (caps iterations, not dollars).
- `timeout-minutes` at the job level (`rd-department.yml`'s
  `research-and-propose` job: 30 minutes).
- A `concurrency` group with `cancel-in-progress: false` on
  `rd-department.yml`, so a slow cycle can never overlap with the next
  scheduled one.
- `--output-format json`'s `total_cost_usd` field, readable after each run
  for manual spend tracking — there is no automated pre-run budget
  enforcement, only post-run visibility.

## Other real constraints worth knowing before enabling the schedule

- This repo is public. GitHub disables a scheduled workflow automatically
  after 60 days with no repository activity — a long-quiet solo-founder
  repo's cron could silently stop firing with no notification.
  (`code.claude.com/docs/en/github-actions`, "Run on a schedule" section.)
- A `schedule` trigger skips the write-access check `claude-code-action`
  normally runs on the triggering actor, but GitHub attributes the run to
  whoever last edited the workflow's `cron:` line — if that's ever a bot
  account, it needs to be added to `allowed_bots`.
