#!/usr/bin/env python3
"""Audit graph generator for AXIS app and HP engine (separate).
Writes Markdown + DOT references from OKF / import tree.
Usage: python3 scripts/audit-graph.py [app|hp] [out.md]
"""
import os, sys, re, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

APP_DIRS = ["src", "docs"]
HP_DIRS = ["src/hp", "tests/hp", "worker/src"]

def refs(path):
    refs = {}
    for root, _, files in os.walk(path):
        for f in files:
            if not f.endswith(".ts") and not f.endswith(".tsx") and not f.endswith(".md"):
                continue
            fp = os.path.join(root, f)
            try:
                txt = open(fp, "r", encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            # Import references
            for m in re.finditer(r"from ['\"]([^'\"]+)['\"]", txt):
                refs.setdefault(fp, set()).add(m.group(1))
            # Mention links (OKF / concept refs)
            for m in re.finditer(r"(#\w+|[\w-]+\.(ts|tsx|md))", txt):
                refs.setdefault(fp, set()).add(m.group(0))
    return refs

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "app"
    dirs = APP_DIRS if mode == "app" else HP_DIRS
    out = sys.argv[2] if len(sys.argv) > 2 else f"audit-{mode}.md"
    all_refs = {}
    for d in dirs:
        p = os.path.join(ROOT, d)
        if os.path.isdir(p):
            all_refs.update(refs(p))
    with open(out, "w") as f:
        f.write(f"# Audit Graph: {mode}\n\n")
        f.write(f"Sources: {', '.join(dirs)}\n\n")
        f.write("## References per file\n")
        for fp in sorted(all_refs):
            rel = os.path.relpath(fp, ROOT)
            f.write(f"\n### `{rel}`\n")
            for r in sorted(all_refs[fp]):
                f.write(f"- `{r}`\n")
    print(f"Wrote {out} ({len(all_refs)} files, {sum(len(s) for s in all_refs.values())} refs)")

if __name__ == "__main__":
    main()
