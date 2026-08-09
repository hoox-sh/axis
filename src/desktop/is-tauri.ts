/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Detect the Tauri 2 desktop shell (vs browser / PWA).
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/** True when running inside the Tauri webview. */
export function isTauriShell(): boolean {
  try {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) return true;
  } catch {
    /* ignore */
  }
  try {
    if (import.meta.env?.TAURI_ENV_PLATFORM) return true;
  } catch {
    /* ignore */
  }
  try {
    const { protocol, hostname } = location;
    if (protocol === 'tauri:' || protocol === 'asset:') return true;
    if (hostname === 'tauri.localhost' || hostname === 'asset.localhost') return true;
  } catch {
    /* ignore */
  }
  return false;
}
