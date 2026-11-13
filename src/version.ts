/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * App version — GENERATED from the repo-root VERSION file. Do not edit.
 * Regenerate with 'bun run sync:versions'.
 *
 * VITE_APP_VERSION (stamped by Docker/CI at build time) wins when set so
 * release pipelines can stamp without rewriting source; otherwise the baked
 * VERSION value is used. Both derive from the same file.
 *
 * @module version
 */

/** Baked single source of truth (repo-root VERSION at sync time). */
export const BAKED_APP_VERSION: string = '2.29.0';

/** Running app version: build-time override or baked VERSION. */
export function appVersion(): string {
  try {
    // ImportMeta.env is typed by vite/client; the cast only covers runtimes
    // where import.meta exists without an env field (bun tests).
    const stamped = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env?.['VITE_APP_VERSION'];
    const v = String(stamped || '').trim();
    if (v) return v;
  } catch {
    /* non-Vite runtimes (bun tests) fall through to the baked value */
  }
  return BAKED_APP_VERSION;
}

/** Current app version (evaluated once at module load). */
export const APP_VERSION: string = appVersion();

/**
 * Git SHA of the build (Vite `VITE_GIT_SHA`). Empty in unit tests / unsynced
 * trees. Deployed identity is version + git in dist/version.json.
 */
export function gitSha(): string {
  try {
    const stamped = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env?.['VITE_GIT_SHA'];
    const v = String(stamped || '').trim();
    if (v) return v;
  } catch {
    /* bun tests */
  }
  return '';
}

/** `2.28.0+abc1234def56` when a SHA is baked, else the semver. */
export function appIdentity(version: string = APP_VERSION, sha: string = gitSha()): string {
  const v = String(version || '').trim();
  const g = String(sha || '').trim();
  if (v && g) return `${v}+${g.slice(0, 12)}`;
  return v;
}
