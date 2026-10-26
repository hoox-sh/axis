/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Rotating localStorage log for AXIS debug mode.
 *
 * The PWA cannot write an arbitrary file on disk. This store keeps a small
 * ring of text files in `localStorage` (`axis.debug.log.0` is the current
 * file, `.1` the previous rotation, …) and can export them as one `.log`
 * download. When the current file exceeds {@link AXIS_DEBUG_LOG_FILE_BYTES},
 * it rotates: oldest file is dropped.
 *
 * Writes are coalesced ({@link AXIS_DEBUG_LOG_FLUSH_MS}) so a live tick
 * burst does not hit storage once per line. Quota failures drop the oldest
 * file and retry once.
 *
 * @module debug-log
 */

import { getItem, removeItem, setItem } from './utils/storage';

/** localStorage key prefix. Files are `${prefix}${i}`. */
export const AXIS_DEBUG_LOG_PREFIX = 'axis.debug.log.';

/** Number of rotated files (current + previous). */
export const AXIS_DEBUG_LOG_FILES = 4;

/** Max UTF-16 length of one file before rotation (~64 KiB). */
export const AXIS_DEBUG_LOG_FILE_BYTES = 64 * 1024;

/** Coalesce storage writes. */
export const AXIS_DEBUG_LOG_FLUSH_MS = 250;

/** Cap on the JSON payload of one line. */
export const AXIS_DEBUG_LOG_LINE_DATA = 2048;

export type RotatingLogStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): boolean;
  removeItem(key: string): void;
};

export type RotatingLogOptions = {
  fileCount: number;
  fileBytes: number;
  prefix: string;
  storage: RotatingLogStorage;
  flushMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
};

export type AxisDebugLogStats = {
  files: number;
  bytes: number;
  lines: number;
};

const defaultStorage: RotatingLogStorage = {
  getItem,
  setItem,
  removeItem,
};

function defaultSchedule(fn: () => void, ms: number): unknown {
  return setTimeout(fn, ms);
}

function defaultCancel(id: unknown): void {
  clearTimeout(id as ReturnType<typeof setTimeout>);
}

/** One rotating NDJSON-ish text log over a key/value store. */
export class RotatingLogStore {
  private current = '';
  private hydrated = false;
  private timer: unknown = null;
  private readonly fileCount: number;
  private readonly fileBytes: number;
  private readonly prefix: string;
  private readonly storage: RotatingLogStorage;
  private readonly flushMs: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (id: unknown) => void;

  constructor(opts: RotatingLogOptions) {
    this.fileCount = Math.max(1, opts.fileCount);
    this.fileBytes = Math.max(1, opts.fileBytes);
    this.prefix = opts.prefix;
    this.storage = opts.storage;
    this.flushMs = opts.flushMs ?? AXIS_DEBUG_LOG_FLUSH_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.cancel = opts.cancel ?? defaultCancel;
  }

  private key(i: number): string {
    return `${this.prefix}${i}`;
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    this.current = this.storage.getItem(this.key(0)) ?? '';
  }

  private writeFile(i: number, value: string): void {
    const k = this.key(i);
    if (this.storage.setItem(k, value)) return;
    this.storage.removeItem(this.key(this.fileCount - 1));
    this.storage.setItem(k, value);
  }

  /** Persist the in-memory current file now. */
  flush(): void {
    this.hydrate();
    if (this.timer != null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.writeFile(0, this.current);
  }

  private scheduleFlush(): void {
    if (this.timer != null) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, this.flushMs);
  }

  /** Shift current → file 1, drop the oldest, start an empty current. */
  rotate(): void {
    this.hydrate();
    this.writeFile(0, this.current);
    for (let i = this.fileCount - 2; i >= 0; i--) {
      this.writeFile(i + 1, this.storage.getItem(this.key(i)) ?? '');
    }
    this.current = '';
    this.writeFile(0, '');
  }

