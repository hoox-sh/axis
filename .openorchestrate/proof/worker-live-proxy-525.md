# Worker `/api/ws/live` Upgrade → Cloudflare 525

Status: **Blocked**. Nginx was not reloaded. No DNS change. No PEM material in this file. The local origin pair was not deleted.

## Before (through Cloudflare, Mozilla UA, no `--resolve`)

2026-11-19 03:03:29Z:

| probe                                                                                 | status           | server                                         |
| ------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------- |
| `https://pynescript.online/health`                                                    | HTTP/2 **525**   | `cloudflare` (`cf-ray` `a5cbfb68fac6d271-FRA`) |
| `https://pynescript.online/ws/live` Upgrade (`Sec-WebSocket-Version: 13`, sample key) | HTTP/1.1 **525** | `cloudflare` (`cf-ray` `a5cbfb6aba85dbf7-FRA`) |

Body both times: `error code: 525`.

## After

Same probes at 2026-11-19 03:23:28Z, still **525** / `server: cloudflare` (`cf-ray` health `a5cc18ae8eeecef6-FRA`, ws `a5cc18b04b6ddc7d-FRA`). No nginx reload happened between the two probes.

## Origin certificate still served

`openssl s_client -servername pynescript.online -connect 172.174.232.254:443` (public trust verify return code 0):

- subject `CN=pynescript.online`
- issuer `Let's Encrypt` `CN=YE2`
- notBefore `Nov 18 20:59:33 2026 GMT`, notAfter `Feb 16 20:59:32 2027 GMT`
- SAN `pynescript.online`, `www.pynescript.online`

Not a Cloudflare Origin CA certificate. Nginx `ssl_certificate` path was **not** read and **not** changed.

## Local pair (not installed)

`/mnt/data/tmp/axis-park/pyne-origin/origin.crt` and `origin.key` (mode 600). `openssl` modulus MD5 hashes match (`c12169987ef8ea29465a985c1be3354a`). SAN `pynescript.online`, `*.pynescript.online`. Issuer Cloudflare Origin CA. notBefore `Nov 19 02:56:00 2026 GMT`, notAfter `Nov 15 02:56:00 2041 GMT`. Left on disk because the reload did not happen.

## Why it stopped

1. SSH host `pynescript` resolves to `204.168.138.51` as `root`. Port 22 timed out. That is not the origin.
2. Origin `172.174.232.254` port 22 answered once: `root` with `id_ed25519` and `id_rsa` both `Permission denied (publickey)`. The documented account is `azureuser` with `~/.ssh/id_rsa`.
3. After those root failures, port 22 to `172.174.232.254` times out (checked through 03:22Z). Port 443 still answers. `az` is not logged in; no login was started.

## Remaining step

From this workstation, once `ssh -i ~/.ssh/id_rsa azureuser@172.174.232.254` connects: back up the live `ssl_certificate` and `ssl_certificate_key` files with a timestamp (do not delete the Let's Encrypt files), install the origin pair at `/etc/ssl/cloudflare/pynescript.online.crt` (0644 root:root) and `.key` (0600 root:root), point that `pynescript.online` server at those paths, `nginx -t`, reload, then repeat the Cloudflare health and `/ws/live` Upgrade probes. Stay proxied. SSL mode must be Full (strict). Do not grey-cloud DNS. Delete the local pair only after a successful reload. Ready for Review only if `/ws/live` returns 101.
