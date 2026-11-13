/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXIS debug mode — detailed chart-action and engine logs.
 *
 * Two switches, either one turns logging on:
 *
 * - **Debug page → Enable debug logs** (persisted as `localStorage.axis.debug`,
 *   no rebuild, takes effect immediately). `setAxisDebug()` writes it.
 * - `VITE_AXIS_DEBUG=1` (also `true` / `yes`) in `.env` or the build
 *   environment. Alias: `VITE_DEBUG`. Vite inlines the value at build time, so
 *   flipping it needs a restart of `bun run dev` / a rebuild. The env flag wins
 *   when it is on — the UI toggle then shows a locked-on state.
 *
 * Logs go to `console.debug` as `[axis:chart]` / `[axis:engine]` so DevTools
 * can filter them, and to a rotating localStorage ring (`axis.debug.log.0`…
 * `.3`, 64 KiB each). Download the ring as a `.log` from System Logs, Settings,
 * or `window.__AXIS_DEBUG__.download()`. Forming-tick paths are sampled so a
 * live feed cannot freeze the console or blow the quota.
 *
 * @module debug
 */

import {
  AXIS_DEBUG_LOG_PREFIX,
  appendAxisDebugLine,
  axisDebugLogStats,
  clearAxisDebugLog,
  downloadAxisDebugLog,
  formatAxisDebugLine,
  readAxisDebugLog,
} from './debug-log';
import { getItem, setFlag } from './utils/storage';

export {
  AXIS_DEBUG_LOG_FILE_BYTES,
  AXIS_DEBUG_LOG_FILES,
  AXIS_DEBUG_LOG_PREFIX,
  axisDebugLogFilename,
  axisDebugLogStats,
  clearAxisDebugLog,
  downloadAxisDebugLog,
  flushAxisDebugLog,
  readAxisDebugLog,
} from './debug-log';

/** Canonical Vite env key. */
export const AXIS_DEBUG_ENV_KEY = 'VITE_AXIS_DEBUG';

/** Shorter alias accepted by {@link isAxisDebug}. */
export const AXIS_DEBUG_ENV_ALIAS = 'VITE_DEBUG';

/** Optional tab-local overlay (`'1'` / `'true'` / `'yes'`). */
export const AXIS_DEBUG_STORAGE_KEY = 'axis.debug';

/** Forming-tick / live-delta sample interval (ms). */
export const AXIS_DEBUG_TICK_SAMPLE_MS = 1000;

/** Log channel: `chart` actions vs `engine` / live-wire events. */
export type AxisDebugScope = 'chart' | 'engine';

/** Structured payload attached to one debug event (console + rotating log ring). */
export type AxisDebugData = Record<string, unknown>;

/** Which switch turned debug on; `env` outranks `storage`, `off` means neither. */
export type AxisDebugSource = 'env' | 'storage' | 'off';

