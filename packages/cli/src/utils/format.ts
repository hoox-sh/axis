/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { theme, icons } from "./theme.js";
import { CLIError, ExitCode, isCLIError } from "./errors.js";

export type GlobalOpts = {
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
};

export function getGlobalOpts(cmd: {
  optsWithGlobals?: () => GlobalOpts;
  opts?: () => GlobalOpts;
}): GlobalOpts {
  const o =
    typeof cmd.optsWithGlobals === "function"
      ? cmd.optsWithGlobals()
      : cmd.opts?.() ?? {};
  const json = Boolean(o.json);
  return {
    json,
    // JSON is a machine-readable contract — never mix human banners into stdout.
    quiet: Boolean(o.quiet) || json,
    yes: Boolean(o.yes),
  };
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printOk(msg: string, quiet?: boolean): void {
  if (quiet) return;
  process.stdout.write(`${theme.success(icons.ok)} ${msg}\n`);
}

export function printWarn(msg: string, quiet?: boolean): void {
  if (quiet) return;
  process.stderr.write(`${theme.warn(icons.warn)} ${msg}\n`);
}

export function printInfo(msg: string, quiet?: boolean): void {
  if (quiet) return;
  process.stdout.write(`${theme.dim(icons.info)} ${msg}\n`);
}

export function printHeader(title: string, quiet?: boolean): void {
  if (quiet) return;
  process.stdout.write(`\n${theme.heading(title)}\n\n`);
}

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
    `${theme.error(icons.fail)} ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(ExitCode.ERROR);
}

export function wrapAction(
  fn: (opts: GlobalOpts) => Promise<void> | void
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
  if (!err || typeof err !== "object" || !("code" in err)) return null;
  const code = String((err as { code?: string }).code ?? "");
  if (code === "commander.helpDisplayed" || code === "commander.version") {
    return 0;
  }
  if (code.startsWith("commander.")) {
    const exit = (err as { exitCode?: number }).exitCode;
    return typeof exit === "number" ? exit : ExitCode.INVALID_USAGE;
  }
  return null;
}

export { CLIError, ExitCode };
