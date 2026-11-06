/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { assertHttpsForSecret } from '../services/health.js';
import { defaultPyneUrl, prewarmBackend } from '../services/prewarm.js';
import { theme, icons } from '../utils/theme.js';
import { ExitCode, printHeader, printJson, wrapAction, type GlobalOpts } from '../utils/format.js';

/**
 * Flags for `axis prewarm`, after commander has collected repeated `--script`.
 *
 * `script` is a list of local file paths; the sources are read here, not by the
 * service.
 */
export type PrewarmFlags = {
  endpoint?: string;
  key?: string;
  force?: boolean;
  /** Files whose Pine source is sent for warming. */
  script?: string[];
};

/**
 * Reads the `--script` files and asks a PYNE backend to warm its compile cache.
 *
 * Missing or unreadable files abort before any request is made, so a typo never
 * costs a network round trip. The backend caps the batch at 16 sources.
 *
 * @param opts - Global flags; `json` prints the raw result, `quiet` skips the human
 *   block.
 * @param flags - `endpoint` overrides the PYNE base URL, `key` overrides
 *   `AXIS_PYNE_API_KEY`, `force` re-warms builtins, `script` lists Pine files.
 * @throws {CLIError} From {@link assertHttpsForSecret} when `--key` would cross
 *   plain http to a non-local host.
 * @returns Resolves after printing; calls `process.exit` with `ExitCode.ERROR` for
 *   an unreadable script file or a failed prewarm.
 */
export async function runPrewarm(opts: GlobalOpts, flags: PrewarmFlags): Promise<void> {
  const base = (flags.endpoint || defaultPyneUrl()).replace(/\/$/, '');
  printHeader('AXIS prewarm', opts.quiet);

  // A key is a Bearer secret — never cleartext off-host.
  if (flags.key) assertHttpsForSecret(base, 'axis prewarm --key');

  const sources: string[] = [];
  for (const file of flags.script ?? []) {
    try {
      sources.push(readFileSync(file, 'utf8'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${theme.error(icons.fail)} cannot read ${file}: ${msg}\n`);
      process.exit(ExitCode.ERROR);
    }
  }

  const result = await prewarmBackend(base, {
    scripts: sources,
    force: flags.force,
    key: flags.key,
  });

  if (opts.json) {
    printJson(result);
    if (!result.ok) process.exit(ExitCode.ERROR);
    return;
  }

  if (!opts.quiet) {
    const icon = result.ok ? theme.success(icons.ok) : theme.error(icons.fail);
    process.stdout.write(`  ${icon} POST ${result.url}\n`);
    if (result.ok) {
      const ms = result.prewarmMs != null ? `${Math.round(result.prewarmMs)}ms` : '?';
      process.stdout.write(`      warmed in ${ms}\n`);
      process.stdout.write(
        `      numba=${result.hasNumba ? 'yes' : 'no'} builtins=${result.builtinsWarmed ? 'warm' : 'cold'}\n`,
      );
      if (sources.length) {
        process.stdout.write(
          `      scripts ok=${result.scriptsOk} failed=${result.scriptsFailed}\n`,
        );
      }
      if (!result.hasNumba) {
        process.stdout.write(
          `      ${theme.warn('no Numba on this host — compile runs in object mode')}\n`,
        );
      }
      for (const e of result.errors.slice(0, 5)) {
        process.stdout.write(`      ${theme.warn(e)}\n`);
      }
    } else if (result.error) {
      process.stdout.write(`      ${theme.error(result.error)}\n`);
    }
  }

  if (!result.ok) process.exit(ExitCode.ERROR);
}

/**
 * Registers `axis prewarm`.
 *
 * @param program - Root commander program to attach the command to.
 */
export function registerPrewarm(program: Command): void {
  program
    .command('prewarm')
    .description('Warm Numba builtins / IR cache on a PYNE backend (POST /compile/prewarm)')
    .option('--endpoint <url>', 'PYNE base URL', defaultPyneUrl())
    .option('--key <key>', 'API key (else AXIS_PYNE_API_KEY)')
    .option('--force', 'Re-warm builtins even when already warm')
    .option(
      '--script <file>',
      'Pine file to compile into the IR cache (repeatable, max 16)',
      (v: string, acc: string[] = []) => [...acc, v],
    )
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & PrewarmFlags;
      await wrapAction((g) =>
        runPrewarm(g, {
          endpoint: o.endpoint,
          key: o.key,
          force: o.force,
          script: o.script,
        }),
      ).call(this);
    });
}
