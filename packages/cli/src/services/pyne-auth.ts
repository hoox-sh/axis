/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PYNE Pro auth routes: `POST /auth/create_key` (admin token) and
 * `GET /auth/usage` (API key).
 *
 * Separate from the AXIS Worker key routes in `services/keys.ts` — these are
 * the calculation host's own key store, which is what `axis prewarm` and the
 * server engine authenticate against.
 */

export type PyneMintResult = {
  ok: boolean;
  apiKey?: string;
  keyId?: string;
  tier?: string;
  status?: number;
  error?: string;
};

export type PyneUsageResult = {
  ok: boolean;
  keyId: string | null;
  tier: string | null;
  callsUsed: number | null;
  callsLimit: number | null;
  callsRemaining: number | null;
  lastUsed: number | null;
  status?: number;
  error?: string;
};

export type PyneValidateResult = {
  ok: boolean;
  keyId?: string;
  tier?: string;
  active?: boolean;
  rateLimited?: boolean;
  status?: number;
  error?: string;
};

const TIMEOUT_MS = 20_000;

async function pyneFetch(
  base: string,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown },
): Promise<{ status: number; payload: Record<string, unknown> | null } | { error: string }> {
  const url = `${String(base || "").replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let payload: Record<string, unknown> | null = null;
    try {
      const text = await res.text();
      const parsed: unknown = text.trim() ? JSON.parse(text) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
    return { status: res.status, payload };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `POST /auth/create_key` — requires the host's ADMIN_TOKEN header. */
export async function mintPyneKey(
  base: string,
  adminToken: string,
  tier = "hobby"
): Promise<PyneMintResult> {
  if (!adminToken.trim()) {
    return { ok: false, error: "Admin token required to mint PYNE keys" };
  }
  const res = await pyneFetch(base, "/auth/create_key", {
    method: "POST",
    headers: { "X-Admin-Token": adminToken },
    body: { tier },
  });
  if ("error" in res) return { ok: false, error: res.error };
  if (res.status === 403) {
    return {
      ok: false,
      status: res.status,
      error: "Admin token rejected (ADMIN_TOKEN unset on the host is also a 403)",
    };
  }
  if (res.status < 200 || res.status >= 300 || res.payload?.status === "error") {
    const message =
      typeof res.payload?.message === "string" && res.payload.message
        ? res.payload.message
        : `Mint failed (HTTP ${res.status})`;
    return { ok: false, status: res.status, error: message };
  }
  const apiKey = typeof res.payload?.api_key === "string" ? res.payload.api_key : "";
  if (!apiKey) return { ok: false, status: res.status, error: "Backend returned no api_key" };
  return {
    ok: true,
    apiKey,
    keyId: typeof res.payload?.key_id === "string" ? res.payload.key_id : undefined,
    tier: typeof res.payload?.tier === "string" ? res.payload.tier : tier,
    status: res.status,
  };
}

/** `GET /auth/usage` for the supplied key. */
export async function fetchPyneUsage(base: string, apiKey: string): Promise<PyneUsageResult> {
  const empty: PyneUsageResult = {
    ok: false,
    keyId: null,
    tier: null,
    callsUsed: null,
    callsLimit: null,
    callsRemaining: null,
    lastUsed: null,
  };
  if (!apiKey.trim()) return { ...empty, error: "API key required" };
  const res = await pyneFetch(base, "/auth/usage", {
    method: "GET",
    headers: { "X-API-Key": apiKey, Authorization: `Bearer ${apiKey}` },
  });
  if ("error" in res) return { ...empty, error: res.error };
  if (res.status === 401 || res.status === 403) {
    return { ...empty, status: res.status, error: "API key not recognised by this backend" };
  }
  if (res.status === 404) {
    return { ...empty, status: res.status, error: "Backend has no /auth/usage route" };
  }
  if (res.status < 200 || res.status >= 300 || !res.payload || res.payload.status === "error") {
    const message =
      typeof res.payload?.message === "string" && res.payload.message
        ? res.payload.message
        : `Usage failed (HTTP ${res.status})`;
    return { ...empty, status: res.status, error: message };
  }
  const usage = (res.payload.usage || {}) as Record<string, unknown>;
  return {
    ok: true,
    keyId: typeof res.payload.key_id === "string" ? res.payload.key_id : null,
    tier: typeof res.payload.tier === "string" ? res.payload.tier : null,
    callsUsed: asNum(usage.calls_used),
    callsLimit: asNum(usage.calls_limit),
    callsRemaining: asNum(usage.calls_remaining),
    lastUsed: asNum(usage.last_used),
    status: res.status,
  };
}

/**
 * `POST /auth/validate` — check a key without consuming a call.
 *
 * Distinct from the AXIS Worker's `GET /api/keys` validation: this is the
 * calculation host's own key store, the one the server engine authenticates
 * against.
 */
export async function validatePyneKey(
  base: string,
  apiKey: string
): Promise<PyneValidateResult> {
  if (!apiKey.trim()) return { ok: false, error: "API key required" };
  const res = await pyneFetch(base, "/auth/validate", {
    method: "POST",
    body: { api_key: apiKey },
  });
  if ("error" in res) return { ok: false, error: res.error };
  if (res.status === 401) {
    return { ok: false, status: res.status, error: "Invalid API key" };
  }
  if (res.status === 404) {
    return { ok: false, status: res.status, error: "Backend has no /auth/validate route" };
  }
  if (res.status < 200 || res.status >= 300 || !res.payload || res.payload.status === "error") {
    const message =
      typeof res.payload?.message === "string" && res.payload.message
        ? res.payload.message
        : `Validate failed (HTTP ${res.status})`;
    return { ok: false, status: res.status, error: message };
  }
  return {
    ok: true,
    keyId: typeof res.payload.key_id === "string" ? res.payload.key_id : undefined,
    tier: typeof res.payload.tier === "string" ? res.payload.tier : undefined,
    active: res.payload.active === true,
    rateLimited: res.payload.rate_limited === true,
    status: res.status,
  };
}
