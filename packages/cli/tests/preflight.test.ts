/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * CLI installation self-check: install-context detection, engine compliance,
 * version drift vs the repo checkout, and the `cli-install` doctor row.
 */
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkEngines,
  collectPreflight,
  compareSemver,
  detectInstallContext,
} from "../src/utils/preflight.js";
import { collectDoctorChecks } from "../src/commands/doctor.js";

const axisRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
process.env.AXIS_ROOT = axisRoot;

describe("compareSemver", () => {
  test("orders major.minor.patch", () => {
    expect(compareSemver("0.3.0", "0.2.2")).toBeGreaterThan(0);
    expect(compareSemver("0.2.2", "0.2.2")).toBe(0);
    expect(compareSemver("0.2.2", "0.3.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  test("tolerates partial versions", () => {
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
    expect(compareSemver("1", "2.0.0")).toBeLessThan(0);
  });
});

describe("detectInstallContext", () => {
  test("classifies npm, npx, and repo layouts", () => {
    expect(
      detectInstallContext("file:///usr/lib/node_modules/@hoox-sh/axis-cli/dist/index.js")
    ).toBe("npm-install");
    expect(
      detectInstallContext("file:///home/u/.npm/_npx/abc/node_modules/@hoox-sh/axis-cli/dist/index.js")
    ).toBe("npx-cache");
    expect(
      detectInstallContext("file:///home/u/Git/axis/packages/cli/src/index.ts")
    ).toBe("repo-checkout");
    expect(detectInstallContext("file:///somewhere/else/index.js")).toBe("unknown");
  });

  test("classifies bun-compile standalone binaries ($bunfs)", () => {
    expect(detectInstallContext("file:///$bunfs/root/index.js")).toBe("binary");
    expect(detectInstallContext("file:///B:/$bunfs/root/index.js")).toBe("binary");
  });
});

describe("checkEngines", () => {
  test("bun runtime satisfies engines.bun", () => {
    const r = checkEngines({ bun: "1.4.0" }, { node: ">=20", bun: ">=1.2" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("bun 1.4.0");
  });

  test("old bun is flagged", () => {
    const r = checkEngines({ bun: "1.1.9" }, { node: ">=20", bun: ">=1.2" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("1.1.9");
  });

  test("node runtime satisfies engines.node", () => {
    const r = checkEngines({ node: "22.3.0" }, { node: ">=20", bun: ">=1.2" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("node 22.3.0");
  });

  test("old node is flagged", () => {
    const r = checkEngines({ node: "18.0.0" }, { node: ">=20", bun: ">=1.2" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("18.0.0");
  });
});

describe("collectPreflight", () => {
  test("repo checkout with matching version is ok with no warnings", async () => {
    const pf = await collectPreflight();
    expect(pf.context).toBe("repo-checkout");
    expect(pf.ok).toBe(true);
    expect(pf.warnings).toEqual([]);
    expect(pf.driftFrom).toBeNull();
    expect(pf.summary).toContain("repo checkout");
  });

  test("flags version drift for an npm install older than the repo", async () => {
    const pf = await collectPreflight({
      moduleUrl: "file:///usr/lib/node_modules/@hoox-sh/axis-cli/dist/index.js",
      cliVersion: "0.0.1",
    });
    expect(pf.context).toBe("npm-install");
    expect(pf.ok).toBe(false);
    expect(pf.driftFrom).toBeTruthy();
    expect(pf.warnings.join("\n")).toContain("npm i -g @hoox-sh/axis-cli");
  });

  test("repo checkout never reports drift against itself", async () => {
    const pf = await collectPreflight({ cliVersion: "0.0.1" });
    expect(pf.context).toBe("repo-checkout");
    expect(pf.driftFrom).toBeNull();
  });
});

describe("doctor cli-install row", () => {
  test("present, optional, and populated", async () => {
    const checks = await collectDoctorChecks({});
    const row = checks.find((c) => c.id === "cli-install");
    expect(row).toBeTruthy();
    expect(row?.required).toBe(false);
    expect(row?.detail).toBeTruthy();
    expect(row?.detail?.length ?? 0).toBeGreaterThan(0);
  });
});
