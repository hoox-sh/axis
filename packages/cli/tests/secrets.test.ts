/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test } from "bun:test";
import { isBindingNameInUse } from "../src/commands/secrets.js";

describe("isBindingNameInUse", () => {
  test("matches Cloudflare 10053 var/secret collision", () => {
    const wrangler = `
✘ [ERROR] A request to the Cloudflare API failed.

  Binding name 'ADMIN_TOKEN' already in use. Please use a different name and try again. [code:
  10053]
`;
    expect(isBindingNameInUse(wrangler)).toBe(true);
  });

  test("ignores unrelated wrangler errors", () => {
    expect(isBindingNameInUse("Authentication error [code: 9106]")).toBe(false);
    expect(isBindingNameInUse("already in use")).toBe(false);
  });
});
