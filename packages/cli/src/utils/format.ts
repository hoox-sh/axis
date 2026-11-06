/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { theme, icons } from './theme.js';
import { CLIError, ExitCode, isCLIError } from './errors.js';

/**
 * Global flags every command inherits from the root program.
 *
 * `quiet` is derived, not just read: JSON mode forces it on so machine-readable
 * stdout is never polluted by human banners.
 */
export type GlobalOpts = {
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
};

/**
 * Resolves the inherited global flags for a command action.
 *
 * Prefers `optsWithGlobals()` when commander provides it so flags declared on the
 * root program (`--json`, `--quiet`, `--yes`) are visible from subcommands.
 *
 * @param cmd - The commander command instance (`this` inside an action handler).
 * @returns Normalized flags; `quiet` is `true` whenever `json` is set.
 */
export function getGlobalOpts(cmd: {
  optsWithGlobals?: () => GlobalOpts;
  opts?: () => GlobalOpts;
}): GlobalOpts {
  const o =
    typeof cmd.optsWithGlobals === 'function' ? cmd.optsWithGlobals() : (cmd.opts?.() ?? {});
  const json = Boolean(o.json);
  return {
    json,
    // JSON is a machine-readable contract — never mix human banners into stdout.
    quiet: Boolean(o.quiet) || json,
    yes: Boolean(o.yes),
  };
}

/**
 * Writes a value to stdout as pretty-printed JSON — the only output shape
 * scripts and CI should depend on.
 *
 * @param data - Any JSON-serializable value; functions and cycles throw from
 *   `JSON.stringify` as usual.
 */
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Prints a success line to stdout, suppressed in quiet mode.
 *
 * @param msg - Human-readable message, no icon or prefix needed.
 * @param quiet - Skip the write entirely when `true`.
 */
export function printOk(msg: string, quiet?: boolean): void {
  if (quiet) return;
  process.stdout.write(`${theme.success(icons.ok)} ${msg}\n`);
}

/**
 * Prints a warning to **stderr** so it survives stdout redirection and stays out
 * of JSON payloads.
 *
 * @param msg - Human-readable warning text.
 * @param quiet - Skip the write entirely when `true`.
 */
export function printWarn(msg: string, quiet?: boolean): void {
  if (quiet) return;
  process.stderr.write(`${theme.warn(icons.warn)} ${msg}\n`);
}

/**
 * Prints a dimmed informational line to stdout, suppressed in quiet mode.
 *
 * @param msg - Human-readable message.
 * @param quiet - Skip the write entirely when `true`.
 */
export function printInfo(msg: string, quiet?: boolean): void {
  if (quiet) return;
  process.stdout.write(`${theme.dim(icons.info)} ${msg}\n`);
}

/**
 * Prints a blank-line-padded section heading to stdout, suppressed in quiet mode.
 *
 * @param title - Section title, rendered in the heading color.
 * @param quiet - Skip the write entirely when `true`.
 */
export function printHeader(title: string, quiet?: boolean): void {
  if (quiet) return;
  process.stdout.write(`\n${theme.heading(title)}\n\n`);
}

/**
 * Terminal error handler for command actions — prints and **exits the process**.
 *
 * A {@link CLIError} carries its own exit code and optional hint; anything else
 * falls back to {@link ExitCode.ERROR}. In JSON mode the payload is
 * `{ ok: false, error, code?, hint? }` on stdout, otherwise a colored line plus
 * hint on stderr.
 *
 * @param err - Thrown value; non-`Error` values are stringified.
 * @param json - Emit a JSON envelope instead of human text.
 * @returns Never — `process.exit` is always called.
 */
export function handleError(err: unknown, json?: boolean): never {
  if (json) {
    if (isCLIError(err)) {
      printJson({
        ok: false,
        error: err.message,
        code: err.code,
        hint: err.hint,
      });
      process.exit(err.code);
    }
    printJson({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(ExitCode.ERROR);
  }

  if (isCLIError(err)) {
    process.stderr.write(`${theme.error(icons.fail)} ${err.message}\n`);
    if (err.hint) process.stderr.write(`${theme.dim(err.hint)}\n`);
    process.exit(err.code);
  }
  process.stderr.write(
    `${theme.error(icons.fail)} ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(ExitCode.ERROR);
}

/**
 * Wraps a command action so thrown errors become printed messages plus an exit
 * code instead of an unhandled rejection.
 *
 * The wrapper resolves the inherited {@link GlobalOpts} itself, passes them to
 * `fn`, and routes any throw to {@link handleError} — so `fn` should not catch
 * and exit on its own.
 *
 * @param fn - Action body receiving the resolved global flags.
 * @returns A commander action handler bound to the command instance.
 */
export function wrapAction(
  fn: (opts: GlobalOpts) => Promise<void> | void,
): (this: { optsWithGlobals?: () => GlobalOpts; opts?: () => GlobalOpts }) => Promise<void> {
  return async function action(this) {
    const opts = getGlobalOpts(this);
    try {
      await fn(opts);
    } catch (err) {
      handleError(err, opts.json);
    }
  };
}

/** Commander already printed these; map them to an exit code without wrapping. */
export function commanderExitCode(err: unknown): number | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const code = String((err as { code?: string }).code ?? '');
  if (code === 'commander.helpDisplayed' || code === 'commander.version') {
    return 0;
  }
  if (code.startsWith('commander.')) {
    const exit = (err as { exitCode?: number }).exitCode;
    return typeof exit === 'number' ? exit : ExitCode.INVALID_USAGE;
  }
  return null;
}

export { CLIError, ExitCode };
