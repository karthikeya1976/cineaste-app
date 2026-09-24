<!--
Template for an R&D Department architecture plan — see the published design
doc (Artifact) for the full system this belongs to. A Worker Agent must
NEVER start implementation against a plan filed from this template until
the corresponding plan-only PR has been explicitly approved (a human
`/approve` comment, or a manual merge) — see the Human Checkpoint section
of the design doc. This is not optional and has no size/triviality
exception.

Filename convention: docs/plans/YYYY-MM-DD-NNN-rd-proposal-<slug>.md
  (same numbering scheme as this repo's existing human-authored plans,
  e.g. 2026-09-22-001-feat-houses-navigation-plan.md — NNN increments
  per day if more than one plan lands on the same date)

Delete this comment block before filing a real plan.
-->

# rd-proposal: <short, imperative title>

## Decision Record

*Filled in by the Tech Lead Agent once the two lead agents converge —
this section exists so a founder reviewing months of these later can
audit the pattern of decisions, not just read each one in isolation.*

| Field | Value |
|---|---|
| Proposed by | R&D Decision Agent, session `<session_id>` |
| Reviewed by | Tech Lead Agent, resumed session `<session_id>` |
| Outcome | endorsed as-is / endorsed with changes / *(a rejected proposal does not reach this template — see `docs/rd-research-log.md` instead)* |
| Confidence | high / medium / low — the Tech Lead Agent's own assessment, stated plainly |
| High-risk areas flagged | none / auth / payments-or-credits / encryption / moderation-decision-engine — *(see the design doc's Tech Lead role card; a plan touching any of these must say so here, not bury it in prose)* |
| Cycle date | YYYY-MM-DD |

## Summary

*2-4 sentences. What is being proposed and why, in plain language — a
founder should be able to read only this paragraph and know whether to
keep reading.*

## Problem Frame

*What's true today that makes this worth doing. Cite real files/lines,
not a general impression — the Decision Agent's proposal input included
the live codebase, so this section should read like it actually looked,
not like a hypothetical.*

## Scope Boundaries

**In scope:**
-

**Deferred to Follow-Up Work:**
-

**Out of scope (non-goals):**
-

## Key Technical Decisions

*Same KTD convention as this repo's existing human-authored plans
(numbered, each with a stated rationale) — this is where the Tech Lead
Agent's evaluation actually shows its work, not just its conclusion.*

**KTD1 — <decision>.** <rationale, citing real code/patterns this repo
already has, per the design doc's "prefer existing patterns" framing for
worker delegation>

## High-Level Technical Design

*Diagram (mermaid, matching this repo's existing plan-doc convention) or
prose, whichever actually clarifies the shape of the change.*

## Implementation Units

*Each unit becomes exactly one Worker Agent assignment (design doc
Section 4) — one coherent, independently-testable piece, with its own
file list. A unit's file list is load-bearing: the CI file-list-
enforcement check fails a worker's PR if its diff touches a file outside
this list.*

### U1. <unit name>

**Goal:**

**Files:**
-

**Approach:**

**Test scenarios:**
-

## Documentation Impact

*Which of CLAUDE.md's Area 7 docs (changelog, project_status,
architecture, moderation_policies, README) this plan will require
updating once implemented — the Worker Agent(s) still do the actual
updates, this is just a heads-up for the reviewer.*

## Risks & Dependencies

## Open Questions

*Anything the two lead agents could not resolve on their own and are
surfacing for the human reviewer explicitly, rather than guessing.*
