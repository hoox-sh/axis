/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Process exit codes the CLI promises to scripts and CI.
 *
 * Values are stable: changing one is a breaking change for anything branching on
 * `$?`.
 */
export enum ExitCode {
  SUCCESS = 0,
  ERROR = 1,
  INVALID_USAGE = 2,
  NOT_FOUND = 3,
  UNAUTHENTICATED = 4,
}

/**
 * Expected, user-facing failure with a stable exit code and optional fix hint.
 *
 * Thrown by command internals and rendered by `handleError`; anything that is not
 * a `CLIError` is treated as an unexpected crash and mapped to
 * {@link ExitCode.ERROR}.
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: ExitCode = ExitCode.ERROR,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

/**
 * Narrows an unknown thrown value to {@link CLIError} so its `code` and `hint`
 * can be read without a cast.
 *
 * @param err - Any caught value.
 * @returns `true` when `err` is a `CLIError` instance.
 */
export function isCLIError(err: unknown): err is CLIError {
  return err instanceof CLIError;
}