  /** Append one already-terminated line (should end with `\n`). */
  append(line: string): void {
    this.hydrate();
    let next = line;
    if (!next.endsWith('\n')) next += '\n';
    if (next.length > this.fileBytes) {
      next = `${next.slice(0, Math.max(0, this.fileBytes - 2))}…\n`;
    }
    if (this.current.length + next.length > this.fileBytes && this.current.length > 0) {
      this.rotate();
    }
    this.current += next;
    this.scheduleFlush();
  }

  /** Oldest rotation first, then the current file (including unflushed lines). */
  readAll(): string {
    this.hydrate();
    let out = '';
    for (let i = this.fileCount - 1; i >= 1; i--) {
      out += this.storage.getItem(this.key(i)) ?? '';
    }
    out += this.current;
    return out;
  }

  stats(): AxisDebugLogStats {
    this.hydrate();
    let bytes = this.current.length;
    let files = this.current.length ? 1 : 0;
    for (let i = 1; i < this.fileCount; i++) {
      const v = this.storage.getItem(this.key(i)) ?? '';
      if (!v) continue;
      files += 1;
      bytes += v.length;
    }
    const text = this.readAll();
    const lines = text ? text.split('\n').filter((l) => l.length > 0).length : 0;
    return { files, bytes, lines };
  }

  clear(): void {
    if (this.timer != null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.current = '';
    this.hydrated = true;
    for (let i = 0; i < this.fileCount; i++) this.storage.removeItem(this.key(i));
  }
}

let singleton: RotatingLogStore | null = null;

let flushOnHideInstalled = false;

function installFlushOnHide(): void {
  if (flushOnHideInstalled) return;
  flushOnHideInstalled = true;
  try {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) singleton?.flush();
      });
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => singleton?.flush());
    }
  } catch {
    /* ignore */
  }
}

function defaultStore(): RotatingLogStore {
  if (!singleton) {
    singleton = new RotatingLogStore({
      fileCount: AXIS_DEBUG_LOG_FILES,
      fileBytes: AXIS_DEBUG_LOG_FILE_BYTES,
      prefix: AXIS_DEBUG_LOG_PREFIX,
      storage: defaultStorage,
    });
    installFlushOnHide();
  }
  return singleton;
}

/** Tests / boot — replace the singleton (pass `null` to drop it). */
export function setAxisDebugLogStore(store: RotatingLogStore | null): void {
  singleton = store;
}

export function getAxisDebugLogStore(): RotatingLogStore {
  return defaultStore();
}

/** Format one debug event as a log line (always newline-terminated). */
export function formatAxisDebugLine(
  scope: string,
  event: string,
  data: Record<string, unknown> | undefined,
  ts: number,
): string {
  const iso = new Date(ts).toISOString();
  let extra = '';
  if (data && Object.keys(data).length) {
    try {
      extra = ` ${JSON.stringify(data)}`;
      if (extra.length > AXIS_DEBUG_LOG_LINE_DATA) {
        extra = `${extra.slice(0, AXIS_DEBUG_LOG_LINE_DATA)}…`;
      }
    } catch {
      extra = '';
    }
  }
  return `${iso} [${scope}] ${event}${extra}\n`;
}

export function axisDebugLogFilename(now: number = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `axis-debug-${stamp}.log`;
}

export function readAxisDebugLog(): string {
  return defaultStore().readAll();
}

export function flushAxisDebugLog(): void {
  defaultStore().flush();
}

export function clearAxisDebugLog(): void {
  defaultStore().clear();
}

export function axisDebugLogStats(): AxisDebugLogStats {
  return defaultStore().stats();
}

export function appendAxisDebugLine(line: string): void {
  defaultStore().append(line);
}

/**
 * Trigger a `.log` download of the rotated files. Returns false when there
 * is nothing to write or the browser cannot start a download.
 */
export function downloadAxisDebugLog(): boolean {
  flushAxisDebugLog();
  const text = readAxisDebugLog();
  if (!text) return false;
  try {
    if (typeof document === 'undefined') return false;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = axisDebugLogFilename();
    a.rel = 'noopener';
    a.click();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 1000);
    return true;
  } catch {
    return false;
  }
}
