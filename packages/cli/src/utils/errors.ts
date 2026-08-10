/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const enum ExitCode {
  SUCCESS = 0,
  ERROR = 1,
  INVALID_USAGE = 2,
  NOT_FOUND = 3,
  UNAUTHENTICATED = 4,
}

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: ExitCode = ExitCode.ERROR,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "CLIError";
  }
}

export function isCLIError(err: unknown): err is CLIError {
  return err instanceof CLIError;
}
