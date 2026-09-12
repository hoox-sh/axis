/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type HealthResult = {
  ok: boolean;
  url: string;
  status?: number;
  body?: unknown;
  error?: string;
};

const FALLBACK_WORKER_URL =
  "https://pynescript-axis.cryptolinx.workers.dev";

export function defaultWorkerUrl(): string {
  const fromEnv = process.env.AXIS_WORKER_URL?.trim();
  return (fromEnv || FALLBACK_WORKER_URL).replace(/\/$/, "");
}

/** True when an HTTP payload is a live AXIS/PYNE health document. */
export function isHealthyPayload(httpStatus: number, body: unknown): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (typeof body !== "object" || body === null) return false;
  const status = (body as { status?: unknown }).status;
  return status === "healthy" || status === "ok";
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
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

export async function probeHealth(
  baseUrl: string = defaultWorkerUrl(),
  path = "/health"
): Promise<HealthResult> {
  const url = joinUrl(baseUrl, path);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
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
};

export function healthFeatures(body: unknown): WorkerHealthFeatures {
  if (!body || typeof body !== "object") return {};
  const f = (body as { features?: unknown }).features;
  if (!f || typeof f !== "object") return {};
  const rec = f as Record<string, unknown>;
  return {
    scripts: rec.scripts === true,
    d1: rec.d1 === true,
    keys: rec.keys === true,
    onchain: rec.onchain === true,
    market: rec.market === true,
  };
}

/**
 * Probe `/api/scripts`. Without a key, 401 `NO_KEY` means the route is up.
 * 503 `API_KEYS_REQUIRED` means D1 is bound without `API_KEYS` KV.
 */
export async function probeScripts(
  baseUrl: string = defaultWorkerUrl(),
  apiKey?: string
): Promise<HealthResult & { code?: string }> {
  const url = joinUrl(baseUrl, "/api/scripts");
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJsonBody(res);
    const code =
      body && typeof body === "object"
        ? String((body as { code?: unknown }).code || "")
        : "";
    const ok = apiKey
      ? res.ok
      : res.status === 401 && (code === "NO_KEY" || code === "INVALID_KEY");
    return {
      ok,
      url,
      status: res.status,
      body,
      code: code || undefined,
      error: ok
        ? undefined
        : String(
            (body && typeof body === "object" && (body as { message?: unknown }).message) ||
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

export async function mintWorkerApiKey(
  baseUrl: string,
  adminToken: string,
  tier = "hobby"
): Promise<{ ok: boolean; apiKey?: string; tier?: string; error?: string; status?: number }> {
  const url = joinUrl(baseUrl, "/api/keys");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken,
      },
      body: JSON.stringify({ tier }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJsonBody(res);
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (!res.ok || rec.status !== "success" || typeof rec.api_key !== "string") {
      return {
        ok: false,
        status: res.status,
        error: String(rec.message || rec.code || `HTTP ${res.status}`),
      };
    }
    return {
      ok: true,
      apiKey: rec.api_key,
      tier: typeof rec.tier === "string" ? rec.tier : tier,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function validateWorkerApiKey(
  baseUrl: string,
  apiKey: string
): Promise<{ ok: boolean; tier?: string; error?: string; status?: number }> {
  const url = joinUrl(baseUrl, "/api/keys?action=validate");
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJsonBody(res);
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (!res.ok || rec.status !== "success") {
      return {
        ok: false,
        status: res.status,
        error: String(rec.message || rec.code || `HTTP ${res.status}`),
      };
    }
    return {
      ok: true,
      tier: typeof rec.tier === "string" ? rec.tier : undefined,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeOAuthStart(
  baseUrl: string = defaultWorkerUrl()
): Promise<HealthResult> {
  const url = joinUrl(baseUrl, "/api/git/oauth/device/start");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: "github" }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJsonBody(res);
    const ok =
      res.ok &&
      typeof body === "object" &&
      body !== null &&
      (body as { status?: string }).status === "success";
    return { ok, url, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
