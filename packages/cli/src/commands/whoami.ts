/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { runWrangler } from "../utils/run.js";
import {
  CLIError,
  ExitCode,
  printHeader,
  printJson,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

export function registerWhoami(program: Command): void {
  program
    .command("whoami")
    .description("Show Cloudflare account (wrangler whoami)")
    .action(
      wrapAction(async (opts: GlobalOpts) => {
        const paths = getPaths();
        printHeader("AXIS whoami", opts.quiet);
        const r = await runWrangler(paths.worker, ["whoami"], {
          throwOnError: false,
          inherit: !opts.json,
        });
        if (opts.json) {
          printJson({
            ok: r.code === 0,
            stdout: r.stdout,
            stderr: r.stderr,
          });
        }
        if (r.code !== 0) {
          throw new CLIError(
            "Not authenticated with Cloudflare",
            ExitCode.UNAUTHENTICATED,
            "Set CLOUDFLARE_API_TOKEN or run: cd worker && npx wrangler login"
          );
        }
      })
    );
}