function envTruthy(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function readViteFlag(): boolean {
  try {
    const env = import.meta.env as Record<string, unknown> | undefined;
    if (!env) return false;
    return envTruthy(env[AXIS_DEBUG_ENV_KEY]) || envTruthy(env[AXIS_DEBUG_ENV_ALIAS]);
  } catch {
    return false;
  }
}

let storageMemo: boolean | null = null;

function readStorageFlag(): boolean {
  if (storageMemo != null) return storageMemo;
  storageMemo = envTruthy(getItem(AXIS_DEBUG_STORAGE_KEY));
  return storageMemo;
}

/** True when AXIS debug logging is on (env or `localStorage.axis.debug`). */
export function isAxisDebug(): boolean {
  if (readViteFlag()) return true;
  return readStorageFlag();
}

/** True when the `.env` flag forces debug on (the UI toggle cannot turn it off). */
export function isAxisDebugEnvForced(): boolean {
  return readViteFlag();
}

/** Which switch turned debug on (env wins). */
export function axisDebugSource(): AxisDebugSource {
  if (readViteFlag()) return 'env';
  if (readStorageFlag()) return 'storage';
  return 'off';
}

type AxisDebugListener = (on: boolean, source: AxisDebugSource) => void;

const debugListeners = new Set<AxisDebugListener>();

/**
 * Subscribe to runtime debug-flag changes (the Settings toggle). Returns an
 * unsubscribe function. Used so the UI can react without re-reading storage.
 */
export function onAxisDebugChange(listener: AxisDebugListener): () => void {
  debugListeners.add(listener);
  return () => {
    debugListeners.delete(listener);
  };
}

function notifyAxisDebugChange(): void {
  const on = isAxisDebug();
  const source = axisDebugSource();
  for (const listener of debugListeners) {
    try {
      listener(on, source);
    } catch {
      /* a broken listener must not break logging */
    }
  }
}

/**
 * Turn runtime debug logging on or off (Settings → Debug logs).
 *
 * Writes `localStorage.axis.debug`. Returns the effective state: when
 * `VITE_AXIS_DEBUG` is on, turning it off here cannot silence logging, so
 * `true` comes back and {@link isAxisDebugEnvForced} stays `true`.
 */
export function setAxisDebug(on: boolean): boolean {
  setFlag(AXIS_DEBUG_STORAGE_KEY, on);
  storageMemo = null;
  const enabled = isAxisDebug();
  if (enabled) announceAxisDebug();
  notifyAxisDebugChange();
  return enabled;
}

/** Flip the runtime flag and return the effective state (env can force it on). */
export function toggleAxisDebug(): boolean {
  return setAxisDebug(!readStorageFlag());
}

const lastSample = new Map<string, number>();

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function wallNow(): number {
  return Date.now();
}

function emit(scope: AxisDebugScope, event: string, data?: AxisDebugData): void {
  try {
    const prefix = `[axis:${scope}] ${event}`;
    if (data && Object.keys(data).length) console.debug(prefix, data);
    else console.debug(prefix);
  } catch {
    /* logging must never throw */
  }
  try {
    appendAxisDebugLine(formatAxisDebugLine(scope, event, data, wallNow()));
  } catch {
    /* persist must never throw */
  }
}

/** Log one chart or engine event. No-op when debug is off. */
export function axisDebug(scope: AxisDebugScope, event: string, data?: AxisDebugData): void {
  if (!isAxisDebug()) return;
  emit(scope, event, data);
}

/**
 * Log at most once per `everyMs` for this scope+event (+ optional key).
 * Use on forming ticks and live deltas.
 */
export function axisDebugSample(
  scope: AxisDebugScope,
  event: string,
  data: AxisDebugData | undefined,
  everyMs: number,
  key?: string,
): void {
  if (!isAxisDebug()) return;
  const stampKey = `${scope}:${event}:${key ?? ''}`;
  const t = nowMs();
  const last = lastSample.get(stampKey);
  if (last != null && t - last < everyMs) return;
  lastSample.set(stampKey, t);
  emit(scope, event, data);
}

/** Chart-action log (`[axis:chart]`). */
export function chartDebug(event: string, data?: AxisDebugData): void {
  axisDebug('chart', event, data);
}

/** Chart-action log, sampled. */
export function chartDebugSample(
  event: string,
  data: AxisDebugData | undefined,
  everyMs: number = AXIS_DEBUG_TICK_SAMPLE_MS,
  key?: string,
): void {
  axisDebugSample('chart', event, data, everyMs, key);
}

/** Chart-engine / live-wire log (`[axis:engine]`). */
export function engineDebug(event: string, data?: AxisDebugData): void {
  axisDebug('engine', event, data);
}

/** Engine log, sampled. */
export function engineDebugSample(
  event: string,
  data: AxisDebugData | undefined,
  everyMs: number = AXIS_DEBUG_TICK_SAMPLE_MS,
  key?: string,
): void {
  axisDebugSample('engine', event, data, everyMs, key);
}

/**
 * Strip query/hash from a WebSocket URL so `api_key` never reaches the
 * console. Returns `'(ws)'` when the string is not a URL.
 */
export function axisDebugSafeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '(ws)';
  }
}

type AxisDebugHook = {
  read: typeof readAxisDebugLog;
  clear: typeof clearAxisDebugLog;
  download: typeof downloadAxisDebugLog;
  stats: typeof axisDebugLogStats;
  /** Effective state (env or the Settings toggle). */
  enabled: () => boolean;
  /** Same as the Settings toggle — `__AXIS_DEBUG__.set(true)`. */
  set: (on: boolean) => boolean;
};

declare global {
  interface Window {
    __AXIS_DEBUG__?: AxisDebugHook;
  }
}

function installDebugHook(): void {
  try {
    if (typeof window === 'undefined') return;
    window.__AXIS_DEBUG__ = {
      read: readAxisDebugLog,
      clear: clearAxisDebugLog,
      download: downloadAxisDebugLog,
      stats: axisDebugLogStats,
      enabled: isAxisDebug,
      set: setAxisDebug,
    };
  } catch {
    /* ignore */
  }
}

/** Install `window.__AXIS_DEBUG__` and, when debug is on, print the boot banner. */
export function announceAxisDebug(): void {
  installDebugHook();
  if (!isAxisDebug()) return;
  const source = axisDebugSource();
  try {
    console.info(
      `[axis:debug] chart/engine logging on (${source}) — console [axis: + rotating localStorage ${AXIS_DEBUG_LOG_PREFIX}*`,
    );
  } catch {
    /* never throw from boot */
  }
}

/** Tests only — clear sample timestamps, storage-flag memo, and the log ring. */
export function resetAxisDebugSamples(): void {
  lastSample.clear();
  storageMemo = null;
  try {
    clearAxisDebugLog();
  } catch {
    /* ignore */
  }
}
