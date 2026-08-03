/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Safe, idempotent service-worker registration for the Solid/Vite product path.
 *
 * - Skips Vite dev (`import.meta.env.DEV`) — HMR and SW fight over assets.
 * - Skips `file:` protocol.
 * - Registers at most once per page load (module + `window` guard).
 * - SW install already calls `skipWaiting`; activate calls `clients.claim`.
 * - Optional `SKIP_WAITING` postMessage for waiting workers (update UX).
 */

declare global {
  interface Window {
    /** Set while / after SW registration to prevent double-register across shells. */
    __AXIS_SW_REGISTERED__?: boolean;
  }
}

let registerPromise: Promise<ServiceWorkerRegistration | null> | null = null;

function isDevBuild(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Register `/sw.js` once. Returns the registration or null when skipped/failed.
 */
export function registerAxisServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registerPromise) return registerPromise;

  registerPromise = (async () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return null;
    }
    if (!('serviceWorker' in navigator)) return null;
    if (location.protocol === 'file:') return null;
    if (isDevBuild()) return null;
    if (window.__AXIS_SW_REGISTERED__) return null;

    window.__AXIS_SW_REGISTERED__ = true;

    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: './',
        // classic SW (not module) — public/sw.js
        updateViaCache: 'none',
      });

      // If a new worker is waiting (e.g. skipWaiting disabled in future), nudge it.
      if (reg.waiting) {
        reg.waiting.postMessage('SKIP_WAITING');
      }

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && reg.waiting) {
            reg.waiting.postMessage('SKIP_WAITING');
          }
        });
      });

      // Opportunistic update check (no throw on offline).
      void reg.update().catch(() => {});

      return reg;
    } catch {
      window.__AXIS_SW_REGISTERED__ = false;
      registerPromise = null;
      return null;
    }
  })();

  return registerPromise;
}

/** Test helper — reset module guards between unit tests. */
export function _resetRegisterAxisServiceWorkerForTests(): void {
  registerPromise = null;
  if (typeof window !== 'undefined') {
    try {
      delete window.__AXIS_SW_REGISTERED__;
    } catch {
      window.__AXIS_SW_REGISTERED__ = false;
    }
  }
}
