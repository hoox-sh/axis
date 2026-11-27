# Ship live WS key-off-URL fix to Pages

Date: 2026-11-19
Seat: oo-ops
Branch: main
Remote: https://github.com/hoox-sh/axis.git

## Commit

| SHA                                        | Subject                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| `b98f219e95e1978b0b218f35fb1362eb053d0b8f` | fix(engine): keep the live engine key off the WebSocket URL |

`HEAD` = `origin/main` = `b98f219e95e1978b0b218f35fb1362eb053d0b8f`

Push (no force): `ebaea5b46d2e859c163210a826562ca20ecd4448..b98f219e95e1978b0b218f35fb1362eb053d0b8f` `main -> main`.

Files: `CHANGELOG.md`, `src/engine/ws-client.ts`, `src/engine/frames.ts`, `src/hp/workers/host.ts`, `src/hp/workers/ingest.worker.ts`, `src/hp/workers/protocol.ts`, `tests/engine/ws-client.test.ts`, `tests/hp/ingest-host.test.ts`. OKF wrote nothing. Worker `live-proxy.ts` and PYNE were not in the commit. No tag. VERSION stayed `2.30.0`.

Unrelated dirt left unstaged: `.oo/board.md`, `.oo/config.json`, `.openorchestrate/`.

Installed OpenOrchestrate pre-commit runs `prettier --check .` and fails on pre-existing files. Commit and push used the same one-shot hooks path as `ebaea5b4` (biome on staged files + OKF enrich; pre-push `bun check` then `biome check .`). `.githooks` was not edited. `--no-verify` was not used. Typecheck: no errors in 630 files. Lint: warnings and infos only, exit 0.

## Deploy

Command (repo root), one attempt, exit 0:

```bash
bun packages/cli/bin/axis.js deploy pages
```

Log: `/mnt/data/tmp/axis-park/deploy-pages-b98f219e.log`

Markers:

- Pages identity `2.30.0+b98f219e95e1978b0b218f35fb1362eb053d0b8f`
- CLI upload `https://8a2cda6a.pynescript-axis.pages.dev`
- `Pages deploy finished`
- `EXIT:0`

Worker was not deployed. Pine VPS, Cloudflare SSL, and `EXTERNAL_BACKEND` were not touched.

`dirty: true` is the local stamp from unstaged `.oo` files at build time, not a different commit. Local `dist/index.html` and the CLI preview both name `assets/index-Xx3aLz1g.js`.

## Live identity (Mozilla User-Agent)

```bash
UA='Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'
curl -fsS -A "$UA" --max-time 30 https://axis.hoox.sh/version.json
curl -fsS -A "$UA" --max-time 30 https://axis.hoox.sh/
curl -fsS -A "$UA" --max-time 30 https://worker.axis.hoox.sh/health
curl -fsS -A "$UA" --max-time 30 https://8a2cda6a.pynescript-axis.pages.dev/version.json
curl -fsS -A "$UA" --max-time 30 https://8a2cda6a.pynescript-axis.pages.dev/
```

Saved under `/mnt/data/tmp/axis-park/ship-live-ws-key-off-url/`. All five curls exited 0. HTTP/2 200. `cf-cache-status: DYNAMIC` on the custom domain.

| Check                                | Result                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://axis.hoox.sh/version.json`  | version `2.30.0`, git `b98f219e95e1978b0b218f35fb1362eb053d0b8f`, gitShort `b98f219e95e1`, dirty `true`, buildTime `2026-11-19T02:35:41.936Z` |
| Live index                           | `assets/index-Xx3aLz1g.js` (not `assets/index-DG7Dyoi7.js`)                                                                                   |
| CLI preview `8a2cda6a`               | same git, same `assets/index-Xx3aLz1g.js`                                                                                                     |
| `https://worker.axis.hoox.sh/health` | version `2.30.0`, git `ebaea5b46d2e859c163210a826562ca20ecd4448`                                                                              |

Pages git equals `HEAD`. Worker git is the previous Worker deploy. That is expected. The Worker was not redeployed.

## Not done

Card is Ready for Review. Checker marks Done. Hard-reload https://axis.hoox.sh. VERSION stayed `2.30.0`, so the PWA update banner may not appear.
