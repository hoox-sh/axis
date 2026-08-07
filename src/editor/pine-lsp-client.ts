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
 * Pyodide / offline mode falls back to client builtins in `pine-lsp`
 * (and local structural pre-eval in `preevaluate.ts`).
 * Timeouts default to 4s; failures return `null` (caller uses local index).
 *
 * @module editor/pine-lsp-client
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

/**
 * Prefer remote LSP when using server engine with a non-empty Backend URL.
 * Returns false for pyodide (no network LSP).
 */
export function shouldUseRemoteLsp(): boolean {
  const eng = store.engine || store.activePlugins?.engine || '';
  if (eng === 'pyodide') return false;
  const ep = (store.endpoint || '').trim();
  return ep.length > 0 && eng === 'server';
}

/** Strip trailing slash from `store.endpoint` for LSP paths. */
export function lspBaseUrl(): string {
  return (store.endpoint || '').replace(/\/$/, '');
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
}): Promise<RemoteCompletionItem[] | null> {
  const base = lspBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/lsp/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: opts.source,
        line: opts.line,
        character: opts.character,
      }),
      signal: opts.signal ?? AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      items?: RemoteCompletionItem[];
    };
    if (j.status === 'error' || !Array.isArray(j.items)) return null;
    return j.items;
  } catch {
    return null;
  }
}

export async function fetchRemoteHover(opts: {
  source: string;
  line: number;
  character: number;
  signal?: AbortSignal;
}): Promise<RemoteHover | null> {
  const base = lspBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/lsp/hover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: opts.source,
        line: opts.line,
        character: opts.character,
      }),
      signal: opts.signal ?? AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      hover?: RemoteHover | null;
    };
    if (j.status === 'error' || !j.hover) return null;
    return j.hover;
  } catch {
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
}): Promise<RemoteDiagnosticsResult | null> {
  const base = lspBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/lsp/diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: opts.source }),
      signal: opts.signal ?? AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      ok?: boolean;
      diagnostics?: RemoteDiagnostic[];
    };
    if (j.status === 'error' || !Array.isArray(j.diagnostics)) return null;
    return {
      ok: j.ok !== false && !j.diagnostics.some((d) => String(d.severity).toLowerCase() === 'error'),
      diagnostics: j.diagnostics,
    };
  } catch {
    return null;
  }
}
