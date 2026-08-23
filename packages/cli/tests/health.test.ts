/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  defaultWorkerUrl,
  isHealthyPayload,
  probeHealth,
} from "../src/services/health.js";

describe("isHealthyPayload", () => {
  test("requires 2xx plus status healthy or ok", () => {
    expect(isHealthyPayload(200, { status: "healthy" })).toBe(true);
    expect(isHealthyPayload(200, { status: "ok" })).toBe(true);
    expect(isHealthyPayload(200, { status: "degraded" })).toBe(false);
    expect(isHealthyPayload(200, "ok")).toBe(false);
    expect(isHealthyPayload(500, { status: "healthy" })).toBe(false);
    expect(isHealthyPayload(200, null)).toBe(false);
  });
});

describe("defaultWorkerUrl", () => {
  const prev = process.env.AXIS_WORKER_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.AXIS_WORKER_URL;
    else process.env.AXIS_WORKER_URL = prev;
  });

  test("reads AXIS_WORKER_URL at call time and strips trailing slash", () => {
    process.env.AXIS_WORKER_URL = "https://example.workers.dev/";
    expect(defaultWorkerUrl()).toBe("https://example.workers.dev");
  });

  test("falls back to production worker", () => {
    delete process.env.AXIS_WORKER_URL;
    expect(defaultWorkerUrl()).toBe(
      "https://pynescript-axis.cryptolinx.workers.dev"
    );
  });
});

describe("probeHealth", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("ok is false when HTTP 200 but body is not a health document", async () => {
    globalThis.fetch = (async () =>
      new Response("welcome", { status: 200 })) as unknown as typeof fetch;
    const r = await probeHealth("https://example.test");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(200);
  });

  test("ok is true for AXIS worker payload", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "healthy", service: "axis" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const r = await probeHealth("https://example.test");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://example.test/health");
  });
});
