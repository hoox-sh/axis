/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  mintWorkerApiKey,
  validateWorkerApiKey,
} from "../src/services/health.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("mintWorkerApiKey", () => {
  test("returns api_key on success", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: "success",
          api_key: `pn_${"a".repeat(48)}`,
          tier: "hobby",
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const r = await mintWorkerApiKey("https://example.workers.dev", "admin", "hobby");
    expect(r.ok).toBe(true);
    expect(r.apiKey).toMatch(/^pn_/);
    expect(r.tier).toBe("hobby");
  });

  test("surfaces 403 admin failures", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ status: "error", code: "FORBIDDEN", message: "admin token required" }),
        { status: 403 }
      )) as unknown as typeof fetch;
    const r = await mintWorkerApiKey("https://example.workers.dev", "wrong");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toContain("admin");
  });
});

describe("validateWorkerApiKey", () => {
  test("ok on success payload", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "success", tier: "pro" }), {
        status: 200,
      })) as unknown as typeof fetch;
    const r = await validateWorkerApiKey("https://example.workers.dev", "pn_x");
    expect(r.ok).toBe(true);
    expect(r.tier).toBe("pro");
  });
});
