/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDoctorChecks } from "../src/commands/doctor.js";

const axisRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
process.env.AXIS_ROOT = axisRoot;

describe("axis doctor checks", () => {
  test("wrangler.toml is a warning, not a required fail", async () => {
    const checks = await collectDoctorChecks({});
    const toml = checks.find((c) => c.id === "wrangler-toml");
    expect(toml).toBeTruthy();
    expect(toml!.required).toBe(false);
    if (!toml!.ok) {
      expect(toml!.detail).toContain("axis setup");
      expect(toml!.detail).toContain("wrangler.toml.example");
    }
  });
});
