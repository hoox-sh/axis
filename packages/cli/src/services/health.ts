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
