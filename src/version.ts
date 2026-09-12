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
export const BAKED_APP_VERSION: string = '2.6.6';

/** Running app version: build-time override or baked VERSION. */
export function appVersion(): string {
  try {
    const stamped =
      typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env
        ?.VITE_APP_VERSION;
    const v = String(stamped || '').trim();
    if (v) return v;
  } catch {
    /* non-Vite runtimes (bun tests) fall through to the baked value */
  }
  return BAKED_APP_VERSION;
}

/** Current app version (evaluated once at module load). */
export const APP_VERSION: string = appVersion();
