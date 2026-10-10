/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Windows-safe spawn planning: PATH+PATHEXT resolution and cmd.exe quoting
 * with injected platform/env (tests run on any OS — G4/G18).
 */
import { describe, expect, test } from "bun:test";
import {
  planSpawn,
  quoteCmdArg,
  resolveOnPath,
  type ResolveDeps,
} from "../src/utils/run.js";

/** Fake FS: only these paths "exist and are executable". */
function fakeFs(executables: string[]): ResolveDeps["isExecutable"] {
  const set = new Set(executables);
  return (path: string) => set.has(path);
}

const WIN_ENV = {
  PATH: "C:\\tools;C:\\Windows\\System32",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
};

describe("resolveOnPath", () => {
  test("posix resolves a bare name against PATH", () => {
    const deps: ResolveDeps = {
      platform: "linux",
      env: { PATH: "/usr/bin:/bin" },
      isExecutable: fakeFs(["/usr/bin/bun"]),
    };
    expect(resolveOnPath("bun", deps)).toBe("/usr/bin/bun");
    expect(resolveOnPath("missing", deps)).toBeNull();
  });

  test("win32 tries PATHEXT extensions, never the bare name", () => {
    const deps: ResolveDeps = {
      platform: "win32",
      env: WIN_ENV,
      // npm writes both a POSIX `sh` shim (extensionless) and wrangler.cmd;
      // only the .cmd must resolve — cmd.exe cannot run the sh shim.
      isExecutable: fakeFs(["C:\\tools\\wrangler", "C:\\tools\\wrangler.CMD"]),
    };
    expect(resolveOnPath("wrangler", deps)).toBe("C:\\tools\\wrangler.CMD");
  });

  test("win32 returns null when only the extensionless shim exists", () => {
    const deps: ResolveDeps = {
      platform: "win32",
      env: WIN_ENV,
      isExecutable: fakeFs(["C:\\tools\\wrangler"]),
    };
    expect(resolveOnPath("wrangler", deps)).toBeNull();
  });

  test("path-like names are checked as-is (plus PATHEXT on win32)", () => {
    const deps: ResolveDeps = {
      platform: "win32",
      env: WIN_ENV,
      isExecutable: fakeFs(["C:\\proj\\node_modules\\.bin\\wrangler.CMD"]),
    };
    expect(
      resolveOnPath("C:\\proj\\node_modules\\.bin\\wrangler", deps)
    ).toBe("C:\\proj\\node_modules\\.bin\\wrangler.CMD");
  });
});

describe("quoteCmdArg", () => {
  test("quotes whitespace and shell metacharacters", () => {
    expect(quoteCmdArg("pages deploy")).toBe('"pages deploy"');
    expect(quoteCmdArg("a&b")).toBe('"a&b"');
    expect(quoteCmdArg("plain")).toBe("plain");
    expect(quoteCmdArg("")).toBe('""');
  });

  test("refuses cmd-unsafe characters instead of escaping them", () => {
    expect(() => quoteCmdArg("100% coverage")).toThrow(/cmd-unsafe/);
    expect(() => quoteCmdArg('say "hi"')).toThrow(/cmd-unsafe/);
    expect(() => quoteCmdArg("a\r\nb")).toThrow(/cmd-unsafe/);
  });
});

describe("planSpawn", () => {
  test("posix passes through unchanged", () => {
    expect(planSpawn("bun", ["install"], { platform: "linux" })).toEqual({
      file: "bun",
      args: ["install"],
    });
  });

  test("win32 routes .cmd through cmd.exe /d /s /c", () => {
    const deps: ResolveDeps = {
      platform: "win32",
      env: WIN_ENV,
      isExecutable: fakeFs(["C:\\tools\\wrangler.CMD"]),
    };
    const plan = planSpawn("wrangler", ["deploy", "--out", "a b"], deps);
    expect(plan.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(plan.args[3]).toContain("wrangler.CMD");
    expect(plan.args[3]).toContain('"a b"');
    expect(plan.windowsVerbatimArguments).toBe(true);
  });

  test("win32 spawns real .exe directly", () => {
    const deps: ResolveDeps = {
      platform: "win32",
      env: WIN_ENV,
      isExecutable: fakeFs(["C:\\tools\\bun.EXE"]),
    };
    expect(planSpawn("bun", ["--version"], deps)).toEqual({
      file: "C:\\tools\\bun.EXE",
      args: ["--version"],
    });
  });

  test("win32 without a resolvable binary keeps the name (ENOENT surfaces)", () => {
    const deps: ResolveDeps = {
      platform: "win32",
      env: WIN_ENV,
      isExecutable: fakeFs([]),
    };
    expect(planSpawn("wrangler", ["deploy"], deps)).toEqual({
      file: "wrangler",
      args: ["deploy"],
    });
  });
});
