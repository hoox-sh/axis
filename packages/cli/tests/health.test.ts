/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  assertHttpsForSecret,
  defaultWorkerUrl,
  healthFeatures,
  isHealthyPayload,
  isLocalWorkerUrl,
  probeHealth,
} from "../src/services/health.js";

describe("healthFeatures", () => {
  test("reads Worker /health feature flags", () => {
    expect(
      healthFeatures({
        status: "healthy",
        features: { scripts: true, d1: true, keys: false, onchain: true },
      })
    ).toEqual({
      scripts: true,
      d1: true,
      keys: false,
      onchain: true,
      market: false,
      mcp: false,
      mcpBridge: false,
    });
    expect(healthFeatures(null)).toEqual({});
  });
});

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
      "https://worker.axis.hoox.sh"
    );
  });
});

describe("isLocalWorkerUrl", () => {
  test("loopback http URLs are local", () => {
    expect(isLocalWorkerUrl("http://localhost:8787")).toBe(true);
    expect(isLocalWorkerUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLocalWorkerUrl("http://[::1]:8787")).toBe(true);
    expect(isLocalWorkerUrl("http://app.localhost:8787")).toBe(true);
  });

  test("remote hosts are not local", () => {
    expect(isLocalWorkerUrl("https://worker.axis.hoox.sh")).toBe(false);
    expect(isLocalWorkerUrl("http://worker.axis.hoox.sh")).toBe(false);
    expect(isLocalWorkerUrl("http://localhost.evil.com")).toBe(false);
    expect(isLocalWorkerUrl("not a url")).toBe(false);
  });
});

describe("assertHttpsForSecret", () => {
  test("allows https anywhere and http on loopback", () => {
    expect(() =>
      assertHttpsForSecret("https://worker.axis.hoox.sh", "keys")
    ).not.toThrow();
    expect(() =>
      assertHttpsForSecret("http://127.0.0.1:8787", "keys")
    ).not.toThrow();
    expect(() =>
      assertHttpsForSecret("http://localhost:8787", "keys")
    ).not.toThrow();
  });

  test("refuses http to a non-local host (G7)", () => {
    expect(() =>
      assertHttpsForSecret("http://worker.axis.hoox.sh", "axis keys create")
    ).toThrow(/cleartext/);
  });

  test("rejects malformed URLs", () => {
    expect(() => assertHttpsForSecret("::bad::", "keys")).toThrow(/Invalid/);
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
