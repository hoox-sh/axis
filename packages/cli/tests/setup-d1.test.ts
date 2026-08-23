/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test } from "bun:test";
import { d1ApplyPlan } from "../src/commands/setup.js";
import { parseDeployedWorkerUrl } from "../src/commands/deploy.js";
import { commanderExitCode, getGlobalOpts } from "../src/utils/format.js";
import { which } from "../src/utils/run.js";

describe("d1ApplyPlan", () => {
  test("default is local only", () => {
    expect(d1ApplyPlan({})).toEqual({ applyLocal: true, applyRemote: false });
  });

  test("--remote alone is remote only", () => {
    expect(d1ApplyPlan({ remote: true })).toEqual({
      applyLocal: false,
      applyRemote: true,
    });
  });

  test("--local --remote (and setup --remote-d1) applies both", () => {
    expect(d1ApplyPlan({ local: true, remote: true })).toEqual({
      applyLocal: true,
      applyRemote: true,
    });
  });

  test("--local alone is local only", () => {
    expect(d1ApplyPlan({ local: true })).toEqual({
      applyLocal: true,
      applyRemote: false,
    });
  });
});

describe("parseDeployedWorkerUrl", () => {
  test("returns the last workers.dev URL", () => {
    const out = `
Uploaded pynescript-axis
  https://pynescript-axis.cryptolinx.workers.dev
Current Version ID: abc
`;
    expect(parseDeployedWorkerUrl(out)).toBe(
      "https://pynescript-axis.cryptolinx.workers.dev"
    );
  });

  test("returns undefined when no URL", () => {
    expect(parseDeployedWorkerUrl("no url here")).toBeUndefined();
  });
});

describe("commanderExitCode", () => {
  test("maps help/version to 0", () => {
    expect(commanderExitCode({ code: "commander.helpDisplayed" })).toBe(0);
    expect(commanderExitCode({ code: "commander.version" })).toBe(0);
  });

  test("maps other commander errors to their exitCode", () => {
    expect(
      commanderExitCode({ code: "commander.unknownCommand", exitCode: 1 })
    ).toBe(1);
    expect(commanderExitCode({ code: "commander.missingArgument" })).toBe(2);
  });

  test("ignores non-commander errors", () => {
    expect(commanderExitCode(new Error("nope"))).toBeNull();
  });
});

describe("getGlobalOpts", () => {
  test("--json implies quiet", () => {
    const o = getGlobalOpts({
      optsWithGlobals: () => ({ json: true, quiet: false, yes: false }),
    });
    expect(o.json).toBe(true);
    expect(o.quiet).toBe(true);
  });
});

describe("which", () => {
  test("rejects path-like names", async () => {
    expect(await which("/bin/sh")).toBeNull();
    expect(await which("")).toBeNull();
  });

  test("finds sh", async () => {
    const p = await which("sh");
    expect(p).toBeTruthy();
  });
});
