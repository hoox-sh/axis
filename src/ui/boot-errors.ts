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
 * Boot / global error reporting helpers.
 *
 * - {@link formatErrorMessage} — safe string from unknown throwables
 * - {@link installBootErrorHandlers} — window `error` + `unhandledrejection`
 * - {@link reportUiError} — throttle-friendly log + optional status bar
 *
 * @module ui/boot-errors
 */

import { appendLog, setStatus } from '../store';

/** Coerce any thrown value to a short user-facing string. */
export function formatErrorMessage(err: unknown, maxLen = 240): string {
  let raw: string;
  if (err instanceof Error) {
    raw = err.message || err.name || 'Error';
  } else if (typeof err === 'string') {
    raw = err;
  } else if (err == null) {
    raw = 'Unknown error';
  } else {
    try {
      raw = String(err);
    } catch {
      raw = 'Unknown error';
    }
  }
  const cleaned = raw.replace(/\s+/g, ' ').trim() || 'Unknown error';
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1))}…`;
}

let lastReportAt = 0;
let lastReportKey = '';

export type ReportUiErrorOpts = {
  /** Log source tag (default `system`). */
  source?: string;
  /** When true (default), also push status bar `error`. */
  status?: boolean;
  /** Throttle window ms for identical messages (default 2000). */
  throttleMs?: number;
  /** Prefix for log/status message. */
  context?: string;
};

/**
 * Log a UI / chart error without throwing. Throttles duplicate messages so
 * live ticks cannot flood the system log or status bar.
 */
export function reportUiError(err: unknown, opts: ReportUiErrorOpts = {}): void {
  const msg = formatErrorMessage(err);
  const context = opts.context?.trim() || '';
  const line = context ? `${context}: ${msg}` : msg;
  const source = opts.source || 'system';
  const throttleMs = opts.throttleMs ?? 2000;
  const key = `${source}|${line}`;
  const now = Date.now();
  if (key === lastReportKey && now - lastReportAt < throttleMs) {
    if (typeof console !== 'undefined' && console.error) {
      console.error(`[axis] ${line}`, err);
    }
    return;
  }
  lastReportKey = key;
  lastReportAt = now;

  if (typeof console !== 'undefined' && console.error) {
    console.error(`[axis] ${line}`, err);
  }
  appendLog('error', line, source);
  if (opts.status !== false) {
    setStatus('error', line.length > 140 ? `${line.slice(0, 137)}…` : line);
  }
}

/** @internal test helper — reset throttle state between cases. */
export function _resetReportThrottleForTests(): void {
  lastReportAt = 0;
  lastReportKey = '';
}

let installed = false;
let removeHandlers: (() => void) | null = null;

/**
 * Install once-per-page handlers for uncaught errors and promise rejections.
 * Surfaces them in system logs + status bar so the shell is not a silent
 * white screen after a failed boot path.
 *
 * Safe to call multiple times (no-op after first install).
 * @returns disposer that removes listeners (tests / HMR).
 */
export function installBootErrorHandlers(): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  if (installed && removeHandlers) return removeHandlers;

  const onError = (ev: ErrorEvent) => {
    // Resource load errors (img/script) have no useful message — skip noise
    if (ev.message === 'Script error.' && !ev.filename) return;
    const err = ev.error ?? ev.message ?? 'Window error';
    reportUiError(err, {
      source: 'boot',
      context: 'Uncaught error',
      status: true,
      throttleMs: 1500,
    });
  };

  const onRejection = (ev: PromiseRejectionEvent) => {
    reportUiError(ev.reason, {
      source: 'boot',
      context: 'Unhandled rejection',
      status: true,
      throttleMs: 1500,
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  installed = true;

  removeHandlers = () => {
    window.removeEventListener?.('error', onError);
    window.removeEventListener?.('unhandledrejection', onRejection);
    installed = false;
    removeHandlers = null;
  };
  return removeHandlers;
}
