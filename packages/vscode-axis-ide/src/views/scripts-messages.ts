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
 * Scripts studio messages and snapshot shaping.
 * Pure — no vscode. Never throws. Never copies Pine `code`.
 */

/** Command ids confirmed in package.json (do not invent aliases). */
export const SCRIPTS_RUN_COMMAND = 'axis.runScript';
export const SCRIPTS_OPEN_CHART_COMMAND = 'axis.openChart';
export const SCRIPTS_APPLY_BUILTIN_COMMAND = 'axis.applyBuiltin';

export const SCRIPTS_SUGGESTION_MAX = 8;

export const SCRIPTS_EMPTY_RUN =
  'Run a Pine Script™ (Ctrl+Enter)';

export type ScriptRunStatus = 'ok' | 'error';

/** Last-run card. `status` is ok/error (results store `success` maps to ok). */
export type ScriptRunCard = {
  title: string;
  symbol: string;
  interval: string;
  mode: string;
  status: ScriptRunStatus;
  error: string;
  at: number;
};

/** Builtin suggestion row. No Pine source. */
export type ScriptSuggestion = {
  id: string;
  title: string;
  kind: string;
  category: string;
};

export type ScriptsSnapshot = {
  lastRun: ScriptRunCard | null;
  suggestions: ScriptSuggestion[];
  /** Orchestrator epoch when the run record carries one; otherwise null. */
  epoch: number | null;
};

export type ScriptsWebMessage =
  | { type: 'scripts.ready' }
  | { type: 'scripts.run' }
  | { type: 'scripts.openChart' }
  | { type: 'scripts.apply'; id: string };

export type ScriptsHostMessage =
  | { type: 'scripts.set'; snapshot: ScriptsSnapshot }
  | { type: 'scripts.notice'; text: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  try {
    const value = record[key];
    if (typeof value !== 'string') return '';
    return value.trim();
  } catch {
    return '';
  }
}

