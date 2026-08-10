/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureWranglerToml,
  getTomlVar,
  setTomlVar,
  getD1DatabaseId,
} from "../src/services/wrangler-toml.js";

describe("wrangler-toml helpers", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "axis-cli-toml-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("ensureWranglerToml copies example", () => {
    const example = join(dir, "wrangler.toml.example");
    const toml = join(dir, "wrangler.toml");
    writeFileSync(example, 'name = "pynescript-axis"\n[vars]\nFOO = "1"\n');
    const r = ensureWranglerToml(toml, example);
    expect(r.created).toBe(true);
    expect(readFileSync(toml, "utf-8")).toContain("pynescript-axis");
    const r2 = ensureWranglerToml(toml, example);
    expect(r2.created).toBe(false);
  });

  test("setTomlVar updates and inserts", () => {
    const toml = join(dir, "wrangler.toml");
    writeFileSync(
      toml,
      'name = "x"\n\n[vars]\nALLOW_OPEN_KEYS = "1"\n# GITHUB_OAUTH_CLIENT_ID = ""\n'
    );
    const r = setTomlVar(toml, "GITHUB_OAUTH_CLIENT_ID", "Ov23litest");
    expect(r.changed).toBe(true);
    expect(getTomlVar(toml, "GITHUB_OAUTH_CLIENT_ID")).toBe("Ov23litest");

    const r2 = setTomlVar(toml, "GITHUB_OAUTH_CLIENT_ID", "Ov23litest");
    expect(r2.changed).toBe(false);

    setTomlVar(toml, "ALLOW_OPEN_KEYS", "0");
    expect(getTomlVar(toml, "ALLOW_OPEN_KEYS")).toBe("0");
  });

  test("getD1DatabaseId reads binding DB block", () => {
    const toml = join(dir, "wrangler.toml");
    writeFileSync(
      toml,
      `[[d1_databases]]
binding = "DB"
database_name = "pynescript"
database_id = "ae203eba-a4c4-49ce-8b7c-edcea914d3d9"
`
    );
    expect(getD1DatabaseId(toml)).toBe(
      "ae203eba-a4c4-49ce-8b7c-edcea914d3d9"
    );
  });
});
