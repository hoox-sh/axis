/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * scripts/sync-versions.mjs — the `--check` mode is read-only, so it doubles
 * as the runner's unit test: versions must be in sync with VERSION (G18).
 */
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("scripts/sync-versions.mjs", () => {
  test("--check passes: every stamped file matches VERSION", async () => {
    const proc = Bun.spawnSync(["bun", "scripts/sync-versions.mjs", "--check"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = `${proc.stdout}\n${proc.stderr}`;
    expect({ code: proc.exitCode, out }).toEqual({
      code: 0,
      out: expect.stringContaining("versions in sync"),
    });
  }, 30_000);
});
