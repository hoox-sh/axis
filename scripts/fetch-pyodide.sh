#!/usr/bin/env bash
# Download a minimal self-hosted Pyodide bundle into public/pyodide/v<version>/
# Usage: ./scripts/fetch-pyodide.sh [0.26.2]
set -euo pipefail
VERSION="${1:-0.26.2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/pyodide/v${VERSION}"
BASE="https://cdn.jsdelivr.net/pyodide/v${VERSION}/full"
mkdir -p "$DEST"
cd "$DEST"
for f in pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json package.json; do
  echo "→ $f"
  curl -fsSL -o "$f" "$BASE/$f"
done
python3 - "$VERSION" <<'PY'
import hashlib, json, sys, urllib.request
from pathlib import Path
version = sys.argv[1]
lock = json.loads(Path("pyodide-lock.json").read_text())
need = {"micropip"}
changed = True
while changed:
    changed = False
    for n in list(need):
        p = lock["packages"].get(n) or {}
        for d in p.get("depends") or []:
            if d not in need:
                need.add(d)
                changed = True
base = f"https://cdn.jsdelivr.net/pyodide/v{version}/full"
for n in sorted(need):
    info = lock["packages"][n]
    fn = info["file_name"]
    print("→", fn)
    urllib.request.urlretrieve(f"{base}/{fn}", fn)
    # G14: verify every lock-covered artifact against the lock's sha256.
    # A mismatch (mirror tampering / truncated download) fails the fetch.
    expected = info.get("sha256") or info.get("sha")
    if not expected:
        print(f"WARNING: no sha256 in lock for {n} ({fn}) — skipping verification")
        continue
    actual = hashlib.sha256(Path(fn).read_bytes()).hexdigest()
    if actual != expected:
        print(f"SHA-256 MISMATCH for {fn}: expected {expected}, got {actual}", file=sys.stderr)
        sys.exit(1)
    print("  sha256 ok:", fn)
print("OK →", Path(".").resolve())
PY
du -sh "$DEST"
echo "Default indexUrl: /pyodide/v${VERSION}/"
