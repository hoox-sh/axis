/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXIS debug mode — detailed chart-action and engine logs.
 *
 * Enable with `VITE_AXIS_DEBUG=1` (also `true` / `yes`) in `.env` or the
 * build environment. Alias: `VITE_DEBUG`. Vite inlines the value at build
 * time, so flipping it needs a restart of `bun run dev` / a rebuild.
 *
 * Optional runtime overlay (no rebuild): `localStorage.setItem('axis.debug','1')`
 * then reload. The env flag wins when it is on. Existing process env vars
 * outrank `.env` files (same as the maintenance-mode flag).
 *
 * Logs go to `console.debug` as `[axis:chart]` / `[axis:engine]` so DevTools
 * can filter them, and to a rotating localStorage ring (`axis.debug.log.0`…
 * `.3`, 64 KiB each). Download the ring as a `.log` from System Logs or
 * `window.__AXIS_DEBUG__.download()`. Forming-tick paths are sampled so a
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

export type AxisDebugScope = 'chart' | 'engine';

export type AxisDebugData = Record<string, unknown>;

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
  try {
    if (typeof localStorage === 'undefined') {
      storageMemo = false;
      return false;
    }
    storageMemo = envTruthy(localStorage.getItem(AXIS_DEBUG_STORAGE_KEY));
    return storageMemo;
  } catch {
    storageMemo = false;
    return false;
  }
}

/** True when AXIS debug logging is on (env or `localStorage.axis.debug`). */
export function isAxisDebug(): boolean {
  if (readViteFlag()) return true;
  return readStorageFlag();
}

/** Which switch turned debug on (env wins). */
export function axisDebugSource(): AxisDebugSource {
  if (readViteFlag()) return 'env';
  if (readStorageFlag()) return 'storage';
  return 'off';
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
    };
  } catch {
    /* ignore */
  }
}

/** One-line boot banner. No-op when debug is off. */
export function announceAxisDebug(): void {
  if (!isAxisDebug()) return;
  const source = axisDebugSource();
  installDebugHook();
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
