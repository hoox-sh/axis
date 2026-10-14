/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, describe, expect, test } from "bun:test";
import { fetchPyneUsage, mintPyneKey, validatePyneKey } from "../src/services/pyne-auth.js";

const realFetch = globalThis.fetch;
let restore: (() => void) | null = null;

function install(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  restore = () => {
    globalThis.fetch = realFetch;
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  restore?.();
  restore = null;
});

describe("mintPyneKey", () => {
  test("POSTs the tier with the admin token header", async () => {
    let seen: { url: string; method?: string; headers: Record<string, string>; body: unknown } = {
      url: "",
      headers: {},
      body: null,
    };
    install((url, init) => {
      seen = {
        url,
        method: init?.method,
        headers: (init?.headers as Record<string, string>) || {},
        body: JSON.parse(String(init?.body || "{}")),
      };
      return json({ status: "success", api_key: "pn_pyne_key", key_id: "k9", tier: "pro" });
    });

    const r = await mintPyneKey("http://127.0.0.1:5002/", "adm_token", "pro");
    expect(seen.url).toBe("http://127.0.0.1:5002/auth/create_key");
    expect(seen.method).toBe("POST");
    expect(seen.headers["X-Admin-Token"]).toBe("adm_token");
    expect(seen.body).toEqual({ tier: "pro" });
    expect(r.ok).toBe(true);
    expect(r.apiKey).toBe("pn_pyne_key");
    expect(r.keyId).toBe("k9");
  });

  test("refuses without an admin token and never calls the network", async () => {
    install(() => {
      throw new Error("fetch must not be called");
    });
    const r = await mintPyneKey("http://127.0.0.1:5002", "  ");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Admin token required");
  });

  test("maps 403 to a host-side ADMIN_TOKEN hint", async () => {
    install(() => json({ status: "error", code: "FORBIDDEN" }, 403));
    const r = await mintPyneKey("http://127.0.0.1:5002", "wrong");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toContain("ADMIN_TOKEN");
  });

  test("surfaces a backend message and handles a missing key", async () => {
    install(() => json({ status: "error", message: "INVALID_TIER" }, 400));
    expect((await mintPyneKey("http://127.0.0.1:5002", "t", "bogus")).error).toBe("INVALID_TIER");
    restore?.();
    install(() => json({ status: "success" }));
    expect((await mintPyneKey("http://127.0.0.1:5002", "t")).error).toContain("no api_key");
  });
});

describe("fetchPyneUsage", () => {
  test("reads tier and budget with the key headers", async () => {
    let headers: Record<string, string> = {};
    install((_url, init) => {
      headers = (init?.headers as Record<string, string>) || {};
      return json({
        status: "success",
        key_id: "k1",
        tier: "pro",
        usage: { calls_used: 5, calls_limit: 1000, calls_remaining: 995, last_used: 1 },
      });
    });
    const r = await fetchPyneUsage("http://127.0.0.1:5002", "pn_key");
    expect(headers["X-API-Key"]).toBe("pn_key");
    expect(headers.Authorization).toBe("Bearer pn_key");
    expect(r.ok).toBe(true);
    expect(r.tier).toBe("pro");
    expect(r.callsRemaining).toBe(995);
  });

  test("distinguishes 401 from 404", async () => {
    install(() => json({ status: "error" }, 401));
    expect((await fetchPyneUsage("http://127.0.0.1:5002", "k")).error).toContain("not recognised");
    restore?.();
    install(() => json({ status: "error" }, 404));
    expect((await fetchPyneUsage("http://127.0.0.1:5002", "k")).error).toContain("no /auth/usage");
  });

  test("requires a key and never throws on transport failure", async () => {
    install(() => {
      throw new Error("offline");
    });
    expect((await fetchPyneUsage("http://127.0.0.1:5002", "")).error).toBe("API key required");
    expect((await fetchPyneUsage("http://127.0.0.1:5002", "k")).error).toBe("offline");
  });
});

describe("validatePyneKey", () => {
  test("POSTs the key and reports tier/active/rate-limited", async () => {
    let body: unknown = null;
    install((url, init) => {
      body = JSON.parse(String(init?.body || "{}"));
      expect(url).toBe("http://127.0.0.1:5002/auth/validate");
      return json({
        status: "success",
        key_id: "k1",
        tier: "pro",
        active: true,
        rate_limited: false,
      });
    });
    const r = await validatePyneKey("http://127.0.0.1:5002", "pn_key");
    expect(body).toEqual({ api_key: "pn_key" });
    expect(r.ok).toBe(true);
    expect(r.tier).toBe("pro");
    expect(r.active).toBe(true);
    expect(r.rateLimited).toBe(false);
  });

  test("maps 401 to an invalid-key message and 404 to a missing route", async () => {
    install(() => json({ status: "error", code: "INVALID_KEY" }, 401));
    expect((await validatePyneKey("http://127.0.0.1:5002", "k")).error).toBe("Invalid API key");
    restore?.();
    install(() => json({ status: "error" }, 404));
    expect((await validatePyneKey("http://127.0.0.1:5002", "k")).error).toContain("no /auth/validate");
  });

  test("requires a key and never throws on transport failure", async () => {
    install(() => {
      throw new Error("offline");
    });
    expect((await validatePyneKey("http://127.0.0.1:5002", "")).error).toBe("API key required");
    expect((await validatePyneKey("http://127.0.0.1:5002", "k")).error).toBe("offline");
  });
});
