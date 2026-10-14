/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `POST /compile/prewarm` against a PYNE Pro API host.
 *
 * Deliberately separate from `services/health.ts` (which probes the AXIS
 * Worker): prewarm is a backend operation on the calculation host, so it takes
 * the PYNE base URL and never touches Worker routes.
 */

export type PrewarmResponse = {
  ok: boolean;
  url: string;
  status?: number;
  /** Backend wall time for the warm pass (ms). */
  prewarmMs: number | null;
  hasNumba: boolean;
  builtinsWarmed: boolean;
  scriptsOk: number;
  scriptsFailed: number;
  errors: string[];
  error?: string;
};

/** Local pyne Pro API default, matching the server engine's schema default. */
export const FALLBACK_PYNE_URL = "http://127.0.0.1:5002";

export function defaultPyneUrl(): string {
  const fromEnv = process.env.AXIS_PYNE_URL?.trim();
  return (fromEnv || FALLBACK_PYNE_URL).replace(/\/$/, "");
}

export type PrewarmRequest = {
  /** Pine sources to compile into the IR cache (backend caps at 16). */
  scripts?: readonly string[];
  /** Re-warm builtins even when the host reports them warm. */
  force?: boolean;
  key?: string;
  timeoutMs?: number;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function prewarmBackend(
  base: string,
  req: PrewarmRequest = {}
): Promise<PrewarmResponse> {
  const url = `${String(base || "").replace(/\/$/, "")}/compile/prewarm`;
  const out: PrewarmResponse = {
    ok: false,
    url,
    prewarmMs: null,
    hasNumba: false,
    builtinsWarmed: false,
    scriptsOk: 0,
    scriptsFailed: 0,
    errors: [],
  };
  if (!String(base || "").trim()) {
    return { ...out, error: "No backend URL (pass --endpoint or set AXIS_PYNE_URL)" };
  }

  const body: Record<string, unknown> = {};
  const scripts = (req.scripts ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, 16);
  if (scripts.length) body.scripts = scripts;
  if (req.force) body.force = true;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = String(req.key || process.env.AXIS_PYNE_API_KEY || "").trim();
  if (key) {
    headers["X-API-Key"] = key;
    headers.Authorization = `Bearer ${key}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    out.status = res.status;
    if (res.status === 404 || res.status === 405) {
      return { ...out, error: `Backend has no /compile/prewarm route (HTTP ${res.status})` };
    }
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      const j: unknown = text.trim() ? JSON.parse(text) : null;
      if (j && typeof j === "object" && !Array.isArray(j)) parsed = j as Record<string, unknown>;
    } catch {
      return { ...out, error: `Non-JSON response from ${url}` };
    }
    if (!res.ok) {
      const message = typeof parsed?.message === "string" ? parsed.message : "";
      return { ...out, error: message || `Prewarm failed (HTTP ${res.status})` };
    }
    if (!parsed || parsed.status === "error") {
      const message = typeof parsed?.message === "string" ? parsed.message : "";
      return { ...out, error: message || "Backend rejected the prewarm request" };
    }
    return {
      ...out,
      ok: true,
      hasNumba: parsed.has_numba === true,
      builtinsWarmed: parsed.builtins_warmed === true,
      prewarmMs: num(parsed.prewarm_ms),
      scriptsOk: num(parsed.scripts_ok) ?? 0,
      scriptsFailed: num(parsed.scripts_failed) ?? 0,
      errors: Array.isArray(parsed.errors)
        ? parsed.errors.filter((e): e is string => typeof e === "string")
        : [],
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return {
      ...out,
      error: /abort/i.test(raw) ? "Prewarm timed out" : raw,
    };
  } finally {
    clearTimeout(timer);
  }
}
