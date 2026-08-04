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
 * Opt-in error diagnostic transfer.
 *
 * When {@link AppState.telemetry.shareOnError} is **true** (default **false**),
 * {@link reportUiError} may offer a toast asking the user to copy/download a
 * redacted diagnostic bundle. Never auto-uploads; never includes OHLCV bars,
 * Pine source, or secrets.
 *
 * @module ui/error-share
 */

import {
  store,
  setStore,
  appendLog,
  setStatus,
} from '../store';
import type { LogEntry } from '../store/types';
import { copyToClipboard } from './clipboard';

/** App version stamped into diagnostic bundles (keep in sync with package.json). */
export const AXIS_DIAGNOSTIC_VERSION = '2.0.0';

/** Local coerce — avoid circular import with boot-errors. */
function formatErrorMessage(err: unknown, maxLen = 240): string {
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

export type ErrorShareOffer = {
  id: string;
  /** Short line shown in the toast */
  summary: string;
  /** Ready-to-export JSON object */
  payload: ErrorDiagnosticPayload;
  at: number;
};

export type ErrorDiagnosticPayload = {
  kind: 'axis-error-diagnostic';
  version: string;
  at: string;
  error: {
    message: string;
    name?: string;
    stack?: string;
    source?: string;
    context?: string;
  };
  env: {
    userAgent?: string;
    language?: string;
    href?: string;
    online?: boolean;
  };
  session: {
    symbol?: string;
    interval?: string;
    exchange?: string;
    source?: string;
    engine?: string;
    /** Hostname only — never full URL with credentials */
    endpointHost?: string;
    status?: string;
    statusMessage?: string;
    theme?: string;
    barCount?: number;
    scriptCount?: number;
  };
  planes?: Partial<
    Record<
      string,
      { id?: string; state?: string; transport?: string; error?: string | null }
    >
  >;
  /** Last N system log lines (truncated) */
  recentLogs?: Array<{ level: string; message: string; source?: string; ts: number }>;
};

export type BuildDiagnosticOpts = {
  source?: string;
  context?: string;
  /** Cap for stack string (default 2000). */
  stackMax?: number;
  /** How many recent system logs to include (default 12). */
  logLimit?: number;
};

/** Strip path/query; keep host:port only. */
export function endpointHostOnly(endpoint: string | null | undefined): string | undefined {
  if (!endpoint || typeof endpoint !== 'string') return undefined;
  const raw = endpoint.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return u.host || undefined;
  } catch {
    // Bare host or garbage — take first token before / or ?
    const host = raw.split(/[/?#]/)[0]?.replace(/^https?:\/\//i, '');
    return host || undefined;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function errParts(err: unknown): { message: string; name?: string; stack?: string } {
  const message = formatErrorMessage(err, 400);
  if (err instanceof Error) {
    return {
      message,
      name: err.name || undefined,
      stack: err.stack ? truncate(err.stack, 2000) : undefined,
    };
  }
  return { message };
}

function planeSnap(
  p: { id?: string; state?: string; transport?: string; error?: string | null } | null | undefined,
) {
  if (!p) return undefined;
  return {
    id: p.id,
    state: p.state,
    transport: p.transport,
    error: p.error != null ? truncate(String(p.error), 200) : null,
  };
}

/**
 * Build a redacted diagnostic object from the current store + error.
 * Safe to JSON-serialize; omits bars, scripts, tokens, full endpoint URLs.
 */
export function buildErrorDiagnosticPayload(
  err: unknown,
  opts: BuildDiagnosticOpts = {},
): ErrorDiagnosticPayload {
  const parts = errParts(err);
  const stackMax = opts.stackMax ?? 2000;
  const logLimit = opts.logLimit ?? 12;
  const tel = store.telemetry;
  const logs = (store.logs || []) as LogEntry[];
  const recent = logs.slice(-logLimit).map((l) => ({
    level: String(l.level),
    message: truncate(String(l.message || ''), 200),
    source: l.source,
    ts: l.ts,
  }));

  return {
    kind: 'axis-error-diagnostic',
    version: AXIS_DIAGNOSTIC_VERSION,
    at: new Date().toISOString(),
    error: {
      message: parts.message,
      name: parts.name,
      stack: parts.stack ? truncate(parts.stack, stackMax) : undefined,
      source: opts.source,
      context: opts.context,
    },
    env: {
      userAgent:
        typeof navigator !== 'undefined' ? truncate(navigator.userAgent || '', 240) : undefined,
      language: typeof navigator !== 'undefined' ? navigator.language : undefined,
      href:
        typeof location !== 'undefined'
          ? truncate(String(location.origin || '') + String(location.pathname || ''), 200)
          : undefined,
      online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    },
    session: {
      symbol: store.symbol,
      interval: store.interval,
      exchange: store.exchange,
      source: store.source,
      engine: store.engine,
      endpointHost: endpointHostOnly(store.endpoint),
      status: store.status,
      statusMessage: store.statusMessage
        ? truncate(String(store.statusMessage), 160)
        : undefined,
      theme: store.theme,
      barCount: Array.isArray(store.bars) ? store.bars.length : 0,
      scriptCount: Array.isArray(store.scripts) ? store.scripts.length : 0,
    },
    planes: {
      source: planeSnap(tel?.source),
      stream: planeSnap(tel?.stream),
      engine: planeSnap(tel?.engine),
      storage: planeSnap(tel?.storage),
    },
    recentLogs: recent,
  };
}

/** True when the user opted into error-share prompts (persisted telemetry pref). */
export function isErrorShareEnabled(): boolean {
  return store.telemetry?.shareOnError === true;
}

let lastOfferKey = '';
let lastOfferAt = 0;

/** @internal test helper */
export function _resetErrorShareThrottleForTests(): void {
  lastOfferKey = '';
  lastOfferAt = 0;
  setStore('errorShareOffer', null);
}

/**
 * If telemetry.shareOnError is on, queue a toast offer (throttled).
 * No-op when disabled (default) or when an identical error was offered recently.
 */
export function maybeOfferErrorShare(
  err: unknown,
  opts: BuildDiagnosticOpts & { throttleMs?: number } = {},
): boolean {
  if (!isErrorShareEnabled()) return false;

  const msg = formatErrorMessage(err, 200);
  const key = `${opts.source || ''}|${opts.context || ''}|${msg}`;
  const now = Date.now();
  const throttleMs = opts.throttleMs ?? 15_000;
  if (key === lastOfferKey && now - lastOfferAt < throttleMs) return false;
  // Don't stack offers
  if (store.errorShareOffer) return false;

  lastOfferKey = key;
  lastOfferAt = now;

  const payload = buildErrorDiagnosticPayload(err, opts);
  const summary = opts.context
    ? `${opts.context}: ${msg}`
    : msg;

  const offer: ErrorShareOffer = {
    id: `errshare_${now.toString(36)}`,
    summary: truncate(summary, 120),
    payload,
    at: now,
  };
  setStore('errorShareOffer', offer as never);
  return true;
}

/** Dismiss the current offer without transferring. */
export function dismissErrorShareOffer(): void {
  setStore('errorShareOffer', null);
}

async function copyText(text: string): Promise<boolean> {
  return copyToClipboard(text);
}

function downloadJson(filename: string, text: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Accept the current offer: copy JSON to clipboard and download a file.
 * Clears the offer. Returns true when at least one transfer path worked.
 */
export async function acceptErrorShareOffer(
  offer?: ErrorShareOffer | null,
): Promise<boolean> {
  const o = offer ?? (store.errorShareOffer as ErrorShareOffer | null);
  if (!o?.payload) {
    setStore('errorShareOffer', null);
    return false;
  }
  let text: string;
  try {
    text = JSON.stringify(o.payload, null, 2);
  } catch {
    setStore('errorShareOffer', null);
    return false;
  }
  const copied = await copyText(text);
  try {
    downloadJson(`axis-error-${Date.now()}.json`, text);
  } catch {
    /* download optional */
  }
  setStore('errorShareOffer', null);
  if (copied) {
    appendLog('ok', 'Error diagnostic copied to clipboard + downloaded', 'telemetry');
    setStatus('ready', 'Error diagnostic copied — paste into an issue or support channel');
  } else {
    appendLog('warn', 'Error diagnostic downloaded (clipboard unavailable)', 'telemetry');
    setStatus('ready', 'Error diagnostic downloaded as JSON');
  }
  return true;
}

/**
 * Manually build + offer (or immediately export) a diagnostic for ErrorFallback
 * and similar surfaces. When shareOnError is off, still exports on demand.
 */
export async function exportErrorDiagnosticNow(
  err: unknown,
  opts: BuildDiagnosticOpts = {},
): Promise<boolean> {
  const payload = buildErrorDiagnosticPayload(err, opts);
  let text: string;
  try {
    text = JSON.stringify(payload, null, 2);
  } catch {
    return false;
  }
  const copied = await copyText(text);
  try {
    downloadJson(`axis-error-${Date.now()}.json`, text);
  } catch {
    /* ignore */
  }
  if (copied) {
    appendLog('ok', 'Error diagnostic exported', 'telemetry');
    setStatus('ready', 'Error diagnostic copied + downloaded');
  }
  return copied;
}
