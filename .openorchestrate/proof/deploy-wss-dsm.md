# Deploy checked WSS fallback and DSM summary inset

Date: 2026-11-19
Seat: oo-ops
Branch: main
Remote: https://github.com/hoox-sh/axis.git

## Commits (pushed, no force, no tag, VERSION unchanged)

| SHA                                        | Subject                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `b198d845dbac370ada35aae48ff90b3b4448a48c` | fix(engine): fall back to direct /ws/live when the ticket upgrade fails |
| `ebaea5b46d2e859c163210a826562ca20ecd4448` | fix(ui): inset the Data Manager summary strip                           |

`HEAD` = `origin/main` = `ebaea5b46d2e859c163210a826562ca20ecd4448`

Both Unreleased CHANGELOG Fixed bullets are on that tip. SSL, `EXTERNAL_BACKEND`, and the Pine VPS were not changed.

## Deploy

Command (repo root), exit 0:

```bash
bun packages/cli/bin/axis.js deploy all
```

Log markers: remote D1 schema applied, Worker git SHA `ebaea5b46d2e859c163210a826562ca20ecd4448`, Health git same SHA, Worker deployed, Pages identity `2.30.0+ebaea5b46d2e859c163210a826562ca20ecd4448`, Pages deploy finished, Deploy all complete.

## Live identity (Mozilla User-Agent)

| Check                                | Result                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `https://worker.axis.hoox.sh/health` | version `2.30.0`, git `ebaea5b46d2e859c163210a826562ca20ecd4448`               |
| `https://axis.hoox.sh/version.json`  | version `2.30.0`, git `ebaea5b46d2e859c163210a826562ca20ecd4448`, dirty `true` |
| Live index                           | `assets/index-DG7Dyoi7.js`                                                     |

Worker git and Pages git both equal `HEAD`.

## Pages rows disagree

| Row                                                      | Deployment                                            | index                      | version.json dirty |
| -------------------------------------------------------- | ----------------------------------------------------- | -------------------------- | ------------------ |
| CLI upload (latest production; what the command printed) | `2653717d` https://2653717d.pynescript-axis.pages.dev | `assets/index-DG7Dyoi7.js` | true               |
| Git Pages (previous production row, same SHA)            | `5023cedc` https://5023cedc.pynescript-axis.pages.dev | `assets/index-BOlcUYVH.js` | false              |

https://axis.hoox.sh serves the CLI row: `assets/index-DG7Dyoi7.js`. Pages was not deployed a second time. `dirty: true` is the local stamp from unstaged `.oo` files at build time, not a different commit.

## Not done

Card stays Ready for Review. Checker marks Done. Hard-reload axis.hoox.sh; same VERSION `2.30.0` so the update banner may not show.
