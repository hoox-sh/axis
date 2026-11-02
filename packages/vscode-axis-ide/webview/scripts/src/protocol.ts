// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Scripts studio webview protocol.
 * Local envelopes only — not axis.webview.v1.
 */

export type ScriptRunStatus = 'ok' | 'error';

export type ScriptRunCard = {
  title: string;
  symbol: string;
  interval: string;
  mode: string;
  status: ScriptRunStatus;
  error: string;
  at: number;
};

export type ScriptSuggestion = {
  id: string;
  title: string;
  kind: string;
  category: string;
};

export type ScriptsViewSnapshot = {
  lastRun: ScriptRunCard | null;
  suggestions: ScriptSuggestion[];
  epoch: number | null;
};

export type ScriptsHostDecode =
  | { type: 'scripts.set'; snapshot: ScriptsViewSnapshot }
  | { type: 'scripts.notice'; text: string };

const SUGGESTION_MAX = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cardFrom(raw: unknown): ScriptRunCard | null {
  if (!isPlainObject(raw)) return null;
  const title = textOf(raw.title);
  if (!title && !textOf(raw.symbol) && !textOf(raw.status)) return null;
  const status: ScriptRunStatus = raw.status === 'error' ? 'error' : 'ok';
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0;
  return {
    title: title || 'Script',
    symbol: textOf(raw.symbol),
    interval: textOf(raw.interval),
    mode: textOf(raw.mode),
    status,
    error: textOf(raw.error),
    at,
  };
}

function suggestionsFrom(raw: unknown): ScriptSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptSuggestion[] = [];
  for (const row of raw) {
    if (out.length >= SUGGESTION_MAX) break;
    if (!isPlainObject(row)) continue;
    const id = textOf(row.id);
    if (!id) continue;
    out.push({
      id,
      title: textOf(row.title) || id,
      kind: textOf(row.kind) || 'indicator',
      category: textOf(row.category),
    });
  }
  return out;
}

function snapshotFrom(raw: unknown): ScriptsViewSnapshot {
  if (!isPlainObject(raw)) {
    return { lastRun: null, suggestions: [], epoch: null };
  }
  const epoch =
    typeof raw.epoch === 'number' && Number.isFinite(raw.epoch) && raw.epoch >= 0
      ? raw.epoch
      : null;
  return {
    lastRun: cardFrom(raw.lastRun),
    suggestions: suggestionsFrom(raw.suggestions),
    epoch,
  };
}

/** Decode host → webview. Never throws. */
export function decodeHostMessage(raw: unknown): ScriptsHostDecode | null {
  try {
    if (!isPlainObject(raw)) return null;
    const type = raw.type;
    if (type === 'scripts.set') {
      const snapshot = isPlainObject(raw.snapshot) ? raw.snapshot : raw;
      return { type: 'scripts.set', snapshot: snapshotFrom(snapshot) };
    }
    if (type === 'scripts.notice') {
      return { type: 'scripts.notice', text: textOf(raw.text) };
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeScriptsReady(): { type: 'scripts.ready' } {
  return { type: 'scripts.ready' };
}

export function encodeScriptsRun(): { type: 'scripts.run' } {
  return { type: 'scripts.run' };
}

export function encodeScriptsOpenChart(): { type: 'scripts.openChart' } {
  return { type: 'scripts.openChart' };
}

export function encodeScriptsApply(id: string): { type: 'scripts.apply'; id: string } {
  return { type: 'scripts.apply', id };
}
