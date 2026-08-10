# @hoox-sh/axis-cli

**AXIS CLI** — install flows, doctor, Worker setup (D1 / OAuth), secrets, deploy, and health probes for the [AXIS](https://hoox.sh/axis) charting PWA.

Requires **Bun ≥ 1.2**.

## Install (from the AXIS monorepo)

```bash
# from repo root
bun install
cd packages/cli && bun install && cd ../..

# run
bun packages/cli/bin/axis.js --help
# or after link:
cd packages/cli && bun link && axis --help
```

Root package scripts:

```bash
bun run axis --help
bun run axis:doctor
```

## Commands

| Command | Purpose |
|---------|---------|
| `axis install` | `bun install` for app, `worker/`, and CLI |
| `axis doctor` | Toolchain + `wrangler.toml` + optional Cloudflare auth |
| `axis doctor --remote` | Also probe deployed Worker `/health` |
| `axis setup` | Full bootstrap (install → toml → local D1) |
| `axis setup worker` | Ensure `worker/wrangler.toml` (copy from example) |
| `axis setup d1 [--local] [--remote] [--create]` | Apply `schemas/scripts.sql` |
| `axis setup oauth --github-client-id Ov23li…` | Set OAuth client id in `[vars]` |
| `axis setup oauth --github-client-id … --secret` | Or as Worker secret |
| `axis secret put ADMIN_TOKEN` | `wrangler secret put` |
| `axis secret list` / `axis secret delete <name>` | List / delete secrets |
| `axis deploy` / `axis deploy worker` | Deploy Worker `pynescript-axis` |
| `axis deploy pages` | Vite build + Pages project |
| `axis deploy all` | Worker then Pages |
| `axis health [--oauth] [--url …]` | Probe `/health` (+ GitHub device OAuth start) |
| `axis whoami` | Cloudflare account |
| `axis dev` / `axis dev worker` / `axis dev desktop` | Local servers |

Global flags: `--json`, `--quiet`, `-y/--yes`.

## Typical production flow

```bash
axis install
axis doctor
axis setup --github-client-id Ov23liekgk16zDDiHBz1 --remote-d1
axis secret put ADMIN_TOKEN
axis secret put EXTERNAL_BACKEND   # public HTTPS PYNE/Flask base
axis deploy worker
axis health --oauth
```

Env overrides:

| Variable | Role |
|----------|------|
| `AXIS_ROOT` | Force monorepo root |
| `AXIS_WORKER_URL` | Default health/deploy probe URL |
| `CLOUDFLARE_API_TOKEN` | Wrangler auth (non-interactive) |
| `AXIS_CLI_SRC=1` | Force bin to load `src/` over `dist/` |

## License

AGPL-3.0-only · jango_blockchained
