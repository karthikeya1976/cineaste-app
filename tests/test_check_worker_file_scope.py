"""
Unit tests for scripts/check_worker_file_scope.py.

Pure-logic module (no DB, no network) — safe to run in any CI environment
without a Postgres/Redis service container, same category as
test_decision_engine.py. Parsing correctness is verified directly against
this repo's own REAL existing plan document
(docs/plans/2026-09-22-001-feat-houses-navigation-plan.md), not just a
hand-crafted fixture — its Implementation Units use a "- `path` — rationale"
line shape (path + trailing prose on the same line) that a naive "bare path
per line" parser would silently fail to match at all, which is exactly the
bug this test file caught during development (confirmed by running the
parser against this real file before writing the fixture-based tests below).
"""
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from check_worker_file_scope import parse_unit_files, normalize, main  # noqa: E402

REAL_PLAN = Path(__file__).resolve().parents[1] / "docs" / "plans" / "2026-09-22-001-feat-houses-navigation-plan.md"


class TestParseUnitFilesAgainstRealPlan:
    """Confirms the parser works against this repo's actual plan doc
    format, not an idealized format invented for this test file."""

    def test_u1_files_match_the_real_document(self):
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        files = parse_unit_files(plan_text, "U1")
        assert files == ["backend/app/db.py", "docs/architecture.md"]

    def test_u2_files_match_the_real_document(self):
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        files = parse_unit_files(plan_text, "U2")
        assert files == [
            "backend/app/db.py",
            "backend/app/main.py",
            "frontend/lib/api.ts",
            "docs/architecture.md",
        ]

    def test_all_five_real_units_parse_to_a_nonempty_list(self):
        """Every unit in the real plan has a real Files: section — none of
        them should silently parse to an empty or missing list."""
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        for unit in ["U1", "U2", "U3", "U4", "U5"]:
            files = parse_unit_files(plan_text, unit)
            assert files is not None, f"{unit} failed to parse at all"
            assert len(files) > 0, f"{unit} parsed to an empty file list"

    def test_missing_unit_returns_none_not_empty_list(self):
        """None (unit/section not found) must be distinguishable from []
        (a real but empty Files: declaration) — the caller fails closed
        only on None."""
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        assert parse_unit_files(plan_text, "U99") is None


class TestParseUnitFilesFixtures:
    def test_bare_path_per_line_also_parses(self):
        """The template's own bare-path style (no trailing rationale) must
        also work, not just this repo's prose-suffixed style."""
        plan_text = """
### U1. Some unit

**Files:**
- `path/one.py`
- `path/two.py`

**Approach:**
Some approach text.
"""
        assert parse_unit_files(plan_text, "U1") == ["path/one.py", "path/two.py"]

    def test_files_section_at_end_of_unit_with_no_following_label(self):
        """Files: as the LAST section in a unit (nothing after it before
        the next ### header or end of document) must still parse
        correctly — the next-label boundary search must not require a
        following label to exist."""
        plan_text = """
### U1. Some unit

**Files:**
- `only/file.py`
"""
        assert parse_unit_files(plan_text, "U1") == ["only/file.py"]

    def test_second_unit_does_not_leak_into_first_units_file_list(self):
        plan_text = """
### U1. First unit

**Files:**
- `unit1/file.py`

**Approach:**
text

### U2. Second unit

**Files:**
- `unit2/file.py`
"""
        assert parse_unit_files(plan_text, "U1") == ["unit1/file.py"]
        assert parse_unit_files(plan_text, "U2") == ["unit2/file.py"]

    def test_unit_with_no_files_label_at_all_returns_none(self):
        plan_text = """
### U1. Some unit

**Approach:**
No Files: section here at all.
"""
        assert parse_unit_files(plan_text, "U1") is None


class TestNormalize:
    def test_backslash_converted_to_forward_slash(self):
        assert normalize("backend\\app\\db.py") == "backend/app/db.py"

    def test_leading_dot_slash_stripped(self):
        assert normalize("./backend/app/db.py") == "backend/app/db.py"

    def test_already_normalized_path_unchanged(self):
        assert normalize("backend/app/db.py") == "backend/app/db.py"


class TestMainCli:
    """End-to-end CLI behavior via main(), using this repo's real plan doc
    and real argv — not just the parsing function in isolation."""

    def _run(self, argv, changed_files_text):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
            f.write(changed_files_text)
            changed_path = f.name
        try:
            old_argv = sys.argv
            sys.argv = ["check_worker_file_scope.py"] + argv + ["--changed-files-from", changed_path]
            try:
                return main()
            finally:
                sys.argv = old_argv
        finally:
            Path(changed_path).unlink()

    def test_in_scope_changes_pass(self):
        exit_code = self._run(
            ["--plan", str(REAL_PLAN), "--unit", "U1"],
            "backend/app/db.py\ndocs/architecture.md\n",
        )
        assert exit_code == 0

    def test_out_of_scope_change_fails(self):
        exit_code = self._run(
            ["--plan", str(REAL_PLAN), "--unit", "U1"],
            "backend/app/db.py\nfrontend/app/feed/page.tsx\n",
        )
        assert exit_code == 1

    def test_missing_plan_fails_closed(self):
        exit_code = self._run(
            ["--plan", "docs/plans/does-not-exist-at-all.md", "--unit", "U1"],
            "backend/app/db.py\n",
        )
        assert exit_code == 1

    def test_missing_unit_fails_closed(self):
        exit_code = self._run(
            ["--plan", str(REAL_PLAN), "--unit", "U99"],
            "backend/app/db.py\n",
        )
        assert exit_code == 1

    def test_backslash_paths_in_diff_still_match_forward_slash_declaration(self):
        exit_code = self._run(
            ["--plan", str(REAL_PLAN), "--unit", "U1"],
            "backend\\app\\db.py\n",
        )
        assert exit_code == 0

    def test_empty_changed_files_passes_vacuously(self):
        """Zero changed files is not a scope violation — there's nothing
        to violate. (Whether a zero-file PR is meaningful is a different
        concern this script doesn't own.)"""
        exit_code = self._run(
            ["--plan", str(REAL_PLAN), "--unit", "U1"],
            "",
        )
        assert exit_code == 0
