# Publishing AXIS IDE + Trading Pack

Maintainer guide for dual-publishing **`hoox-sh.axis-ide`** (this package) and
the optional extension pack **`hoox-sh.axis`** ([`packages/vscode-axis-pack`](../vscode-axis-pack/))
to the **Visual Studio Marketplace** (`@vscode/vsce`) and **Open VSX** (`ovsx`).

**Do not publish from this doc during Task 26 / PR dry-runs.** Package and
verify only; leave real `publish` commands for a deliberate release.

| | IDE | Pack |
| --- | --- | --- |
| Path | `packages/vscode-axis-ide` | `packages/vscode-axis-pack` |
| Extension id | `hoox-sh.axis-ide` | `hoox-sh.axis` |
| Publisher | `hoox-sh` | `hoox-sh` |
| VSIX name | `axis-ide-<ver>.vsix` | `axis-<ver>.vsix` |
| Manifest edge | `extensionDependencies: ["hoox-sh.pyne"]` | `extensionPack: ["hoox-sh.pyne", "hoox-sh.axis-ide"]` |

Hard dependency **`hoox-sh.pyne`** must already be listed on both marketplaces
(same publisher namespace). Pack install only pulls already-published members.

## Tokens and namespace

| Registry | CLI | Secret / env | Notes |
| --- | --- | --- | --- |
| VS Marketplace | `npx @vscode/vsce` | `VSCE_PAT` | Azure DevOps PAT with **Marketplace → Manage** for publisher `hoox-sh` |
| Open VSX | `npx ovsx` | `OVSX_PAT` | Eclipse Open VSX PAT; namespace **`hoox-sh`** must exist (same as PYNE) |

Verify tokens without uploading:

```bash
# Marketplace — publisher rights for hoox-sh
npx --yes @vscode/vsce verify-pat -p "$VSCE_PAT" hoox-sh

# Open VSX — namespace rights
npx --yes ovsx verify-pat -p "$OVSX_PAT" hoox-sh
```

Optional: `npx @vscode/vsce show hoox-sh.pyne` / `npx ovsx show hoox-sh.pyne` to
confirm the PYNE listing before shipping the IDE.

## Dry-run: package only (no upload)

Neither `vsce publish` nor `ovsx publish` exposes a `--dry-run` flag. Treat
**compile → package → `vsce ls` → local VSIX install** as the dry-run.

### IDE (`hoox-sh.axis-ide`)

```bash
cd packages/vscode-axis-ide

# Host + webviews (also runs via vscode:prepublish on package)
bun run compile   # or: npm run compile

# List files that would enter the VSIX (.vscodeignore applied)
npx --yes @vscode/vsce ls --no-dependencies

# Build the artifact (same flags as package.json "package" script)
bun run package
# → axis-ide-0.1.0.vsix (version from package.json)

# Optional local install smoke (requires hoox-sh.pyne already installed)
code --install-extension ./axis-ide-$(node -p "require('./package.json').version").vsix
```

Root alias (when wired): `bun run vscode:ide:package`.

### Pack (`hoox-sh.axis`)

```bash
cd packages/vscode-axis-pack

npx --yes @vscode/vsce ls --no-dependencies
bun run package
# → axis-0.1.0.vsix

code --install-extension ./axis-$(node -p "require('./package.json').version").vsix
```

Pack VSIX is manifest-only (`extensionPack`); it does not rebundle PYNE or the IDE.

## Publish order

Publish **member extensions before the pack**. Recommended sequence:

1. **`hoox-sh.pyne`** already live on Marketplace + Open VSX (sibling repo).
2. **`hoox-sh.axis-ide`** → Marketplace, then Open VSX (or both in one release job).
3. **`hoox-sh.axis`** pack → Marketplace, then Open VSX **after** both members
   resolve on that registry.

Rationale: Marketplace/Open VSX resolve `extensionDependencies` /
`extensionPack` by published id. Publishing the pack first leaves one-click
install broken until the IDE (and PYNE) exist on that same gallery.

Same version bump policy as PYNE: bump `package.json` `version` before
publishing; Marketplace rejects re-upload of an existing version.

## Real publish (release only — do not run for dry-run)

After dry-run packaging and `verify-pat` succeed:

```bash
# --- IDE ---
cd packages/vscode-axis-ide
bun run package
VSIX="axis-ide-$(node -p "require('./package.json').version").vsix"

npx --yes @vscode/vsce publish --pat "$VSCE_PAT" --packagePath "$VSIX" --no-dependencies
npx --yes ovsx publish "$VSIX" -p "$OVSX_PAT"

# --- Pack (only after IDE is visible on both galleries) ---
cd ../vscode-axis-pack
bun run package
VSIX="axis-$(node -p "require('./package.json').version").vsix"

npx --yes @vscode/vsce publish --pat "$VSCE_PAT" --packagePath "$VSIX" --no-dependencies
npx --yes ovsx publish "$VSIX" -p "$OVSX_PAT"
```

Pre-release / dogfood (optional): add `--pre-release` to both CLIs. Prefer a
GitHub Release VSIX for Cursor dogfood until the gallery listing is ready.

Open VSX may fail on unknown publisher even when Marketplace succeeds — same
fail-open pattern as PYNE’s `release.yml` (keep the VSIX on the GitHub Release).

## CI notes

[`.github/workflows/vscode-axis-ide.yml`](../../.github/workflows/vscode-axis-ide.yml)
packages the IDE VSIX as an artifact; it does **not** publish. Wire
`VSCE_PAT` / `OVSX_PAT` into a future release job only when intentionally
shipping (mirror `hoox-sh/pyne` vscode publish).

## `PUBLISH.md` and the VSIX

`.vscodeignore` keeps `**/*.md` out of the VSIX except `README.md`. This file
is **repo-only** maintainer documentation and is intentionally **not** shipped
inside `axis-ide-*.vsix`. Leave it that way unless marketplace reviewers need
it in-package (`!PUBLISH.md` allowlist).