function readFinite(record: Record<string, unknown>, key: string): number | null {
  try {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function readMeta(record: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const meta = record.meta;
    if (!isPlainObject(meta)) return null;
    return meta;
  } catch {
    return null;
  }
}

function readMetaString(record: Record<string, unknown>, key: string): string {
  const meta = readMeta(record);
  if (!meta) return '';
  return readString(meta, key);
}

/** Unwrap `{ lastRun }` snapshots. A null `lastRun` is not a run record. */
export function unwrapRunRecord(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  try {
    if ('lastRun' in raw) {
      const nested = raw.lastRun;
      if (!isPlainObject(nested)) return null;
      return nested;
    }
  } catch {
    return null;
  }
  return raw;
}

function fromSeriesKey(seriesKey: string): { symbol: string; interval: string } {
  if (!seriesKey) return { symbol: '', interval: '' };
  const parts = seriesKey.split('|');
  if (parts.length >= 4) {
    return { symbol: parts[2].trim(), interval: parts[3].trim() };
  }
  return { symbol: '', interval: '' };
}

function readAt(record: Record<string, unknown>): number {
  const created = readFinite(record, 'createdAt');
  if (created != null && created > 0) return created;
  const at = readFinite(record, 'at');
  if (at != null && at > 0) return at;
  const meta = readMeta(record);
  if (!meta) return 0;
  const metaAt = readFinite(meta, 'at');
  if (metaAt != null && metaAt > 0) return metaAt;
  const metaCreated = readFinite(meta, 'createdAt');
  if (metaCreated != null && metaCreated > 0) return metaCreated;
  return 0;
}

function hasRunSignal(record: Record<string, unknown>): boolean {
  if (readString(record, 'id')) return true;
  if (readString(record, 'title')) return true;
  if (readString(record, 'seriesKey')) return true;
  if (readString(record, 'status')) return true;
  if (readString(record, 'engineId')) return true;
  if (readMetaString(record, 'script_name')) return true;
  if (readMetaString(record, 'title')) return true;
  if (readAt(record) > 0) return true;
  return false;
}

function readStatus(record: Record<string, unknown>, error: string): ScriptRunStatus {
  const status = readString(record, 'status').toLowerCase();
  if (status === 'error' || status === 'err') return 'error';
  if (status === 'success' || status === 'ok') return 'ok';
  if (error) return 'error';
  return 'ok';
}

/** Map a results lastRun (or snapshot) to a card. Null when it is not a run. */
export function scriptRunCardFromLastRun(raw: unknown): ScriptRunCard | null {
  const record = unwrapRunRecord(raw);
  if (!record) return null;
  if (!hasRunSignal(record)) return null;
  const series = fromSeriesKey(readString(record, 'seriesKey'));
  const title =
    readMetaString(record, 'script_name') ||
    readMetaString(record, 'title') ||
    readMetaString(record, 'name') ||
    readString(record, 'title') ||
    readString(record, 'id') ||
    'Script';
  const symbol = readMetaString(record, 'symbol') || series.symbol;
  const interval =
    readMetaString(record, 'interval') ||
    readMetaString(record, 'timeframe') ||
    series.interval;
  const mode =
    readMetaString(record, 'mode') ||
    readString(record, 'mode') ||
    readString(record, 'engineId');
  const error = readString(record, 'error');
  return {
    title,
    symbol,
    interval,
    mode,
    status: readStatus(record, error),
    error,
    at: readAt(record),
  };
}

/** Epoch from the run record or its meta, when present. */
export function readRunEpoch(raw: unknown): number | null {
  const record = unwrapRunRecord(raw);
  if (!record) return null;
  const direct = readFinite(record, 'epoch');
  if (direct != null && direct >= 0) return direct;
  const meta = readMeta(record);
  if (!meta) return null;
  const epoch = readFinite(meta, 'epoch');
  if (epoch != null && epoch >= 0) return epoch;
  const runEpoch = readFinite(meta, 'runEpoch');
  if (runEpoch != null && runEpoch >= 0) return runEpoch;
  return null;
}

/** One catalog row → suggestion. Drops `code` and any other source field. */
export function scriptSuggestionFromEntry(raw: unknown): ScriptSuggestion | null {
  if (!isPlainObject(raw)) return null;
  const id = readString(raw, 'id');
  if (!id) return null;
  const title = readString(raw, 'title') || id;
  const kind = readString(raw, 'kind') || 'indicator';
  const category = readString(raw, 'categoryLabel') || readString(raw, 'category');
  return { id, title, kind, category };
}

function collectSuggestions(raw: unknown): ScriptSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptSuggestion[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (out.length >= SCRIPTS_SUGGESTION_MAX) break;
    const suggestion = scriptSuggestionFromEntry(row);
    if (!suggestion) continue;
    if (seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    out.push(suggestion);
  }
  return out;
}

/** `{ lastRun, suggestions }` → webview snapshot. Caps suggestions at 8. Never throws. */
export function buildScriptsSnapshot(input: unknown): ScriptsSnapshot {
  if (!isPlainObject(input)) return { lastRun: null, suggestions: [], epoch: null };
  let lastRaw: unknown = null;
  try {
    lastRaw = input.lastRun;
  } catch {
    lastRaw = null;
  }
  let suggestionsRaw: unknown = null;
  try {
    suggestionsRaw = input.suggestions;
  } catch {
    suggestionsRaw = null;
  }
  return {
    lastRun: scriptRunCardFromLastRun(lastRaw),
    suggestions: collectSuggestions(suggestionsRaw),
    epoch: readRunEpoch(lastRaw),
  };
}

function readApplyId(raw: Record<string, unknown>): string {
  const top = readString(raw, 'id');
  if (top) return top;
  try {
    const payload = raw.payload;
    if (!isPlainObject(payload)) return '';
    return readString(payload, 'id');
  } catch {
    return '';
  }
}

/** Webview → host. Unknown / hostile payloads return null. Never throws. */
export function parseScriptsWebMessage(raw: unknown): ScriptsWebMessage | null {
  if (!isPlainObject(raw)) return null;
  let type = '';
  try {
    const value = raw.type;
    type = typeof value === 'string' ? value.trim() : '';
  } catch {
    return null;
  }
  if (type === 'scripts.ready') return { type: 'scripts.ready' };
  if (type === 'scripts.run') return { type: 'scripts.run' };
  if (type === 'scripts.openChart') return { type: 'scripts.openChart' };
  if (type === 'scripts.apply') {
    const id = readApplyId(raw);
    if (!id) return null;
    return { type: 'scripts.apply', id };
  }
  return null;
}

/** Host → webview `scripts.set`. */
export function encodeScriptsSet(input: unknown): ScriptsHostMessage {
  return { type: 'scripts.set', snapshot: buildScriptsSnapshot(input) };
}

/** Host → webview aria-live notice. Non-strings become empty text. */
export function encodeScriptsNotice(text: unknown): ScriptsHostMessage {
  const value = typeof text === 'string' ? text.trim() : '';
  return { type: 'scripts.notice', text: value };
}
