#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/check_worker_file_scope.py — R&D Worker Agent file-scope gate.

Enforces the R&D Department design doc's Section 4 rule: "No worker touches
a file outside its assigned unit's declared file list." Parses an
approved plan document's Implementation Units for each unit's `**Files:**`
list, then checks that a given set of changed files (a Worker Agent's real
PR diff) is a subset of the unit it claims to implement.

This is a real constraint independent of whether the PR was opened by an
agent or a human — the check has no "trust the agent" special case. A
Worker Agent that needs to touch a file outside its assigned list has
scope-crept, by this design's own definition, and the fix is to stop and
escalate (per the design doc's Worker Agent escalation rule), not to widen
the allowlist after the fact from inside the same run.

Usage:
  python scripts/check_worker_file_scope.py \\
      --plan docs/plans/2026-09-24-001-rd-proposal-example.md \\
      --unit U2 \\
      --changed-files-from git-diff-output.txt

  # or pipe changed files directly:
  git diff --name-only main...HEAD | \\
      python scripts/check_worker_file_scope.py --plan <path> --unit U2 --changed-files-from -

Exit code 0 = every changed file is within the unit's declared scope,
1 = at least one changed file is out of scope (or the unit/plan couldn't
be parsed at all — a parse failure is NOT a pass; an unenforceable check
is not the same as a passed one).
"""
import sys
import re
import argparse
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Matches "### U2. <name>" headers and the "**Files:**" list beneath them —
# the exact shape docs/plans/templates/rd-proposal-template.md establishes
# (also the shape this repo's existing human-authored plans already use,
# e.g. docs/plans/2026-09-22-001-feat-houses-navigation-plan.md's own
# "### U1. Backend schema: ..." / "**Files:**" sections).
_UNIT_HEADER_RE = re.compile(r"^###\s+(U\d+)\.\s*(.*)$", re.MULTILINE)
_FILES_LABEL_RE = re.compile(r"^\*\*Files:\*\*\s*$", re.MULTILINE)
# A declared file line is "- `path` — optional rationale text..." — this
# repo's real plan docs (confirmed against docs/plans/2026-09-22-001-feat-
# houses-navigation-plan.md's actual U1/U2 sections, not an idealized
# format) put a trailing " — description" after the path on the SAME line,
# not a bare path per line. Only the leading backtick-quoted path is
# captured; everything after the closing backtick is ignored.
_FILE_ITEM_RE = re.compile(r"^-\s+`([^`\n]+)`", re.MULTILINE)


def parse_unit_files(plan_text: str, unit_id: str) -> list[str] | None:
    """Return the declared file list for unit_id, or None if the unit or
    its Files: section couldn't be found at all (distinct from an empty
    list, which would mean a real but empty declaration)."""
    headers = list(_UNIT_HEADER_RE.finditer(plan_text))
    unit_start = None
    unit_end = len(plan_text)
    for i, m in enumerate(headers):
        if m.group(1) == unit_id:
            unit_start = m.end()
            if i + 1 < len(headers):
                unit_end = headers[i + 1].start()
            break

    if unit_start is None:
        return None

    unit_body = plan_text[unit_start:unit_end]
    files_label = _FILES_LABEL_RE.search(unit_body)
    if not files_label:
        return None

    # The Files: list runs from just after the label until the next
    # "**<Something>:**" label (Approach:, Test scenarios:, etc.) or the
    # end of the unit body — whichever comes first.
    rest = unit_body[files_label.end():]
    next_label = re.search(r"^\*\*[^*]+:\*\*\s*$", rest, re.MULTILINE)
    files_block = rest[:next_label.start()] if next_label else rest

    return [m.group(1).strip() for m in _FILE_ITEM_RE.finditer(files_block)]


def normalize(path: str) -> str:
    """Backslash/forward-slash and leading-./ tolerant comparison — a
    plan author or a git diff on different platforms shouldn't produce a
    false scope violation over path-separator style alone."""
    return path.replace("\\", "/").lstrip("./")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True, help="Path to the approved plan document")
    ap.add_argument("--unit", required=True, help="Unit id this PR claims to implement, e.g. U2")
    ap.add_argument("--changed-files-from", required=True,
                     help="Path to a file listing changed files (one per line), or '-' for stdin")
    args = ap.parse_args()

    plan_path = Path(args.plan)
    if not plan_path.exists():
        print(f"PLAN NOT FOUND: {plan_path}")
        print("A worker PR must reference a real, existing approved plan document — failing closed.")
        return 1

    plan_text = plan_path.read_text(encoding="utf-8")
    declared = parse_unit_files(plan_text, args.unit)

    if declared is None:
        print(f"COULD NOT PARSE unit {args.unit}'s **Files:** section in {plan_path}")
        print("A worker PR whose unit can't be parsed can't be scope-checked — failing closed,")
        print("not passing open. Fix the plan document's Implementation Units formatting.")
        return 1

    declared_set = {normalize(f) for f in declared}

    if args.changed_files_from == "-":
        changed_raw = sys.stdin.read()
    else:
        changed_raw = Path(args.changed_files_from).read_text(encoding="utf-8")
    changed = [normalize(line.strip()) for line in changed_raw.splitlines() if line.strip()]

    out_of_scope = [f for f in changed if f not in declared_set]

    print(f"Unit {args.unit} declares {len(declared_set)} file(s):")
    for f in sorted(declared_set):
        print(f"  - {f}")
    print(f"\nThis PR changes {len(changed)} file(s):")
    for f in changed:
        marker = "OK " if f in declared_set else "OUT"
        print(f"  [{marker}] {f}")

    if out_of_scope:
        print(f"\nSCOPE VIOLATION — {len(out_of_scope)} changed file(s) not in unit {args.unit}'s declared list:")
        for f in out_of_scope:
            print(f"  - {f}")
        print(
            "\nPer the R&D Department design doc's Worker Agent escalation rule: a unit "
            "needing a file outside its declared scope should have stopped and posted "
            "the finding as a PR comment, not touched the file. File-scope gate FAILED."
        )
        return 1

    print(f"\nAll {len(changed)} changed file(s) are within unit {args.unit}'s declared scope. Gate passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
