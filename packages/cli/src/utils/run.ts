/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Thin process runner (child_process).
 *
 * Windows: the npm CLI runs under Node, where `Bun.which` and `sh` are not
 * available. Binaries are resolved against PATH + PATHEXT in JS, and `.cmd` /
 * `.bat` shims (npm/bun installs) are launched through `cmd.exe /d /s /c`,
 * because Node refuses to spawn batch files without a shell (CVE-2024-27980).
 */

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { spawn } from "node:child_process";

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Inherit stdio (live output). Default false → capture. */
  inherit?: boolean;
  /** Reject on non-zero exit. Default true. */
  throwOnError?: boolean;
  input?: string;
  /** Kill the child after this many ms. */
  timeout?: number;
};

/** Injectable platform/env for resolution logic (tests run on any OS). */
export type ResolveDeps = {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  isExecutable?: (path: string, platform: NodeJS.Platform) => boolean;
};

function mergeEnv(
  extra?: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!extra) return env;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function defaultIsExecutable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform === "win32") return true; // Windows has no X_OK bit; PATHEXT decides
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a bare command name against PATH (and PATHEXT on Windows).
 * Returns the first executable match, or null. Path-like names are checked as-is.
 */
export function resolveOnPath(bin: string, deps: ResolveDeps = {}): string | null {
  if (!bin) return null;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const pathMod = platform === "win32" ? win32 : posix;
  const isWin = platform === "win32";

  const exts = isWin
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((e) => e.trim())
        .filter(Boolean)
    : [];

  const hasSep = /[\\/]/.test(bin);
  if (hasSep) {
    if (isExecutable(bin, platform)) return bin;
    for (const ext of exts) {
      if (pathMod.extname(bin)) break;
      if (isExecutable(bin + ext, platform)) return bin + ext;
    }
    return null;
  }

  // On Windows never try the extensionless name: npm also writes a POSIX `sh`
  // shim named `wrangler` next to `wrangler.cmd`, which cmd cannot run.
  const names = isWin
    ? pathMod.extname(bin)
      ? [bin]
      : exts.map((e) => bin + e)
    : [bin];

  const rawPath = env.PATH ?? env.Path ?? env.path ?? "";
  const dirs = rawPath.split(isWin ? ";" : ":").filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = pathMod.join(dir, name);
      if (isExecutable(candidate, platform)) return candidate;
    }
  }
  return null;
}

/**
 * Quote one argument for a `cmd.exe /d /s /c` command line. Refuses characters
 * that cmd expands even inside quotes (`%`) or that break the line (`"`, CR/LF),
 * instead of trying to escape them.
 */
