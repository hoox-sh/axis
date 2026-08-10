/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findAxisRoot, getPaths } from "../src/utils/paths.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const repoRoot = join(cliRoot, "..", "..");

describe("findAxisRoot", () => {
  test("finds axis root from packages/cli", () => {
    const root = findAxisRoot(cliRoot);
    expect(root).toBe(repoRoot);
  });

  test("getPaths includes worker and schema", () => {
    const p = getPaths(repoRoot);
    expect(p.worker.endsWith("/worker")).toBe(true);
    expect(p.d1Schema.includes("scripts.sql")).toBe(true);
  });
});
