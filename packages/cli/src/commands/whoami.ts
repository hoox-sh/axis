/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Command } from 'commander';
import { getPaths } from '../utils/paths.js';
import { runWrangler } from '../utils/run.js';
import {
  CLIError,
  ExitCode,
  printHeader,
  printJson,
  wrapAction,
  type GlobalOpts,
} from '../utils/format.js';

/**
 * Registers `axis whoami`.
 *
 * Shells out to `wrangler whoami` so Cloudflare auth is verified with the same
 * credentials a deploy will use, rather than a separate token check.
 *
 * @param program - Root commander program to attach the command to.
 */
export function registerWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Show Cloudflare account (wrangler whoami)')
    .action(
      wrapAction(async (opts: GlobalOpts) => {
        const paths = getPaths();
        printHeader('AXIS whoami', opts.quiet);
        const r = await runWrangler(paths.worker, ['whoami'], {
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
            'Not authenticated with Cloudflare',
            ExitCode.UNAUTHENTICATED,
            'Set CLOUDFLARE_API_TOKEN or run: cd worker && npx wrangler login',
          );
        }
      }),
    );
}
