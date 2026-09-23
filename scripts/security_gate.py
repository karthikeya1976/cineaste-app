#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/security_gate.py — CI security-scan gate.

Reads the JSON output of bandit (Python SAST), pip-audit (Python dependency
CVEs), and npm audit (JS dependency CVEs), and decides pass/fail. Follows
scripts/compare_baseline.py's own philosophy exactly: block only on NEW
findings above the severity threshold, not on everything the tools report —
a repo this size already has real, pre-existing findings (confirmed via a
first real run: 2 low-confidence bandit SQL-injection false-positives from
f-string-interpolated CONSTANTS rather than user input, plus dependency CVEs
in transitive build tooling) that would make the gate permanently red on day
one if it blocked on raw tool output rather than a maintained baseline —
exactly the failure mode compare_baseline.py's own "new regressions only"
design already avoids for the test suite.

.ci/security-baseline.json holds accepted findings (a finding ID + a reason
per entry, reviewed and committed deliberately — never auto-generated
silently). A finding not in the baseline, at or above --min-severity, blocks
the PR. A finding IN the baseline is reported but does not block.

Usage:
  python scripts/security_gate.py --results results/ --baseline .ci/security-baseline.json

Exit code 0 = no new blocking findings, 1 = new findings at or above threshold.
"""
import sys
import json
import argparse
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# bandit: LOW/MEDIUM/HIGH. pip-audit/npm audit have no bandit-style severity
# on every entry (pip-audit's OSV data often omits it; npm audit always
# supplies one) — both are normalized to this same 3-tier scale below.
SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2}
DEFAULT_MIN_SEVERITY = "high"


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"MALFORMED JSON: {path} ({e})")
        return {}


def collect_bandit_findings(path: Path) -> list[dict]:
    data = load_json(path)
    findings = []
    for r in data.get("results", []):
        findings.append({
            "id": f"bandit:{r['test_id']}:{r['filename']}:{r['line_number']}",
            "tool": "bandit",
            "severity": r["issue_severity"].lower(),
            "summary": f"{r['test_id']} in {r['filename']}:{r['line_number']} — {r['issue_text']}",
        })
    return findings


def collect_pip_audit_findings(path: Path) -> list[dict]:
    data = load_json(path)
    seen_ids: set[str] = set()
    findings = []
    for dep in data.get("dependencies", []):
        for vuln in dep.get("vulns", []):
            # pip-audit genuinely lists the same vuln twice when a package
            # is reachable via more than one resolution path (confirmed on
            # a real run: starlette pulled in both directly and as a
            # sub-dependency of fastapi, each producing an identical vuln
            # entry) — dedup by finding id, not just by trusting the tool's
            # own list to be pre-deduplicated.
            finding_id = f"pip-audit:{dep['name']}:{vuln['id']}"
            if finding_id in seen_ids:
                continue
            seen_ids.add(finding_id)
            # pip-audit's OSV-sourced data doesn't carry a normalized
            # severity field consistently — any known CVE against a pinned
            # production dependency is treated as "high" by default (a
            # deliberate, conservative default; see --min-severity to
            # relax it, not this script's own hardcoded assumption).
            findings.append({
                "id": finding_id,
                "tool": "pip-audit",
                "severity": "high",
                "summary": f"{dep['name']} {dep['version']} — {vuln['id']} (fix: {', '.join(vuln.get('fix_versions', [])) or 'none published'})",
            })
    return findings


def collect_npm_audit_findings(path: Path) -> list[dict]:
    data = load_json(path)
    findings = []
    for name, v in data.get("vulnerabilities", {}).items():
        severity = v.get("severity", "high")
        # npm audit's own scale (info/low/moderate/high/critical) collapses
        # onto this script's 3-tier scale: critical -> high, moderate -> medium.
        severity = {"critical": "high", "moderate": "medium", "info": "low"}.get(severity, severity)
        findings.append({
            "id": f"npm-audit:{name}",
            "tool": "npm-audit",
            "severity": severity,
            "summary": f"{name} — {v.get('severity', 'unknown')} severity",
        })
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True, help="Directory containing bandit.json, pip-audit.json, npm-audit.json")
    ap.add_argument("--baseline", required=True, help="Path to security-baseline.json (accepted pre-existing findings)")
    ap.add_argument("--min-severity", default=DEFAULT_MIN_SEVERITY, choices=list(SEVERITY_ORDER),
                     help=f"Minimum severity that blocks the PR (default: {DEFAULT_MIN_SEVERITY})")
    args = ap.parse_args()

    results_dir = Path(args.results)
    all_findings = (
        collect_bandit_findings(results_dir / "bandit.json")
        + collect_pip_audit_findings(results_dir / "pip-audit.json")
        + collect_npm_audit_findings(results_dir / "npm-audit.json")
    )

    baseline_path = Path(args.baseline)
    baseline: dict[str, dict] = json.loads(baseline_path.read_text()) if baseline_path.exists() else {}

    threshold = SEVERITY_ORDER[args.min_severity]
    new_blocking: list[dict] = []
    accepted: list[dict] = []
    below_threshold: list[dict] = []

    for f in all_findings:
        if f["id"] in baseline:
            accepted.append(f)
        elif SEVERITY_ORDER.get(f["severity"], 2) < threshold:
            below_threshold.append(f)
        else:
            new_blocking.append(f)

    print(f"Total findings: {len(all_findings)} "
          f"({len(new_blocking)} new blocking, {len(accepted)} accepted/baselined, {len(below_threshold)} below threshold)")

    if accepted:
        print(f"\nAccepted (baselined, not blocking) ({len(accepted)}):")
        for f in accepted:
            reason = baseline.get(f["id"], {}).get("reason", "no reason recorded")
            print(f"  ~ [{f['tool']}] {f['summary']}\n      accepted: {reason}")

    if below_threshold:
        print(f"\nBelow --min-severity ({args.min_severity}), reported not blocking ({len(below_threshold)}):")
        for f in below_threshold:
            print(f"  · [{f['tool']}] {f['summary']}")

    if new_blocking:
        print(f"\nNEW FINDINGS AT OR ABOVE '{args.min_severity}' ({len(new_blocking)}):")
        for f in new_blocking:
            print(f"  - [{f['tool']}] {f['summary']}")
        print(
            f"\nSecurity gate FAILED. To accept a finding as a known/reviewed "
            f"issue (not a fix), add its id to {args.baseline} with a reason — "
            f"same deliberate-acceptance model as an existing test baseline, "
            f"never auto-added."
        )
        return 1

    print("\nNo new blocking security findings. Security gate passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
