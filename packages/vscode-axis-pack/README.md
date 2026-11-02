# AXIS Trading Pack

**Extension pack** that installs [PYNE Language Support](https://marketplace.visualstudio.com/items?itemName=hoox-sh.pyne) (`hoox-sh.pyne`) and [AXIS IDE](https://marketplace.visualstudio.com/items?itemName=hoox-sh.axis-ide) (`hoox-sh.axis-ide`) together.

| | |
| --- | --- |
| **Pack id** | `hoox-sh.axis` |
| **License** | [AGPL-3.0-only](./LICENSE) |
| **Members** | `hoox-sh.pyne`, `hoox-sh.axis-ide` |

Part of the **[HOOX](https://hoox.sh) open trading stack**. Sister products: **[PYNE](https://hoox.sh/pyne)** (Pine language tooling) and **[AXIS](https://hoox.sh/axis)** (charting IDE).

> Independent, unofficial pack. **Not** affiliated with, endorsed by, or sponsored by TradingView, Inc.
> Pine Script™ and TradingView® are trademarks of TradingView, Inc.

## Install

From the VS Code / Open VSX Marketplace, search for **AXIS Trading Pack**, or install the VSIX:

```bash
bun run --cwd packages/vscode-axis-pack package   # → axis-0.1.0.vsix
code --install-extension axis-0.1.0.vsix
```

Root alias (when wired): `bun run vscode:pack:package`.

## License

GNU Affero General Public License **version 3 only** (SPDX: `AGPL-3.0-only`). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
No “or later” option for this pack or for **AXIS IDE** (`hoox-sh.axis-ide`).

**KD-3:** pack member **PYNE** (`hoox-sh.pyne`) remains **AGPL-3.0-or-later**. Do not treat pack/IDE AGPL-3.0-only as applying to PYNE, and do not relicense PYNE as AGPL-3.0-only.
