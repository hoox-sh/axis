/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Result of any single probe — never thrown, so a doctor run can report every row.
 *
 * `ok` means the probe's own success rule passed, not merely that a response
 * arrived; `status` is absent only when the request never completed.
 */
export type HealthResult = {
  ok: boolean;
  url: string;
  status?: number;
  body?: unknown;
  error?: string;
};

const FALLBACK_WORKER_URL = 'https://worker.axis.hoox.sh';

/**
 * Resolves the AXIS Worker base URL.
 *
 * Prefers `AXIS_WORKER_URL` over the hosted default and strips one trailing slash so
 * route paths can be appended directly.
 *
 * @returns Base URL without a trailing slash; never empty.
 */
export function defaultWorkerUrl(): string {
  const fromEnv = process.env.AXIS_WORKER_URL?.trim();
  return (fromEnv || FALLBACK_WORKER_URL).replace(/\/$/, '');
}

/** Loopback hosts where plain http:// is acceptable (local dev only). */
export function isLocalWorkerUrl(base: string): boolean {
  try {
    // URL keeps IPv6 brackets in hostname ("[::1]") — strip them.
    const host = new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

/**
 * Refuse to send a secret (admin token, API key) over http:// to a
 * non-local host. Plain Error — callers surface it via wrapAction/handleError.
 */
export function assertHttpsForSecret(base: string, what: string): void {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`Invalid worker URL for ${what}: ${JSON.stringify(base)}`);
  }
  if (url.protocol === 'http:' && !isLocalWorkerUrl(base)) {
    throw new Error(
      `${what} refuses http://${url.host} (non-local): the secret would cross ` +
        `the network in cleartext. Use https:// or a localhost URL.`,
    );
  }
}

/** True when an HTTP payload is a live AXIS/PYNE health document. */
export function isHealthyPayload(httpStatus: number, body: unknown): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (typeof body !== 'object' || body === null) return false;
  const status = (body as { status?: unknown }).status;
  return status === 'healthy' || status === 'ok';
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * GETs a health endpoint and classifies the payload.
 *
 * Non-JSON responses are returned as raw text in `body` so a misrouted host still
 * shows what answered. `ok` follows {@link isHealthyPayload}: 2xx **and**
 * `status: "ok"` or `"healthy"`.
 *
 * @param baseUrl - Worker (or PYNE) base URL; defaults to {@link defaultWorkerUrl}.
 * @param path - Route to probe; defaults to `/health`.
 * @returns The probe result; on network failure or the 15 s timeout only `error` is
 *   set. Never throws.
 */
