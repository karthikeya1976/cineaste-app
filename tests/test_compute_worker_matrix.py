"""
Unit tests for scripts/compute_worker_matrix.py.

Pure-logic module (no DB, no network), same category as
test_decision_engine.py and test_check_worker_file_scope.py. Verified
directly against this repo's own real plan document
(docs/plans/2026-09-22-001-feat-houses-navigation-plan.md), not just a
hand-crafted fixture — its real "**Dependencies:**" lines carry trailing
parenthetical rationale ("None (can be built in parallel with U1/U2
against a typed placeholder shape).", "U2 (for real data), U3 (for
`parseHouseParam`/formatting).") that a naive "find every U<n> token on
the line" parser incorrectly treats as real dependencies when they only
appear inside the "None (...)" case's rationale text — exactly the bug
this test file caught during development (U3 was computed as depending on
U1/U2 when the real document says the opposite: "None").
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from compute_worker_matrix import parse_units, compute_waves, main  # noqa: E402

REAL_PLAN = Path(__file__).resolve().parents[1] / "docs" / "plans" / "2026-09-22-001-feat-houses-navigation-plan.md"


class TestParseUnitsAgainstRealPlan:
    def test_u1_has_no_dependencies(self):
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        units = parse_units(plan_text)
        assert units["U1"]["deps"] == []

    def test_u2_depends_on_u1(self):
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        units = parse_units(plan_text)
        assert units["U2"]["deps"] == ["U1"]

    def test_u3_none_with_parenthetical_mentioning_other_units_has_no_real_dependencies(self):
        """The core bug this test file exists to catch: U3's real
        Dependencies: line is 'None (can be built in parallel with U1/U2
        against a typed placeholder shape).' — the U1/U2 mentions are
        rationale prose inside parens, not real dependencies. A parser
        that naively extracts every U<n> token on the line would wrongly
        compute deps=['U1','U2'] here; the correct answer is []."""
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        units = parse_units(plan_text)
        assert units["U3"]["deps"] == []

    def test_u4_depends_on_u2_and_u3_with_trailing_parentheticals_stripped(self):
        """Real line: 'U2 (for real data), U3 (for `parseHouseParam`/
        formatting).' — the parenthetical annotations must be stripped
        from each dependency, leaving just the two real unit ids."""
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        units = parse_units(plan_text)
        assert units["U4"]["deps"] == ["U2", "U3"]

    def test_u5_depends_on_three_units_plain_comma_list(self):
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        units = parse_units(plan_text)
        assert units["U5"]["deps"] == ["U2", "U3", "U4"]

    def test_all_five_units_have_their_real_names(self):
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        units = parse_units(plan_text)
        assert units["U1"]["name"].startswith("Backend schema")
        assert units["U5"]["name"].startswith("Frontend: House-scoped feed")


class TestComputeWavesAgainstRealPlan:
    def test_real_plan_produces_a_valid_dependency_respecting_schedule(self):
        """U1 and U3 have no dependencies and share a wave; U2 waits for
        U1; U4 waits for U2+U3; U5 waits for U4 (which already implies
        U2+U3 are satisfied transitively) — this is a STRICTER schedule
        than this session's own historical manual execution of this exact
        plan (which ran U4+U5 in parallel), because U5's real Dependencies:
        line explicitly lists U4 and the computed schedule respects that
        rather than repeating the same risk the manual run took on."""
        plan_text = REAL_PLAN.read_text(encoding="utf-8")
        units = parse_units(plan_text)
        waves = compute_waves(units)

        assert waves == [["U1", "U3"], ["U2"], ["U4"], ["U5"]]


class TestComputeWavesFixtures:
    def test_units_with_no_dependencies_share_wave_zero(self):
        units = {"U1": {"name": "a", "deps": []}, "U2": {"name": "b", "deps": []}}
        assert compute_waves(units) == [["U1", "U2"]]

    def test_linear_chain_produces_one_unit_per_wave(self):
        units = {
            "U1": {"name": "a", "deps": []},
            "U2": {"name": "b", "deps": ["U1"]},
            "U3": {"name": "c", "deps": ["U2"]},
        }
        assert compute_waves(units) == [["U1"], ["U2"], ["U3"]]

    def test_diamond_dependency_shape(self):
        """U1 -> (U2, U3) -> U4: U2 and U3 both depend only on U1 and share
        a wave; U4 waits for both."""
        units = {
            "U1": {"name": "a", "deps": []},
            "U2": {"name": "b", "deps": ["U1"]},
            "U3": {"name": "c", "deps": ["U1"]},
            "U4": {"name": "d", "deps": ["U2", "U3"]},
        }
        assert compute_waves(units) == [["U1"], ["U2", "U3"], ["U4"]]

    def test_unknown_dependency_reference_raises(self):
        units = {"U1": {"name": "a", "deps": ["U99"]}}
        with pytest.raises(ValueError, match="U99"):
            compute_waves(units)

    def test_dependency_cycle_raises(self):
        units = {
            "U1": {"name": "a", "deps": ["U2"]},
            "U2": {"name": "b", "deps": ["U1"]},
        }
        with pytest.raises(ValueError, match="cycle"):
            compute_waves(units)

    def test_empty_units_produces_empty_waves(self):
        assert compute_waves({}) == []


class TestMainCli:
    def _run(self, plan_path):
        old_argv = sys.argv
        sys.argv = ["compute_worker_matrix.py", "--plan", str(plan_path)]
        try:
            return main()
        finally:
            sys.argv = old_argv

    def test_real_plan_exits_zero_and_prints_the_expected_wave_json(self, capsys):
        exit_code = self._run(REAL_PLAN)
        assert exit_code == 0

        payload = json.loads(capsys.readouterr().out)
        unit_ids_per_wave = [[entry["unit"] for entry in wave] for wave in payload["waves"]]
        assert unit_ids_per_wave == [["U1", "U3"], ["U2"], ["U4"], ["U5"]]
        # Each entry also carries the unit's real name from the doc, not
        # just its id — spot-check one.
        first_wave = payload["waves"][0]
        u1_entry = next(e for e in first_wave if e["unit"] == "U1")
        assert u1_entry["name"] == units_name(REAL_PLAN, "U1")

    def test_missing_plan_fails_closed(self):
        exit_code = self._run(Path("docs/plans/does-not-exist-at-all.md"))
        assert exit_code == 1

    def test_plan_with_no_units_returns_empty_waves_not_a_failure(self, tmp_path):
        empty_plan = tmp_path / "empty.md"
        empty_plan.write_text("# A plan with no Implementation Units section at all\n", encoding="utf-8")
        exit_code = self._run(empty_plan)
        assert exit_code == 0

    def test_cyclic_plan_fails_closed(self, tmp_path, capsys):
        cyclic_plan = tmp_path / "cyclic.md"
        cyclic_plan.write_text(
            "### U1. First\n\n**Dependencies:** U2.\n\n"
            "### U2. Second\n\n**Dependencies:** U1.\n",
            encoding="utf-8",
        )
        exit_code = self._run(cyclic_plan)
        assert exit_code == 1


def units_name(plan_path, unit_id):
    """Test helper — not part of the module under test."""
    plan_text = plan_path.read_text(encoding="utf-8")
    return parse_units(plan_text)[unit_id]["name"]
