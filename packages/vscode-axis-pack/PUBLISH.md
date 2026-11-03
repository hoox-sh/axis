# Publishing AXIS Trading Pack

Publisher **`hoox-sh`**, extension id **`hoox-sh.axis`**.

Full Marketplace + Open VSX dry-run steps, token verify, and **publish order**
(IDE before pack; pack only after `hoox-sh.pyne` + `hoox-sh.axis-ide` are live
on the target gallery) live in:

**[`../vscode-axis-ide/PUBLISH.md`](../vscode-axis-ide/PUBLISH.md)**

Quick package dry-run (no upload):

```bash
bun run --cwd packages/vscode-axis-pack package
# → axis-<ver>.vsix
```

This `PUBLISH.md` is **repo-only** — listed in pack `.vscodeignore` so it does
not ship inside `axis-*.vsix` (README.md still ships).
