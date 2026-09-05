# AXIS interface screenshots

Captured 2026-09-05 from `https://axis.hoox.sh` (void dark, BTCUSDT 1d Binance REST). Desktop 1440×900 @2x. No secrets.

| Dir | Contents |
| --- | --- |
| [`app/`](app/) | PWA chrome, chart, editor, research panels |
| [`studio/`](studio/) | Runtime / Wire / Settings / Workers / Plugins |
| [`cli/`](cli/) | `axis --help` and `axis doctor` |
| [`landing/`](landing/) | Hero + feature tiles for [hoox.sh/axis](https://hoox.sh/axis) |
| [`gifs/`](gifs/) | Short looping tours |

Gallery: [Interface gallery](../enduser/guides/screenshots.mdx).

Regenerate:

```bash
bun scripts/capture-screenshots.ts          # stills + GIFs + CLI
bun scripts/capture-screenshots.ts --skip-gifs
bun scripts/capture-screenshots.ts --gifs-only --skip-cli
bun scripts/capture-fix.ts                  # recapture cluttered full-page shots
```
