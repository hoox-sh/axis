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
  python3 scripts/generate-changelog.py --extract 2.24.6 --tag v2.24.6
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
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
VERSION_HEADING_RE = re.compile(r"^## \[([^\]]+)\]")


def normalize_version(raw: str) -> str:
    """Strip workflow tag prefixes (``desktop-v*``, ``v*``) so headings match."""
    s = str(raw or "").strip()
    if s.lower().startswith("desktop-v"):
        s = s[len("desktop-v") :]
    return s.lstrip("vV")


def extract_version_section(md: str, version: str) -> str | None:
    """Keep-a-Changelog section for ``version`` (tag prefixes stripped)."""
    ver = normalize_version(version)
    if not ver or not md:
        return None
    lines = md.splitlines()
    start: int | None = None
    for i, line in enumerate(lines):
        m = VERSION_HEADING_RE.match(line)
        if not m:
            continue
        name = m.group(1).strip()
        if name.lower() == "unreleased":
            continue
        if name.split()[0] == ver:
            start = i
            break
    if start is None:
        return None
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if VERSION_HEADING_RE.match(lines[j]):
            end = j
            break
        if lines[j].startswith(FULL_HISTORY_MARKER) or lines[j].startswith(
            HOW_TO_MARKER
        ):
            end = j
            break
    body = "\n".join(lines[start:end]).strip()
    return body or None


def format_github_release_notes(section: str | None, tag: str, version: str) -> str:
    """Section plus installer footer; missing section yields a warning body."""
    label = tag.strip() or f"v{normalize_version(version)}"
    footer = (
        "Desktop installers (Tauri 2). CLI tarball, worker bundle, and checksums "
        "attach from the Release workflow."
    )
    if section:
        return f"{section}\n\n---\n\n{footer}\n"
    return (
        f"AXIS {label}\n\n"
        f"No `## [{normalize_version(version)}]` section in CHANGELOG.md. "
        "See the file in the repository.\n\n"
        f"---\n\n{footer}\n"
    )


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
        subject = "\t".join(parts[3:]).replace("<", "&lt;").replace(">", "&gt;")
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
    ap.add_argument(
        "--extract",
        metavar="VERSION",
        help="Print GitHub Release notes for this version (e.g. 2.24.6) and exit",
    )
    ap.add_argument("--tag", default="", help="Release tag label (default v<VERSION>)")
    args = ap.parse_args()
    out_path = Path(args.out)
    if args.extract:
        # UTF-8 explicitly: the Windows runner's default codepage (cp1252)
        # cannot decode the changelog's typographic quotes/em-dashes.
        md = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        section = extract_version_section(md, args.extract)
        tag = args.tag.strip() or f"v{normalize_version(args.extract)}"
        notes = format_github_release_notes(section, tag, args.extract)
        # Write bytes: stdout's locale encoding would choke on the same chars.
        sys.stdout.buffer.write(notes.encode("utf-8"))
        sys.stdout.buffer.flush()
        if not section:
            print(
                f"::warning::CHANGELOG.md has no section for {normalize_version(args.extract)}",
                file=sys.stderr,
            )
        return
    existing = out_path.read_text(encoding="utf-8") if out_path.exists() else None
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
    lines.append(
        "1. Edit **[Unreleased]** (or the new version section) by hand for the story."
    )
    lines.append("2. Regenerate the recursive history block:")
    lines.append("")
    lines.append("```bash")
    lines.append("python3 scripts/generate-changelog.py")
    lines.append("```")
    lines.append("")
    lines.append("3. Commit changelog with the release; then tag, push, publish, sync")
    lines.append("   (see `AGENTS.md` § Changelog & releases).")
    lines.append("")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} ({len(rows)} commits, {len(by_month)} months)")


if __name__ == "__main__":
    main()
