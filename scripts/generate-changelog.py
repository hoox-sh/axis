#!/usr/bin/env python3
# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only
"""
Regenerate CHANGELOG.md from full git history (recursive).

Preserves a hand-written "## [Unreleased]" / "## [x.y.z]" preamble if present
between the header and the auto "Full history" section; otherwise writes a
minimal Unreleased stub.

Usage:
  python3 scripts/generate-changelog.py
  python3 scripts/generate-changelog.py --out CHANGELOG.md
"""

from __future__ import annotations

import argparse
import re
import subprocess
from collections import defaultdict
from datetime import date
from pathlib import Path

TYPE_TITLES = {
    "feat": "Features",
    "fix": "Fixes",
    "perf": "Performance",
    "security": "Security",
    "docs": "Documentation",
    "refactor": "Refactors",
    "test": "Tests",
    "ci": "CI",
    "chore": "Chores",
    "style": "Style",
    "build": "Build",
    "revert": "Reverts",
    "merge": "Merges",
    "other": "Other",
}
TYPE_ORDER = [
    "security",
    "feat",
    "fix",
    "perf",
    "refactor",
    "docs",
    "ci",
    "test",
    "build",
    "chore",
    "style",
    "revert",
    "merge",
    "other",
]

FULL_HISTORY_MARKER = "## Full history (recursive)"
HOW_TO_MARKER = "## How to update"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def classify(subject: str) -> str:
    s = subject.lower()
    if s.startswith("merge "):
        return "merge"
    for p in (
        "feat",
        "fix",
        "perf",
        "docs",
        "refactor",
        "test",
        "ci",
        "chore",
        "style",
        "build",
        "revert",
        "security",
    ):
        if s.startswith(f"{p}(") or s.startswith(f"{p}:") or s.startswith(f"{p} "):
            return p
    if "security" in s or "harden" in s:
        return "security"
    return "other"


def load_commits() -> list[tuple[str, str, str, str]]:
    raw = git("log", "--pretty=format:%H\t%h\t%ad\t%s", "--date=short")
    rows: list[tuple[str, str, str, str]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        full, short, d = parts[0], parts[1], parts[2]
        subject = "\t".join(parts[3:])
        rows.append((full, short, d, subject))
    return rows


def extract_preamble(existing: str | None) -> str | None:
    """Keep human sections above Full history when regenerating."""
    if not existing:
        return None
    if FULL_HISTORY_MARKER not in existing:
        # Keep everything after title block if no marker yet
        m = re.search(r"(^## \[Unreleased\].*)", existing, re.M | re.S)
        return m.group(1).strip() if m else None
    before = existing.split(FULL_HISTORY_MARKER, 1)[0]
    # Drop auto header (everything before first ## [)
    m = re.search(r"(^## \[.*)", before, re.M | re.S)
    return m.group(1).strip() if m else None


def render_type_groups(
    items: list[tuple[str, str, str]],
) -> list[str]:
    by_t: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for short, d, subj in items:
        by_t[classify(subj)].append((short, d, subj))
    out: list[str] = []
    for t in TYPE_ORDER:
        if t not in by_t:
            continue
        out.append(f"#### {TYPE_TITLES.get(t, t)}")
        out.append("")
        for short, d, subj in by_t[t]:
            safe = subj.replace("|", "\\|")
            out.append(f"- `{short}` ({d}) — {safe}")
        out.append("")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="CHANGELOG.md")
    args = ap.parse_args()
    out_path = Path(args.out)
    existing = out_path.read_text() if out_path.exists() else None
    preamble = extract_preamble(existing)

    rows = load_commits()
    by_month: dict[str, list[tuple[str, str, str, str]]] = defaultdict(list)
    for r in rows:
        by_month[r[2][:7]].append(r)

    try:
        last_tag = git("describe", "--tags", "--abbrev=0")
    except subprocess.CalledProcessError:
        last_tag = "none"

    lines: list[str] = []
    lines.append("# Changelog")
    lines.append("")
    lines.append(
        "All notable changes to **AXIS** (`hoox-sh/axis`) are documented in this file."
    )
    lines.append("")
    lines.append(
        "This changelog is **recursive**: it lists the full git history of the"
    )
    lines.append(
        "repository, grouped by month and conventional-commit type. Agents and"
    )
    lines.append(
        "humans **must keep it updated** on every release (see `AGENTS.md` § Changelog & releases)."
    )
    lines.append("")
    lines.append(
        "Format roughly follows [Keep a Changelog](https://keepachangelog.com/) with"
    )
    lines.append("commit SHAs for traceability.")
    lines.append("")
    lines.append(
        f"_Generated/updated: {date.today().isoformat()} · {len(rows)} commits · describe-tag: `{last_tag}`_"
    )
    lines.append("")
    lines.append("---")
    lines.append("")

    if preamble:
        lines.append(preamble.rstrip())
        lines.append("")
    else:
        lines.append("## [Unreleased]")
        lines.append("")
        lines.append("_Add release notes here before tagging._")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(FULL_HISTORY_MARKER)
    lines.append("")

    for month in sorted(by_month.keys(), reverse=True):
        commits = by_month[month]
        lines.append(f"### {month} ({len(commits)} commits)")
        lines.append("")
        items = [(short, d, subj) for _f, short, d, subj in commits]
        lines.extend(render_type_groups(items))

    lines.append("---")
    lines.append("")
    lines.append(HOW_TO_MARKER)
    lines.append("")
    lines.append("1. Edit **[Unreleased]** (or the new version section) by hand for the story.")
    lines.append("2. Regenerate the recursive history block:")
    lines.append("")
    lines.append("```bash")
    lines.append("python3 scripts/generate-changelog.py")
    lines.append("```")
    lines.append("")
    lines.append("3. Commit changelog with the release; then tag, push, publish, sync")
    lines.append("   (see `AGENTS.md` § Changelog & releases).")
    lines.append("")

    out_path.write_text("\n".join(lines) + "\n")
    print(f"Wrote {out_path} ({len(rows)} commits, {len(by_month)} months)")


if __name__ == "__main__":
    main()
