#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
# Force UTF-8 output on Windows so box-drawing chars print cleanly
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

"""
scripts/scan-repo.py — Cineaste repo health scanner.

Checks for:
  1. Tracked .env / secret files (credentials committed to git)
  2. Python files imported nowhere (dead code)
  3. Frontend components / pages imported nowhere (dead UI)
  4. Stale .env.example keys (missing or extra vs actual .env vars)
  5. Docs freshness (md files not touched in > N days)
  6. TODO / FIXME markers left in code

Usage:
  python scripts/scan-repo.py            # scan only, print report
  python scripts/scan-repo.py --fix      # auto-delete confirmed-dead files
  python scripts/scan-repo.py --dry-run  # same as default (explicit)

The script never deletes files without --fix. With --fix it only removes
files that appear in the SAFE_TO_DELETE list it computes — it will always
ask for confirmation before actually removing anything.
"""

import os
import re
import sys
import subprocess
import argparse
from pathlib import Path
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent.resolve()

# Directories to skip entirely
SKIP_DIRS = {
    "node_modules", ".next", "__pycache__", ".git", "venv",
    ".venv", "dist", "build", ".claude",
}

# File patterns that should NEVER be committed
SECRET_PATTERNS = [
    r"^\.env$",
    r"^\.env\.(local|production|staging|development)$",
    r"\.pem$",
    r"\.key$",
    r"id_rsa",
    r"credentials\.json$",
]

# Docs freshness threshold (days)
DOCS_STALE_DAYS = 30

# Extensions to scan for imports
PYTHON_EXT = {".py"}
FRONTEND_EXT = {".tsx", ".ts"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def repo_files(exts: set[str] | None = None) -> list[Path]:
    """Walk repo, skip noise dirs, optionally filter by extension."""
    result = []
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            p = Path(root) / f
            if exts is None or p.suffix in exts:
                result.append(p)
    return result


def git_tracked() -> set[Path]:
    """Return set of absolute paths that git tracks."""
    out = subprocess.check_output(
        ["git", "ls-files"], cwd=REPO_ROOT, text=True
    )
    return {REPO_ROOT / p.strip() for p in out.splitlines() if p.strip()}


def git_last_modified(path: Path) -> datetime | None:
    """Return the last git commit date for a file."""
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%cI", "--", str(path)],
            cwd=REPO_ROOT, text=True,
        ).strip()
        if not out:
            return None
        return datetime.fromisoformat(out)
    except Exception:
        return None


def rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


# ── Check 1: tracked secret files ────────────────────────────────────────────

def check_secrets(tracked: set[Path]) -> list[str]:
    issues = []
    for p in tracked:
        name = p.name
        for pat in SECRET_PATTERNS:
            if re.search(pat, name, re.IGNORECASE):
                issues.append(f"  ⚠️  Secret file tracked by git: {rel(p)}")
    return issues


# ── Check 2: dead Python modules ─────────────────────────────────────────────

def check_dead_python(tracked: set[Path]) -> tuple[list[str], list[Path]]:
    py_files = [p for p in tracked if p.suffix == ".py"
                and "venv" not in str(p) and ".venv" not in str(p)]

    # Build set of all import strings in the repo
    all_source = "\n".join(p.read_text(errors="ignore") for p in py_files)

    dead = []
    safe_to_delete = []
    for p in py_files:
        # Derive the importable module name relative to backend/app
        try:
            rel_parts = p.relative_to(REPO_ROOT / "backend" / "app").with_suffix("").parts
        except ValueError:
            continue
        if p.name in ("__init__.py", "config.py", "main.py", "tasks.py",
                       "db.py", "storage.py", "decision_engine.py"):
            continue  # always-needed entry points

        module_name = rel_parts[-1]  # e.g. "aggregator", "copyright_match"
        dotted = ".".join(rel_parts)  # e.g. "pillars.adult_content"

        imported = (
            f"import {module_name}" in all_source
            or f"from app.{dotted}" in all_source
            or f"import {dotted}" in all_source
            or f"{module_name}" in all_source.replace(p.read_text(errors="ignore"), "")
        )

        # Check outside this file's own text
        other_source = all_source.replace(p.read_text(errors="ignore"), "")
        actually_imported = (
            f"import {module_name}" in other_source
            or f"from app.{dotted}" in other_source
            or f"import {dotted}" in other_source
            or f", {module_name}" in other_source   # e.g. "adult_content, ai_deepfake"
            or f" {module_name}" in other_source    # bare name used after import
        )

        if not actually_imported:
            dead.append(f"  🗑️  Dead Python module: {rel(p)}")
            safe_to_delete.append(p)

    return dead, safe_to_delete


# ── Check 3: dead frontend components ─────────────────────────────────────────

def check_dead_frontend(tracked: set[Path]) -> tuple[list[str], list[Path]]:
    fe_files = [p for p in tracked
                if p.suffix in FRONTEND_EXT
                and "node_modules" not in str(p)
                and ".next" not in str(p)]

    all_fe_source = "\n".join(p.read_text(errors="ignore") for p in fe_files)

    # Only check files in components/ (pages are routes — Next.js loads them by convention)
    component_files = [p for p in fe_files
                       if "components" in str(p) and p.name != "nav-bar.tsx"]

    dead = []
    safe_to_delete = []
    for p in component_files:
        stem = p.stem  # e.g. "job-detail"
        camel = "".join(w.capitalize() for w in stem.split("-"))  # JobDetail
        other_source = all_fe_source.replace(p.read_text(errors="ignore"), "")
        if camel not in other_source and stem not in other_source:
            dead.append(f"  🗑️  Dead frontend component: {rel(p)}")
            safe_to_delete.append(p)

    return dead, safe_to_delete


