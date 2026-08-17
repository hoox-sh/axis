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
 * HTTP client for the **pyne Pro API LSP bridge**.
 *
 * Endpoints (relative to `store.endpoint`):
 * - `POST /lsp/completion` — `{ source, line, character }` → completion items
 * - `POST /lsp/hover` — same position → markdown/plaintext hover
 * - `POST /lsp/diagnostics` — `{ source }` → parse+lint pre-eval diagnostics
 *
 * Used when engine is `server` and Backend URL is set (local `:5002` or remote).
 * Pyodide / offline mode falls back to client builtins in `pyne-lsp`
 * (and local structural pre-eval in `preevaluate.ts`).
 * Timeouts default to 4s; failures return `null` (caller uses local index).
 *
 * @module editor/pyne-lsp-client
 */

import { store } from '../store';

/** One completion item from Pro API `/lsp/completion`. */
export type RemoteCompletionItem = {
  label: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: 'snippet' | 'plaintext' | string;
  kind?: string;
};

/** Hover payload from Pro API `/lsp/hover`. */
export type RemoteHover = {
  contents: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
};

/** Default budget for remote LSP before local fallback (hover must stay snappy). */
export const LSP_HOVER_TIMEOUT_MS = 700;
/** Slightly longer for completion (user is waiting on a popup intentionally). */
export const LSP_COMPLETION_TIMEOUT_MS = 1_200;
/** Skip remote after network failure (ms) so hover is not blocked for 4s repeatedly. */
export const LSP_COOLDOWN_MS = 30_000;

let remoteCooldownUntil = 0;

/** True while we recently saw a network/HTTP failure against the Pro API. */
export function isRemoteLspCoolingDown(now = Date.now()): boolean {
  return now < remoteCooldownUntil;
}

/** Mark remote LSP unavailable for a short cooldown (local builtins take over). */
export function markRemoteLspFailed(ms: number = LSP_COOLDOWN_MS): void {
  remoteCooldownUntil = Date.now() + Math.max(0, ms);
}

/** Clear cooldown after a successful remote response. */
export function markRemoteLspOk(): void {
  remoteCooldownUntil = 0;
}

/** Test helper — reset cooldown state between cases. */
export function _resetRemoteLspCooldownForTests(): void {
  remoteCooldownUntil = 0;
}

/**
 * Prefer remote LSP when using server engine with a non-empty Backend URL.
 * Returns false for pyodide (no network LSP) and during post-failure cooldown.
 */
export function shouldUseRemoteLsp(): boolean {
  if (isRemoteLspCoolingDown()) return false;
  const eng = store.engine || store.activePlugins?.engine || '';
  if (eng === 'pyodide') return false;
  // Worker / edge engines may also expose /lsp/* when pointed at a Pro API host
  if (eng && eng !== 'server' && eng !== 'worker') return false;
  const ep = (store.endpoint || '').trim();
  return ep.length > 0;
}

/** Strip trailing slash from `store.endpoint` for LSP paths. */
export function lspBaseUrl(): string {
  return (store.endpoint || '').replace(/\/$/, '');
}

/**
 * True when a failed remote LSP fetch should start the 30s cooldown.
 * Caller abort (user typed / hover left / pre-eval cancelled) must not
 * disable `/lsp/diagnostics` for the next idle check.
 */
export function shouldMarkRemoteLspFailed(callerSignal?: AbortSignal): boolean {
  return !callerSignal?.aborted;
}

function mergeAbortSignals(
  a?: AbortSignal,
  b?: AbortSignal,
): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (a && !b) return a;
  if (b && !a) return b;
  // Both — abort when either fires
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (a!.aborted || b!.aborted) {
    ctrl.abort();
    return ctrl.signal;
  }
  a!.addEventListener('abort', onAbort, { once: true });
  b!.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}

/**
 * Fetch completions from pyne. Returns `null` on network/HTTP/schema failure.
 * Line/character are 0-based (CodeMirror / LSP convention).
 */
export async function fetchRemoteCompletion(opts: {
  source: string;
  line: number;
  character: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RemoteCompletionItem[] | null> {
  const base = lspBaseUrl();
  if (!base) return null;
  const timeoutMs = opts.timeoutMs ?? LSP_COMPLETION_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = mergeAbortSignals(opts.signal, timeoutSignal);
  try {
    const res = await fetch(`${base}/lsp/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: opts.source,
        line: opts.line,
        character: opts.character,
      }),
      signal,
    });
    if (!res.ok) {
      // 404/501 = host has no LSP bridge — cool down
      if (res.status === 404 || res.status === 501 || res.status >= 500) {
        markRemoteLspFailed();
      }
      return null;
    }
    const j = (await res.json()) as {
      status?: string;
      items?: RemoteCompletionItem[];
    };
    if (j.status === 'error' || !Array.isArray(j.items)) return null;
    markRemoteLspOk();
    return j.items;
  } catch {
    if (shouldMarkRemoteLspFailed(opts.signal)) markRemoteLspFailed();
    return null;
  }
}

export async function fetchRemoteHover(opts: {
  source: string;
  line: number;
  character: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RemoteHover | null> {
  const base = lspBaseUrl();
  if (!base) return null;
  const timeoutMs = opts.timeoutMs ?? LSP_HOVER_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = mergeAbortSignals(opts.signal, timeoutSignal);
  try {
    const res = await fetch(`${base}/lsp/hover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: opts.source,
        line: opts.line,
        character: opts.character,
      }),
      signal,
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 501 || res.status >= 500) {
        markRemoteLspFailed();
      }
      return null;
    }
    const j = (await res.json()) as {
      status?: string;
      hover?: RemoteHover | null;
    };
    if (j.status === 'error' || !j.hover) return null;
    markRemoteLspOk();
    return j.hover;
  } catch {
    if (shouldMarkRemoteLspFailed(opts.signal)) markRemoteLspFailed();
    return null;
  }
}

/** One diagnostic from Pro API `/lsp/diagnostics` (preevaluate). */
export type RemoteDiagnostic = {
  /** 1-based line */
  line: number;
  /** 0-based start column */
  character?: number;
  endLine?: number;
  endCharacter?: number;
  message: string;
  severity?: string;
  code?: string;
  source?: string;
};

/** Result of remote parse+lint pre-eval (null on network/HTTP failure). */
export type RemoteDiagnosticsResult = {
  ok: boolean;
  diagnostics: RemoteDiagnostic[];
};

/**
 * Fetch parse+lint diagnostics from pyne Pro API.
 * Used for as-you-type pre-eval (mark wrong code / gate Run).
 * Returns `null` on network/HTTP/schema failure so callers can fall back.
 */
export async function fetchRemoteDiagnostics(opts: {
  source: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RemoteDiagnosticsResult | null> {
  const base = lspBaseUrl();
  if (!base) return null;
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const signal = mergeAbortSignals(opts.signal, AbortSignal.timeout(timeoutMs));
  try {
    const res = await fetch(`${base}/lsp/diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: opts.source }),
      signal,
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 501 || res.status >= 500) {
        markRemoteLspFailed();
      }
      return null;
    }
    const j = (await res.json()) as {
      status?: string;
      ok?: boolean;
      diagnostics?: RemoteDiagnostic[];
    };
    if (j.status === 'error' || !Array.isArray(j.diagnostics)) return null;
    markRemoteLspOk();
    return {
      ok: j.ok !== false && !j.diagnostics.some((d) => String(d.severity).toLowerCase() === 'error'),
      diagnostics: j.diagnostics,
    };
  } catch {
    if (shouldMarkRemoteLspFailed(opts.signal)) markRemoteLspFailed();
    return null;
  }
}
