# AXIS interface screenshots

Captured 2026-09-05 from `https://axis.hoox.sh` (void dark, BTCUSDT 1d Binance REST). No secrets.

## Series

| Series | Viewport | Device pixel ratio | File pixels | Path |
| --- | --- | --- | --- | --- |
| **1080p (docs default)** | 1920×1080 | 2 | 3840×2160 | [`app/`](app/), [`studio/`](studio/), [`landing/`](landing/) — also [`1920x1080/`](1920x1080/) |
| **1440p** | 2560×1440 | 2 | 5120×2880 | [`2560x1440/`](2560x1440/) |

| Dir | Contents |
| --- | --- |
| [`app/`](app/) | PWA chrome, chart, editor, research panels (1920×1080 @2x) |
| [`studio/`](studio/) | Runtime / Wire / Settings / Workers / Plugins |
| [`cli/`](cli/) | `axis --help` and `axis doctor` |
| [`landing/`](landing/) | Hero + feature tiles for [hoox.sh/axis](https://hoox.sh/axis) |
| [`gifs/`](gifs/) | Short looping tours |
| [`1920x1080/`](1920x1080/) | Same 1080p stills, named series folder |
| [`2560x1440/`](2560x1440/) | QHD stills |

Gallery: [Interface gallery](../enduser/guides/screenshots.mdx).

Regenerate:

```bash
bun run capture:1080p   # 1920×1080 @2x → docs/images/{app,studio,landing}
bun run capture:1440p   # 2560×1440 @2x → docs/images/2560x1440
bun scripts/capture-fix.ts --viewport=1920x1080 --dpr=2
bun scripts/capture-fix.ts --viewport=2560x1440 --dpr=2 --out=docs/images/2560x1440
bun scripts/capture-screenshots.ts --gifs-only --skip-cli
```
