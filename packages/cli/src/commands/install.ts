/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis install — bun install at repo root, worker/, and packages/cli
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { run, which } from "../utils/run.js";
import {
  CLIError,
  ExitCode,
  printHeader,
  printInfo,
  printJson,
  printOk,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

async function installDeps(dir: string, label: string, quiet?: boolean) {
  printInfo(`Installing ${label}…`, quiet);
  await run("bun", ["install"], { cwd: dir, inherit: !quiet });
  printOk(`${label} ready`, quiet);
}

export async function runInstall(opts: GlobalOpts): Promise<void> {
  if (!(await which("bun"))) {
    throw new CLIError(
      "Bun is required (https://bun.sh).",
      ExitCode.ERROR,
      "Install: curl -fsSL https://bun.sh | bash"
    );
  }

  const paths = getPaths();
  printHeader("AXIS install", opts.quiet);

  const targets: { dir: string; label: string }[] = [
    { dir: paths.root, label: "app (root)" },
    { dir: paths.worker, label: "worker" },
  ];
  if (existsSync(paths.cli)) {
    targets.push({ dir: paths.cli, label: "cli" });
  }

  for (const t of targets) {
    if (!existsSync(t.dir)) {
      throw new CLIError(`Missing directory: ${t.dir}`, ExitCode.NOT_FOUND);
    }
    await installDeps(t.dir, t.label, opts.quiet);
  }

  if (opts.json) {
    printJson({
      ok: true,
      installed: targets.map((t) => t.dir),
    });
    return;
  }
  printOk("Install complete. Next: axis doctor && axis setup", opts.quiet);
}

export function registerInstall(program: Command): void {
  program
    .command("install")
    .description("Install app, worker, and CLI dependencies (bun install)")
    .action(wrapAction(runInstall));
}
