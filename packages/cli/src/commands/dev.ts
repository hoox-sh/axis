/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis dev — start Vite or wrangler (foreground)
 */

import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { run, runWrangler } from "../utils/run.js";
import {
  printHeader,
  printInfo,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

export function registerDev(program: Command): void {
  const dev = program
    .command("dev")
    .description("Start local dev servers (Vite app or Worker)")
    .action(
      wrapAction(async (opts: GlobalOpts) => {
        const paths = getPaths();
        printHeader("AXIS dev (Vite :3000)", opts.quiet);
        printInfo(
          "Engine: start PYNE on :5002. Worker: axis dev worker",
          opts.quiet
        );
        await run("bun", ["run", "dev"], {
          cwd: paths.root,
          inherit: true,
        });
      })
    );

  dev
    .command("app")
    .description("Vite dev server (default)")
    .action(
      wrapAction(async (opts) => {
        const paths = getPaths();
        printHeader("AXIS dev app", opts.quiet);
        await run("bun", ["run", "dev"], {
          cwd: paths.root,
          inherit: true,
        });
      })
    );

  dev
    .command("worker")
    .description("wrangler dev on :8787")
    .action(
      wrapAction(async (opts) => {
        const paths = getPaths();
        printHeader("AXIS dev worker (:8787)", opts.quiet);
        await runWrangler(paths.worker, ["dev"], { inherit: true });
      })
    );

  dev
    .command("desktop")
    .description("Tauri + Vite desktop shell")
    .action(
      wrapAction(async (opts) => {
        const paths = getPaths();
        printHeader("AXIS dev desktop", opts.quiet);
        await run("bun", ["run", "desktop:dev"], {
          cwd: paths.root,
          inherit: true,
        });
      })
    );
}
