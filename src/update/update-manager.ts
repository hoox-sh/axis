// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * App update manager — polls the deployed `/version.json` and surfaces new
 * releases as a banner + notification with a hard-reload action.
 *
 * Sources of "a new version is deployed":
 * - `checkForUpdates()` — compares the running {@link APP_VERSION} against
 *   the served `/version.json`. Started automatically via
 *   {@link startUpdatePolling} (interval + focus/visibility/online triggers).
 * - `markUpdateAvailable()` — called when the service worker reports a
 *   waiting update (`register-sw` `onUpdateAvailable` hook).
 *
 * Both paths funnel into the same `updateState` signal rendered by
 * {@link src/ui/UpdateBanner.tsx}, announced via `sr-announce`, mirrored to
 * the status line, and (when already granted) the Browser Notification API.
 *
 * @module update/update-manager
 */

import { createSignal } from 'solid-js';
import { APP_VERSION } from '../version';
import { announce } from '../ui/sr-announce';
import { setCloseGuardEnabled } from '../pwa/close-guard';

export type UpdateSource = 'version-poll' | 'service-worker' | 'manual';

export interface UpdateInfo {
  /** Version this page booted with. */
  currentVersion: string;
  /** Newly deployed version. */
  latestVersion: string;
  /** How the update was detected. */
  source: UpdateSource;
  /** When it was detected. */
  detectedAt: number;
}

export type UpdateStatus = 'current' | 'update-available' | 'reloading';

export interface UpdateState {
  status: UpdateStatus;
  update: UpdateInfo | null;
  /** Last successful version check (0 = never). */
  lastCheckedAt: number;
}

const INITIAL_STATE: UpdateState = { status: 'current', update: null, lastCheckedAt: 0 };

const [updateState, setUpdateState] = createSignal<UpdateState>(INITIAL_STATE);

/** Reactive update state (banner reads this). */
export function getUpdateState(): UpdateState {
  return updateState();
}

/** How often the deployed version is re-checked (5 min). */
export const UPDATE_POLL_MS = 5 * 60 * 1000;
/** Minimum gap between checks triggered by focus/visibility/online (60 s). */
export const UPDATE_CHECK_THROTTLE_MS = 60 * 1000;

/** Normalize a raw version value for comparison. */
export function normalizeVersion(raw: unknown): string {
  return String(raw ?? '').trim();
}

/** True when the deployed version differs from the running one. */
export function isNewerVersion(deployed: unknown, running: string = APP_VERSION): boolean {
  const next = normalizeVersion(deployed);
  if (!next) return false;
  return next !== normalizeVersion(running);
}

/**
 * Build the URL polled for the deployed version. Relative to the app base so
 * sub-path deployments (Pages custom paths, Tauri) resolve correctly, with a
 * cache-busting query so intermediaries never serve a stale manifest.
 */