# ── Check 4: .env.example completeness ────────────────────────────────────────

def check_env_example() -> list[str]:
    issues = []
    example = REPO_ROOT / ".env.example"
    actual = REPO_ROOT / ".env"

    if not example.exists():
        return ["  ⚠️  .env.example missing — create one so others know what vars are needed"]

    example_keys = set()
    for line in example.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            example_keys.add(line.split("=")[0].strip())

    if actual.exists():
        actual_keys = set()
        for line in actual.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                actual_keys.add(line.split("=")[0].strip())

        missing_from_example = actual_keys - example_keys
        for k in sorted(missing_from_example):
            issues.append(f"  ⚠️  Key in .env but missing from .env.example: {k}")

        extra_in_example = example_keys - actual_keys
        for k in sorted(extra_in_example):
            issues.append(f"  ℹ️  Key in .env.example but not in .env (OK if optional): {k}")

    return issues


# ── Check 5: stale docs ───────────────────────────────────────────────────────

def check_stale_docs(tracked: set[Path]) -> list[str]:
    issues = []
    now = datetime.now(timezone.utc)
    doc_files = [p for p in tracked if p.suffix == ".md"]
    for p in doc_files:
        last = git_last_modified(p)
        if last is None:
            continue
        age = (now - last).days
        if age > DOCS_STALE_DAYS:
            issues.append(f"  📄  Stale doc ({age}d since last commit): {rel(p)}")
    return issues


# ── Check 6: TODO / FIXME markers ─────────────────────────────────────────────

def check_todos(tracked: set[Path]) -> list[str]:
    issues = []
    scan_exts = {".py", ".ts", ".tsx", ".md"}
    for p in tracked:
        if p.suffix not in scan_exts:
            continue
        if p.name == "scan-repo.py":   # exclude the scanner itself
            continue
        try:
            text = p.read_text(errors="ignore")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if re.search(r"\b(TODO|FIXME|HACK|XXX)\b", line, re.IGNORECASE):
                snippet = line.strip()[:72]
                issues.append(f"  📌  {rel(p)}:{i}  {snippet}")
    return issues


# ── Report + optional delete ──────────────────────────────────────────────────

def confirm_delete(paths: list[Path]) -> bool:
    print("\n  The following files will be permanently removed from git and disk:")
    for p in paths:
        print(f"    - {rel(p)}")
    ans = input("\n  Proceed? [y/N] ").strip().lower()
    return ans == "y"


def git_rm(paths: list[Path]) -> None:
    args = ["git", "rm", "--force"] + [str(p) for p in paths]
    subprocess.run(args, cwd=REPO_ROOT, check=True)
    print(f"\n  ✅  Removed {len(paths)} file(s) from git.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Cineaste repo health scanner")
    parser.add_argument("--fix", action="store_true",
                        help="Delete confirmed-dead files (asks for confirmation)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Scan only, print report (default)")
    args = parser.parse_args()

    print(f"\n{'═'*60}")
    print("  Cineaste — Repo Health Scan")
    print(f"  Root: {REPO_ROOT}")
    print(f"{'═'*60}\n")

    tracked = git_tracked()
    all_safe_to_delete: list[Path] = []
    total_issues = 0

    # 1. Secrets
    secrets = check_secrets(tracked)
    if secrets:
        print("── Tracked Secret Files ────────────────────────────────────")
        for s in secrets: print(s)
        total_issues += len(secrets)
        print()

    # 2. Dead Python
    dead_py, dead_py_files = check_dead_python(tracked)
    if dead_py:
        print("── Dead Python Modules ─────────────────────────────────────")
        for s in dead_py: print(s)
        all_safe_to_delete.extend(dead_py_files)
        total_issues += len(dead_py)
        print()

    # 3. Dead frontend components
    dead_fe, dead_fe_files = check_dead_frontend(tracked)
    if dead_fe:
        print("── Dead Frontend Components ────────────────────────────────")
        for s in dead_fe: print(s)
        all_safe_to_delete.extend(dead_fe_files)
        total_issues += len(dead_fe)
        print()

    # 4. .env.example completeness
    env_issues = check_env_example()
    if env_issues:
        print("── .env.example ────────────────────────────────────────────")
        for s in env_issues: print(s)
        total_issues += len(env_issues)
        print()

    # 5. Stale docs
    stale = check_stale_docs(tracked)
    if stale:
        print("── Stale Docs ──────────────────────────────────────────────")
        for s in stale: print(s)
        total_issues += len(stale)
        print()

    # 6. TODOs
    todos = check_todos(tracked)
    if todos:
        print("── TODO / FIXME Markers ────────────────────────────────────")
        for s in todos: print(s)
        total_issues += len(todos)
        print()

    # Summary
    print(f"{'═'*60}")
    if total_issues == 0:
        print("  ✅  Repo is clean — no issues found.")
    else:
        print(f"  {'⚠️ ' if total_issues else '✅'} {total_issues} issue(s) found.")

    if all_safe_to_delete:
        print(f"  🗑️  {len(all_safe_to_delete)} file(s) safe to delete.")
        if args.fix:
            if confirm_delete(all_safe_to_delete):
                git_rm(all_safe_to_delete)
        else:
            print("  ℹ️  Run with --fix to remove dead files.")
    print(f"{'═'*60}\n")

    return 1 if total_issues else 0


if __name__ == "__main__":
    sys.exit(main())
