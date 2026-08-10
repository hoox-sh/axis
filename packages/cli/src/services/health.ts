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

const DEFAULT_WORKER_URL =
  process.env.AXIS_WORKER_URL?.trim() ||
  "https://pynescript-axis.cryptolinx.workers.dev";

export function defaultWorkerUrl(): string {
  return DEFAULT_WORKER_URL.replace(/\/$/, "");
}

export async function probeHealth(
  baseUrl: string = defaultWorkerUrl(),
  path = "/health"
): Promise<HealthResult> {
  const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const ok =
      res.ok &&
      typeof body === "object" &&
      body !== null &&
      (body as { status?: string }).status === "healthy";
    return { ok: ok || res.ok, url, status: res.status, body };
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
  const url = `${baseUrl.replace(/\/$/, "")}/api/git/oauth/device/start`;
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
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep */
    }
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