export async function probeHealth(
  baseUrl: string = defaultWorkerUrl(),
  path = '/health',
): Promise<HealthResult> {
  const url = joinUrl(baseUrl, path);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJsonBody(res);
    return {
      ok: isHealthyPayload(res.status, body),
      url,
      status: res.status,
      body,
    };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Feature flags from Worker `/health` JSON. */
export type WorkerHealthFeatures = {
  scripts?: boolean;
  d1?: boolean;
  keys?: boolean;
  onchain?: boolean;
  market?: boolean;
  mcp?: boolean;
  mcpBridge?: boolean;
};

/**
 * Extracts the Worker's feature flags from a `/health` payload.
 *
 * Each flag is `true` only when the Worker reported the literal `true`; a missing
 * flag reads as `false`, and a body with no `features` object yields `{}`.
 *
 * @param body - Parsed `/health` JSON, typically `HealthResult.body`.
 * @returns The subset of flags the Worker advertises.
 */
export function healthFeatures(body: unknown): WorkerHealthFeatures {
  if (!body || typeof body !== 'object') return {};
  const f = (body as { features?: unknown }).features;
  if (!f || typeof f !== 'object') return {};
  const rec = f as Record<string, unknown>;
  return {
    scripts: rec.scripts === true,
    d1: rec.d1 === true,
    keys: rec.keys === true,
    onchain: rec.onchain === true,
    market: rec.market === true,
    mcp: rec.mcp === true,
    mcpBridge: rec.mcpBridge === true,
  };
}

/**
 * Probe `/api/scripts`. Without a key, 401 `NO_KEY` means the route is up.
 * 503 `API_KEYS_REQUIRED` means D1 is bound without `API_KEYS` KV.
 */
export async function probeScripts(
  baseUrl: string = defaultWorkerUrl(),
  apiKey?: string,
): Promise<HealthResult & { code?: string }> {
  const url = joinUrl(baseUrl, '/api/scripts');
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJsonBody(res);
    const code =
      body && typeof body === 'object' ? String((body as { code?: unknown }).code || '') : '';
    const ok = apiKey
      ? res.ok
      : res.status === 401 && (code === 'NO_KEY' || code === 'INVALID_KEY');
    return {
      ok,
      url,
      status: res.status,
      body,
      code: code || undefined,
      error: ok
        ? undefined
        : String(
            (body && typeof body === 'object' && (body as { message?: unknown }).message) ||
              `HTTP ${res.status}`,
          ),
    };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Mints a `pn_…` API key through the Worker's admin route.
 *
 * Sends the admin token in `X-Admin-Token` and requires all three of: a 2xx
 * response, `status: "success"`, and a string `api_key`. The returned key is
 * shown once here — the Worker stores only its hash.
 *
 * @param baseUrl - Worker base URL; callers are expected to have run
 *   {@link assertHttpsForSecret} first, since this sends the admin token.
 * @param adminToken - `ADMIN_TOKEN` secret configured on the Worker.
 * @param tier - Plan tier recorded with the key; defaults to `hobby`.
 * @returns `ok: true` with `apiKey` (and the tier the Worker echoed, else the
 *   requested one), or `ok: false` with `error` from `message`/`code`/HTTP status.
 *   Nothing here persists the key — this is the caller's only copy. Never throws.
 */
export async function mintWorkerApiKey(
  baseUrl: string,
  adminToken: string,
  tier = 'hobby',
): Promise<{ ok: boolean; apiKey?: string; tier?: string; error?: string; status?: number }> {
  const url = joinUrl(baseUrl, '/api/keys');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken,
      },
      body: JSON.stringify({ tier }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJsonBody(res);
    const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (!res.ok || rec.status !== 'success' || typeof rec.api_key !== 'string') {
      return {
        ok: false,
        status: res.status,
        error: String(rec.message || rec.code || `HTTP ${res.status}`),
      };
    }
    return {
      ok: true,
      apiKey: rec.api_key,
      tier: typeof rec.tier === 'string' ? rec.tier : tier,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Checks a key against the Worker without spending a script call.
 *
 * @param baseUrl - Worker base URL.
 * @param apiKey - `pn_…` key, sent as `Authorization: Bearer`.
 * @returns `ok: true` with the key's `tier` when the Worker answers 2xx and
 *   `status: "success"`; otherwise `ok: false` with `error`. Never throws.
 */
export async function validateWorkerApiKey(
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; tier?: string; error?: string; status?: number }> {
  const url = joinUrl(baseUrl, '/api/keys?action=validate');
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJsonBody(res);
    const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (!res.ok || rec.status !== 'success') {
      return {
        ok: false,
        status: res.status,
        error: String(rec.message || rec.code || `HTTP ${res.status}`),
      };
    }
    return {
      ok: true,
      tier: typeof rec.tier === 'string' ? rec.tier : undefined,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Checks that the Worker's GitHub device-flow OAuth route is wired up.
 *
 * This **starts** a device flow (`POST /api/git/oauth/device/start` with
 * `provider: "github"`), so it only passes when the Worker has
 * `GITHUB_OAUTH_CLIENT_ID` set; the device code is discarded and never polled.
 *
 * @param baseUrl - Worker base URL; defaults to {@link defaultWorkerUrl}.
 * @returns `ok: true` only for a 2xx response whose body has `status: "success"`;
 *   the raw payload stays in `body` for diagnostics. Never throws.
 */
export async function probeOAuthStart(baseUrl: string = defaultWorkerUrl()): Promise<HealthResult> {
  const url = joinUrl(baseUrl, '/api/git/oauth/device/start');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'github' }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJsonBody(res);
    const ok =
      res.ok &&
      typeof body === 'object' &&
      body !== null &&
      (body as { status?: string }).status === 'success';
    return { ok, url, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
