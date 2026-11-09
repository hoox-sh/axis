/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Worker version — GENERATED from the repo-root VERSION file. Do not edit.
 * Regenerate with 'bun run sync:versions'. Surfaced on '/' + '/health'.
 *
 * @module version
 */

/** Deployed worker version (repo-root VERSION at sync time). */
export const WORKER_VERSION: string = '2.28.0';

/**
 * Git SHA baked by `wrangler deploy --define WORKER_GIT_SHA:"<sha>"`.
 * Empty in unit tests (the identifier is undeclared).
 */
declare const WORKER_GIT_SHA: string | undefined;

export function workerGitSha(): string {
  return typeof WORKER_GIT_SHA === 'string' ? WORKER_GIT_SHA : '';
}