export function quoteCmdArg(arg: string): string {
  if (/[%"\r\n\0]/.test(arg)) {
    throw new Error(
      `refusing argument with cmd-unsafe characters on Windows: ${JSON.stringify(arg)}`
    );
  }
  if (arg === "") return '""';
  if (/[\s&|<>^()]/.test(arg)) return `"${arg}"`;
  return arg;
}

export type SpawnPlan = {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
};

/**
 * Decide how to launch `cmd args`. On Windows, a resolved `.cmd`/`.bat` runs
 * through cmd.exe with a pre-quoted verbatim command line; anything else is
 * spawned directly. On POSIX the command is passed through unchanged.
 */
export function planSpawn(
  cmd: string,
  args: string[],
  deps: ResolveDeps = {}
): SpawnPlan {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return { file: cmd, args };

  const resolved = resolveOnPath(cmd, { ...deps, platform });
  if (!resolved) return { file: cmd, args }; // spawn reports ENOENT as before

  const ext = win32.extname(resolved).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    const env = deps.env ?? process.env;
    const line = [resolved, ...args.map(quoteCmdArg)].join(" ");
    return {
      file: env.ComSpec || env.COMSPEC || "cmd.exe",
      // /s strips exactly one outer pair of quotes around the whole line.
      args: ["/d", "/s", "/c", `"${line}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { file: resolved, args };
}

export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const throwOnError = opts.throwOnError !== false;
  const plan = planSpawn(cmd, args);
  const spawnOpts = {
    cwd: opts.cwd,
    env: mergeEnv(opts.env),
    shell: false,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  };

  if (opts.inherit) {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(plan.file, plan.args, {
        ...spawnOpts,
        stdio: opts.input != null ? ["pipe", "inherit", "inherit"] : "inherit",
      });
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const timer =
        opts.timeout && opts.timeout > 0
          ? setTimeout(() => {
              child.kill("SIGTERM");
              killTimer = setTimeout(() => child.kill("SIGKILL"), 400);
            }, opts.timeout)
          : null;
      if (opts.input != null && child.stdin) {
        child.stdin.write(opts.input);
        child.stdin.end();
      }
      child.on("error", reject);
      child.on("close", (c) => {
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve(c ?? 1);
      });
    });
    if (throwOnError && code !== 0) {
      throw new Error(`${cmd} ${args.join(" ")} exited ${code}`);
    }
    return { code, stdout: "", stderr: "" };
  }

  const result = await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(plan.file, plan.args, {
      ...spawnOpts,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    if (opts.input != null && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timer =
      opts.timeout && opts.timeout > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            killTimer = setTimeout(() => child.kill("SIGKILL"), 400);
          }, opts.timeout)
        : null;
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

  if (throwOnError && result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${result.code}` +
        (detail ? `\n${detail}` : "")
    );
  }
  return result;
}

/**
 * Resolve a binary: Bun.which when running under Bun, otherwise PATH/PATHEXT in
 * Node (no `sh` dependency, so it works on Windows).
 */
export async function which(bin: string): Promise<string | null> {
  if (!bin || /[/\0]/.test(bin)) return null;
  if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
    return Bun.which(bin) ?? null;
  }
  return resolveOnPath(bin);
}

function wranglerBin(workerDir: string): string | null {
  const unix = join(workerDir, "node_modules", ".bin", "wrangler");
  const win = join(workerDir, "node_modules", ".bin", "wrangler.cmd");
  if (process.platform === "win32") {
    if (resolveOnPath(win)) return win;
    if (resolveOnPath(unix)) return unix;
    return null;
  }
  return resolveOnPath(unix) ?? (resolveOnPath(win) ? win : null);
}

/**
 * `wrangler@<version>` for the worker's declared range (`^4.114.0` → `4.114.0`).
 * Used only when the local binary is absent, so the fallback is deterministic.
 */
export function wranglerPackageSpec(workerDir: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(workerDir, "package.json"), "utf-8")
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const range = pkg.devDependencies?.wrangler ?? pkg.dependencies?.wrangler ?? "";
    const m = range.match(/(\d+\.\d+\.\d+)/);
    if (m) return `wrangler@${m[1]}`;
  } catch {
    /* no readable worker manifest — fall through to the unpinned spec */
  }
  return "wrangler";
}

/** Prefer local worker node_modules wrangler, then pinned bunx, then npx. */
export async function wranglerCmd(
  workerDir: string
): Promise<{ cmd: string; prefix: string[] }> {
  const local = wranglerBin(workerDir);
  if (local) return { cmd: local, prefix: [] };
  const spec = wranglerPackageSpec(workerDir);
  if (await which("bunx")) return { cmd: "bunx", prefix: [spec] };
  if (await which("npx")) return { cmd: "npx", prefix: ["--yes", spec] };
  if (await which("wrangler")) return { cmd: "wrangler", prefix: [] };
  throw new Error(
    "wrangler not found. Run: axis install  (or cd worker && bun install)"
  );
}

export async function runWrangler(
  workerDir: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const { cmd, prefix } = await wranglerCmd(workerDir);
  return run(cmd, [...prefix, ...args], { cwd: workerDir, ...opts });
}
