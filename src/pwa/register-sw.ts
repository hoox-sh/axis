/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Safe, idempotent service-worker registration for the Solid/Vite product path.
 *
 * - Skips Vite dev (`import.meta.env.DEV`) — HMR and SW fight over assets.
 * - Skips `file:` protocol.
 * - Skips Tauri desktop shell (custom asset protocol / no offline SW needed).
 * - Registers at most once per page load (module + `window` guard).
 * - SW install may call `skipWaiting`; activate calls `clients.claim`.
 * - Page posts `SKIP_WAITING` only when activating a waiting update, then
 *   reloads once on `controllerchange` so mixed old/new modules never stick.
 */

declare global {
  interface Window {
    /** Set while / after SW registration to prevent double-register across shells. */
    __AXIS_SW_REGISTERED__?: boolean;
    /** Injected by Tauri 2 webview runtime. */
    __TAURI_INTERNALS__?: unknown;
  }
}

/** Message accepted by `public/sw.js` / root `sw.js` to call `skipWaiting()`. */
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING' as const;

let registerPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** True after we decide this page should soft-reload on the next controller change. */
let updateActivationRequested = false;
/** Guards against double `location.reload()` if controllerchange fires twice. */
let refreshing = false;
/** Snapshot at register time: page already controlled by a SW. */
let hadControllerAtRegister = false;

function isDevBuild(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/** True when running inside the Tauri desktop webview. */
function isTauriShell(): boolean {
  try {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) return true;
  } catch {
    /* ignore */
  }
  try {
    // Vite + Tauri CLI inject TAURI_ENV_* when building/serving for desktop.
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

/**
 * Whether a `controllerchange` should trigger a single soft reload.
 * Avoids reload on first-time SW claim; allows reload after an intentional
 * update activation or when replacing an existing controller (auto skipWaiting).
 */
export function shouldSoftReloadOnControllerChange(opts: {
  refreshing: boolean;
  hadControllerAtRegister: boolean;
  updateActivationRequested: boolean;
}): boolean {
  if (opts.refreshing) return false;
  return opts.hadControllerAtRegister || opts.updateActivationRequested;
}

/** Post SKIP_WAITING to a waiting/installing worker (no side effects beyond postMessage). */
export function postSkipWaiting(worker: { postMessage: (msg: unknown) => void }): void {
  worker.postMessage(SKIP_WAITING_MESSAGE);
}

/**
 * Mark that we intend to activate a waiting SW and ask it to skip waiting.
 * Paired with controllerchange → single soft reload.
 */
export function requestWaitingWorkerActivation(worker: {
  postMessage: (msg: unknown) => void;
}): void {
  updateActivationRequested = true;
  postSkipWaiting(worker);
}

function softReloadIfAppropriate(
  reload: () => void = () => {
    globalThis.location.reload();
  },
): boolean {
  if (
    !shouldSoftReloadOnControllerChange({
      refreshing,
      hadControllerAtRegister,
      updateActivationRequested,
    })
  ) {
    return false;
  }
  refreshing = true;
  reload();
  return true;
}

function attachControllerChangeReload(
  serviceWorker: Pick<ServiceWorkerContainer, 'addEventListener'>,
): void {
  serviceWorker.addEventListener('controllerchange', () => {
    softReloadIfAppropriate();
  });
}

/**
 * When a new worker finishes installing and is waiting, activate + reload path.
 * No-op if nothing is waiting (e.g. first install already activated via SW skipWaiting).
 */
export function onWorkerInstalled(
  worker: { state: string; postMessage: (msg: unknown) => void },
  registration: { waiting: { postMessage: (msg: unknown) => void } | null },
): boolean {
  if (worker.state !== 'installed') return false;
  const waiting = registration.waiting;
  if (!waiting) return false;
  requestWaitingWorkerActivation(waiting);
  return true;
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
    if (isTauriShell()) return null;
    if (isDevBuild()) return null;
    if (window.__AXIS_SW_REGISTERED__) return null;

    window.__AXIS_SW_REGISTERED__ = true;

    try {
      hadControllerAtRegister = Boolean(navigator.serviceWorker.controller);
      attachControllerChangeReload(navigator.serviceWorker);

      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: './',
        // classic SW (not module) — public/sw.js
        updateViaCache: 'none',
      });

      // Waiting worker (stale tab / skipWaiting disabled): activate only with reload path.
      if (reg.waiting) {
        requestWaitingWorkerActivation(reg.waiting);
      }

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          onWorkerInstalled(installing, reg);
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
  updateActivationRequested = false;
  refreshing = false;
  hadControllerAtRegister = false;
  if (typeof window !== 'undefined') {
    try {
      delete window.__AXIS_SW_REGISTERED__;
    } catch {
      window.__AXIS_SW_REGISTERED__ = false;
    }
  }
}
