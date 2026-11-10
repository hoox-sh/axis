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
export const WORKER_VERSION: string = '2.28.1';

/**
 * Git SHA baked by `wrangler deploy --define WORKER_GIT_SHA:"<sha>"`.
 * Empty in unit tests (the identifier is undeclared). Runtime fallback is
 * `env.GIT_SHA` from `wrangler deploy --var GIT_SHA:<sha>`.
 */
declare const WORKER_GIT_SHA: string | undefined;

/** Hex git SHA, or empty when the value is missing / not a SHA. */
export function normalizeGitSha(raw: unknown): string {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(v) ? v : '';
}

/**
 * Deploy identity proof: compile-time define, then wrangler `[vars]` / `--var`.
 */
export function workerGitSha(fromEnv?: unknown): string {
  const baked = typeof WORKER_GIT_SHA === 'string' ? WORKER_GIT_SHA : '';
  return normalizeGitSha(baked) || normalizeGitSha(fromEnv);
}
