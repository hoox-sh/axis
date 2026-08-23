/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Thin process runner (child_process).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
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

export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const throwOnError = opts.throwOnError !== false;

  if (opts.inherit) {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: mergeEnv(opts.env),
        stdio: opts.input != null ? ["pipe", "inherit", "inherit"] : "inherit",
        shell: false,
      });
      if (opts.input != null && child.stdin) {
        child.stdin.write(opts.input);
        child.stdin.end();
      }
      child.on("error", reject);
      child.on("close", (c) => resolve(c ?? 1));
    });
    if (throwOnError && code !== 0) {
      throw new Error(`${cmd} ${args.join(" ")} exited ${code}`);
    }
    return { code, stdout: "", stderr: "" };
  }

  const result = await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: mergeEnv(opts.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
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
    child.on("error", reject);
    child.on("close", (code) => {
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

export async function which(bin: string): Promise<string | null> {
  if (!bin || /[/\0]/.test(bin)) return null;
  if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
    return Bun.which(bin) ?? null;
  }
  // $1 is bound via the extra argv after -c (never interpolates `bin` into the script).
  const r = await run("sh", ["-c", 'command -v -- "$1"', "axis-which", bin], {
    throwOnError: false,
  });
  const path = r.stdout.trim();
  return r.code === 0 && path ? path : null;
}

function wranglerBin(workerDir: string): string | null {
  const unix = join(workerDir, "node_modules", ".bin", "wrangler");
  const win = join(workerDir, "node_modules", ".bin", "wrangler.cmd");
  if (process.platform === "win32") {
    if (existsSync(win)) return win;
    if (existsSync(unix)) return unix;
    return null;
  }
  return existsSync(unix) ? unix : existsSync(win) ? win : null;
}

/** Prefer local worker node_modules wrangler, then bunx, then npx. */
export async function wranglerCmd(
  workerDir: string
): Promise<{ cmd: string; prefix: string[] }> {
  const local = wranglerBin(workerDir);
  if (local) return { cmd: local, prefix: [] };
  if (await which("bunx")) return { cmd: "bunx", prefix: ["wrangler"] };
  if (await which("npx")) return { cmd: "npx", prefix: ["wrangler"] };
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
