/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/utils/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "axis.js");

async function axis(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return run("bun", [bin, ...args], {
    throwOnError: false,
    cwd: join(here, ".."),
    env: { ...process.env, AXIS_CLI_SRC: "1" },
  });
}

describe("axis bin", () => {
  test("--version prints package version", async () => {
    const r = await axis(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--help lists core commands", async () => {
    const r = await axis(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("install");
    expect(r.stdout).toContain("doctor");
    expect(r.stdout).toContain("deploy");
    expect(r.stdout).toContain("health");
  });

  test("unknown command exits non-zero without throwing a wrapper dump", async () => {
    const r = await axis(["not-a-real-command"]);
    expect(r.code).not.toBe(0);
    const out = r.stdout + r.stderr;
    expect(out.toLowerCase()).toContain("unknown");
  });

  test("doctor --json is valid JSON and has no human banner", async () => {
    const r = await axis(["doctor", "--json"]);
    expect(r.stdout.trim().startsWith("{")).toBe(true);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      checks: unknown[];
    };
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(r.stdout).not.toContain("AXIS doctor");
  });

  test("node can run the published bin via dist/", async () => {
    const dist = join(here, "..", "dist", "index.js");
    if (!existsSync(dist)) return;
    const r = await run("node", [bin, "--version"], {
      throwOnError: false,
      cwd: join(here, ".."),
      env: { ...process.env, AXIS_CLI_SRC: "0" },
    });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
