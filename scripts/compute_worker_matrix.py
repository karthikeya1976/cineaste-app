#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/compute_worker_matrix.py — R&D Department delegation logic.

Reads an approved plan document's Implementation Units and emits a GitHub
Actions matrix (JSON) describing one entry per unit — the exact structure
.github/workflows/rd-approval-watcher.yml's dispatch job consumes to fan
out one Worker Agent invocation per unit.

Sequencing (design doc Section 4 — "dependency-aware sequencing, not
blind parallelism"): a unit's own **Dependencies:** field (already a real
convention in this repo's existing human-authored plans, e.g.
"**Dependencies:** None." / "**Dependencies:** U1, U2." in
docs/plans/2026-09-22-001-feat-houses-navigation-plan.md) determines its
wave — wave 0 has no unmet dependencies, wave 1 depends only on wave-0
units, and so on. Units within the same wave can run in parallel; waves
themselves must run in order. This mirrors the wave-based sequencing this
session itself used for the Houses feature's real 5-unit rollout
(U1+U3 parallel, then U2, then U4+U5 parallel) rather than inventing a
new scheduling algorithm.

Usage:
  python scripts/compute_worker_matrix.py --plan docs/plans/<approved-plan>.md
  # -> prints {"waves": [[{"unit": "U1", "name": "..."}, ...], [...]]}

Exit code 0 = parsed successfully (including the zero-units case — an
empty plan is a parse success, just with nothing to dispatch), 1 = the
plan couldn't be parsed at all, or a dependency cycle/unknown unit
reference was found (fails closed, same posture as
check_worker_file_scope.py).
"""
import sys
import re
import json
import argparse
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_UNIT_HEADER_RE = re.compile(r"^###\s+(U\d+)\.\s*(.*)$", re.MULTILINE)
_DEPS_RE = re.compile(r"^\*\*Dependencies:\*\*\s*(.*)$", re.MULTILINE)
# A dependency reference is a bare unit id (U1, U2, ...) — this repo's real
# plan docs annotate each one with trailing parenthetical rationale on the
# SAME line (confirmed against docs/plans/2026-09-22-001-feat-houses-
# navigation-plan.md's actual U3/U4/U5 Dependencies: lines, e.g. "None (can
# be built in parallel with U1/U2 against a typed placeholder shape)." and
# "U2 (for real data), U3 (for `parseHouseParam`/formatting)."), so
# dependency ids are extracted by pattern match rather than a naive
# comma-split on the whole line.
_DEP_ID_RE = re.compile(r"\bU\d+\b")


def parse_units(plan_text: str) -> dict[str, dict]:
    """Return {unit_id: {"name": str, "deps": [unit_id, ...]}} for every
    ### U<n>. header in the document, in document order."""
    headers = list(_UNIT_HEADER_RE.finditer(plan_text))
    units: dict[str, dict] = {}

    for i, m in enumerate(headers):
        unit_id, name = m.group(1), m.group(2).strip()
        body_start = m.end()
        body_end = headers[i + 1].start() if i + 1 < len(headers) else len(plan_text)
        body = plan_text[body_start:body_end]

        deps_match = _DEPS_RE.search(body)
        deps: list[str] = []
        if deps_match:
            raw = deps_match.group(1)
            # A real dependency id always appears OUTSIDE any parenthetical
            # in this repo's actual plan docs — confirmed against
            # docs/plans/2026-09-22-001-feat-houses-navigation-plan.md's
            # three real non-trivial Dependencies: lines:
            #   "None (can be built in parallel with U1/U2 ...)."   -> []
            #   "U2 (for real data), U3 (for `parseHouseParam`...)." -> [U2, U3]
            #   "U2, U3, U4."                                        -> [U2, U3, U4]
            # Stripping parenthetical content BEFORE extracting U<n> tokens
            # correctly ignores "U1/U2" mentioned only as rationale prose
            # inside a "None (...)" parenthetical, which a naive
            # "find every U<n> on the line" match would wrongly count as a
            # real dependency (confirmed as a real bug during development:
            # it produced U3 -> [U1, U2] against this exact real line).
            without_parens = re.sub(r"\([^)]*\)", "", raw)
            deps = _DEP_ID_RE.findall(without_parens)

        units[unit_id] = {"name": name, "deps": deps}

    return units


def compute_waves(units: dict[str, dict]) -> list[list[str]]:
    """Topologically sort units into waves by dependency. Raises ValueError
    on an unknown unit reference or a dependency cycle — both fail the
    caller closed, never silently drop a unit."""
    remaining = dict(units)
    waves: list[list[str]] = []

    for unit_id, info in units.items():
        for dep in info["deps"]:
            if dep not in units:
                raise ValueError(f"{unit_id} declares a dependency on {dep}, which doesn't exist in this plan")

    while remaining:
        ready = [
            uid for uid, info in remaining.items()
            if all(dep not in remaining for dep in info["deps"])
        ]
        if not ready:
            raise ValueError(
                f"Dependency cycle detected among remaining units: {sorted(remaining)}"
            )
        waves.append(sorted(ready))
        for uid in ready:
            del remaining[uid]

    return waves


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True, help="Path to the approved plan document")
    args = ap.parse_args()

    plan_path = Path(args.plan)
    if not plan_path.exists():
        print(f"PLAN NOT FOUND: {plan_path}", file=sys.stderr)
        return 1

    plan_text = plan_path.read_text(encoding="utf-8")
    units = parse_units(plan_text)

    if not units:
        print(f"No '### U<n>.' Implementation Units found in {plan_path}", file=sys.stderr)
        print(json.dumps({"waves": []}))
        return 0

    try:
        wave_ids = compute_waves(units)
    except ValueError as e:
        print(f"COULD NOT SEQUENCE UNITS: {e}", file=sys.stderr)
        return 1

    waves = [
        [{"unit": uid, "name": units[uid]["name"]} for uid in wave]
        for wave in wave_ids
    ]
    print(json.dumps({"waves": waves}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