export function versionJsonUrl(base: string = defaultBase(), nonce: number = Date.now()): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}version.json?t=${nonce}`;
}

function defaultBase(): string {
  try {
    const b = import.meta.env?.BASE_URL as string | undefined;
    if (typeof b === 'string' && b) return b;
  } catch {
    /* non-Vite runtimes */
  }
  return './';
}

export interface VersionJson {
  version?: unknown;
  buildTime?: unknown;
}

async function fetchDeployedVersion(
  fetchImpl: typeof fetch = fetch,
  url: string = versionJsonUrl(),
): Promise<string | null> {
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = (await res.json()) as VersionJson;
  const v = normalizeVersion(body?.version);
  return v || null;
}

/** Optional side channels fired when an update is detected. */
export interface UpdateNotifyHooks {
  /** Status-line mirror (defaults to the app store `setStatus`). */
  setStatus?: (message: string, info: UpdateInfo) => void;
  /** Whether a Browser Notification may be shown (default: permission check). */
  canNotify?: () => boolean;
  /** Show a Browser Notification (default: `new Notification(...)`). */
  showNotification?: (title: string, body: string) => void;
}

function defaultSetStatus(message: string): void {
  void import('../store').then(({ setStatus, store }) => {
    try {
      if (store.status !== 'ready') return;
      setStatus('ready', message);
    } catch {
      /* store unavailable (tests) */
    }
  });
}

function notifyUpdateAvailable(info: UpdateInfo, hooks: UpdateNotifyHooks = {}): void {
  const title = 'AXIS update available';
  const body = `v${info.currentVersion} → v${info.latestVersion}. Reload to update.`;
  announce(`${title}: ${body}`);
  try {
    (hooks.setStatus ?? defaultSetStatus)(`Update available: v${info.latestVersion} — reload to update.`, info);
  } catch {
    /* notification must never break the update flow */
  }
  const canNotify = hooks.canNotify
    ? hooks.canNotify()
    : typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (!canNotify) return;
  try {
    if (hooks.showNotification) hooks.showNotification(title, body);
    else if (typeof Notification !== 'undefined') {
      new Notification(title, { body });
    }
  } catch {
    /* never granted / blocked — banner + announce already surfaced it */
  }
}

/**
 * Record a detected update: flips state, announces, mirrors to status, and
 * fires a Browser Notification when permission was already granted. Never
 * prompts for notification permission (no nag).
 */
export function markUpdateAvailable(
  latestVersion: string,
  source: UpdateSource = 'manual',
  hooks: UpdateNotifyHooks = {},
  runningVersion: string = APP_VERSION,
): UpdateInfo | null {
  const next = normalizeVersion(latestVersion);
  const running = normalizeVersion(runningVersion);
  if (!next || next === running) return null;
  const prev = updateState();
  if (prev.status === 'update-available' && prev.update?.latestVersion === next) {
    return prev.update;
  }
  const info: UpdateInfo = {
    currentVersion: running,
    latestVersion: next,
    source,
    detectedAt: Date.now(),
  };
  setUpdateState({ status: 'update-available', update: info, lastCheckedAt: prev.lastCheckedAt });
  notifyUpdateAvailable(info, hooks);
  return info;
}

/**
 * Dismiss the banner until the next detection (poll/SW re-fires on change).
 * Clears the payload so stale versions can't leak into later reloads.
 */
export function dismissUpdate(): void {
  const prev = updateState();
  if (prev.status !== 'update-available') return;
  setUpdateState({ ...prev, status: 'current', update: null });
}

export interface CheckForUpdatesOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  runningVersion?: string;
  hooks?: UpdateNotifyHooks;
}

/**
 * Poll the deployed `/version.json` once. Returns the `UpdateInfo` when the
 * deployed version differs (and records it), else `null`. Never throws —
 * offline / 404 / malformed payloads resolve `null`.
 */
export async function checkForUpdates(opts: CheckForUpdatesOptions = {}): Promise<UpdateInfo | null> {
  const running = normalizeVersion(opts.runningVersion ?? APP_VERSION);
  let deployed: string | null = null;
  try {
    deployed = await fetchDeployedVersion(opts.fetchImpl ?? fetch, opts.url ?? versionJsonUrl());
  } catch {
    return null;
  }
  setUpdateState((prev) => ({ ...prev, lastCheckedAt: Date.now() }));
  if (!deployed || deployed === running) return null;
  return markUpdateAvailable(deployed, 'version-poll', opts.hooks, running);
}

/**
 * Build a hard-reload URL: same page with a cache-busting `_axis_v` param so
 * no intermediary serves the stale shell after caches are cleared.
 */
export function buildHardReloadUrl(href: string, latestVersion: string): string {
  const u = new URL(href, 'http://localhost');
  u.searchParams.set('_axis_v', normalizeVersion(latestVersion) || String(Date.now()));
  // Preserve hash; drop the synthetic localhost origin for relative URLs.
  const out = `${u.pathname}${u.search}${u.hash}`;
  return href.startsWith('http://') || href.startsWith('https://')
    ? `${u.origin}${out}`
    : out;
}

export interface ReloadDeps {
  serviceWorker?: {
    getRegistrations?: () => Promise<Array<{ unregister: () => Promise<boolean> }>>;
  };
  caches?: {
    keys?: () => Promise<string[]>;
    delete?: (key: string) => Promise<boolean>;
  };
  location?: { href: string };
  navigate?: (url: string) => void;
  /** Confirm dialog before reload. Tests inject this; default is `window.confirm`. */
  confirm?: (message: string) => boolean;
  /** Skip the confirm prompt (banner already asked, or tests). */
  skipConfirm?: boolean;
}

/** Prompt text for applying a detected update (soft or hard reload). */
export function appUpdateConfirmMessage(currentVersion: string, latestVersion: string): string {
  const from = normalizeVersion(currentVersion) || currentVersion;
  const to = normalizeVersion(latestVersion) || latestVersion;
  return `Update AXIS from v${from} to v${to}? The app will reload.`;
}

function defaultConfirm(message: string): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
  } catch {
    /* tests / non-DOM */
  }
  return true;
}

/** Ask before reloading into a new version. Returns false if the user cancels. */
export function confirmAppUpdate(
  currentVersion: string,
  latestVersion: string,
  confirm: (message: string) => boolean = defaultConfirm,
): boolean {
  return confirm(appUpdateConfirmMessage(currentVersion, latestVersion));
}

/**
 * Hard reload: unregister service workers, delete `axis-*` caches, then
 * navigate to a cache-busted URL. Falls back to `location.reload()` when the
 * platform APIs are unavailable (tests, exotic webviews).
 */
export async function hardReload(deps: ReloadDeps = {}): Promise<void> {
  const latest = updateState().update?.latestVersion ?? normalizeVersion(APP_VERSION);
  const current = updateState().update?.currentVersion ?? normalizeVersion(APP_VERSION);
  if (!deps.skipConfirm) {
    const ok = confirmAppUpdate(current, latest, deps.confirm);
    if (!ok) return;
  }
  setCloseGuardEnabled(false);
  const nav = deps.navigate ?? ((url: string) => globalThis.location.assign(url));
  setUpdateState((prev) => ({ ...prev, status: 'reloading' }));
  try {
    const sw =
      deps.serviceWorker ??
      (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);
    const regs = await sw?.getRegistrations?.().catch(() => [] as never[]);
    await Promise.all((regs ?? []).map((r) => r.unregister().catch(() => false)));
    const c =
      deps.caches ?? (typeof caches !== 'undefined' ? caches : undefined);
    const keys = await c?.keys?.().catch(() => [] as string[]);
    await Promise.all(
      (keys ?? [])
        .filter((k) => k.startsWith('axis-'))
        .map((k) => c!.delete!(k).catch(() => false)),
    );
  } catch {
    /* best effort — still reload below */
  }
  const href = deps.location?.href ?? globalThis.location.href;
  try {
    nav(buildHardReloadUrl(href, latest));
  } catch {
    globalThis.location.reload();
  }
}

/** Soft reload via an activated waiting worker, else a plain reload. */
export function softReload(activate?: () => boolean | void): void {
  setCloseGuardEnabled(false);
  const fn = activate ?? takeWaitingWorkerActivate() ?? undefined;
  try {
    if (fn) {
      // A `false` return means nothing was waiting anymore (another tab won
      // the race) — fall through to a plain reload instead of waiting for a
      // `controllerchange` that will never fire.
      if (fn() !== false) return;
    }
  } catch {
    /* fall through to plain reload */
  }
  globalThis.location.reload();
}

/**
 * Pending service-worker activation, stored when the SW reports a waiting
 * update while the version poll has not confirmed a new `/version.json` yet.
 * Consumed once by {@link softReload}.
 */
let waitingWorkerActivate: (() => boolean | void) | null = null;

/** Store a waiting-worker activation for the next soft reload. */
export function setWaitingWorkerActivate(fn: (() => boolean | void) | null): void {
  waitingWorkerActivate = fn;
}

/** Take (and clear) the stored waiting-worker activation, if any. */
export function takeWaitingWorkerActivate(): (() => boolean | void) | null {
  const fn = waitingWorkerActivate;
  waitingWorkerActivate = null;
  return fn;
}

export interface PollHandle {
  stop: () => void;
  check: () => Promise<UpdateInfo | null>;
}

export interface StartPollingOptions {
  intervalMs?: number;
  throttleMs?: number;
  fetchImpl?: typeof fetch;
  hooks?: UpdateNotifyHooks;
  /** Window-like event target (default: global `window`). `null` disables listeners. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  timer?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}

/**
 * Start background update polling: immediate check, interval checks, plus
 * throttled checks on focus / visibility / online. Returns `stop()`.
 */
export function startUpdatePolling(opts: StartPollingOptions = {}): PollHandle {
  const intervalMs = opts.intervalMs ?? UPDATE_POLL_MS;
  const throttleMs = opts.throttleMs ?? UPDATE_CHECK_THROTTLE_MS;
  const timer = opts.timer ?? {
    set: (fn: () => void, ms: number) => setInterval(fn, ms),
    clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  const check = () =>
    checkForUpdates({ fetchImpl: opts.fetchImpl, hooks: opts.hooks });
  let lastTrigger = 0;
  const throttled = () => {
    const now = Date.now();
    if (now - lastTrigger < throttleMs) return;
    lastTrigger = now;
    void check();
  };
  const onVisibility = () => {
    try {
      if (document.visibilityState === 'visible') throttled();
    } catch {
      /* ignore */
    }
  };
  const target = opts.target === undefined
    ? (typeof window !== 'undefined' ? window : null)
    : opts.target;
  try {
    target?.addEventListener('focus', throttled);
    target?.addEventListener('online', throttled);
    document?.addEventListener?.('visibilitychange', onVisibility);
  } catch {
    /* non-DOM runtimes */
  }
  const handle = timer.set(() => void check(), intervalMs) as unknown;
  void check();
  return {
    check,
    stop: () => {
      try {
        timer.clear(handle);
        target?.removeEventListener('focus', throttled);
        target?.removeEventListener('online', throttled);
        document?.removeEventListener?.('visibilitychange', onVisibility);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Test helper — reset update state between unit tests. */
export function _resetUpdateManagerForTests(): void {
  setUpdateState(INITIAL_STATE);
  waitingWorkerActivate = null;
}
