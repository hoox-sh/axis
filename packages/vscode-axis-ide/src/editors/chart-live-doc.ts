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
 * In-memory chart document bus for unsaved custom-editor state.
 * Layers reads text or disk; drawing commits only update the custom document.
 * Pure store — no vscode. Never throws.
 */

const LIVE_KEYS = ['drawings', 'scripts', 'panes', 'overlays', 'onChain'] as const;

type LiveKey = (typeof LIVE_KEYS)[number];

/** Caller-shaped chart fields. Non-arrays are dropped from the snapshot. */
export type ChartLiveDocInput = {
  drawings?: unknown;
  scripts?: unknown;
  panes?: unknown;
  overlays?: unknown;
  onChain?: unknown;
};

/** Stored snapshot. Every present field is an array the caller no longer owns. */
export type ChartLiveDocSnapshot = {
  drawings?: unknown[];
  scripts?: unknown[];
  panes?: unknown[];
  overlays?: unknown[];
  onChain?: unknown[];
};

export type ChartLiveDocListener = (uri: string) => void;

const docs = new Map<string, ChartLiveDocSnapshot>();
const listeners: ChartLiveDocListener[] = [];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

function readField(doc: ChartLiveDocInput, key: LiveKey): unknown {
  try {
    return doc[key];
  } catch {
    return undefined;
  }
}

/** Shallow-copy an array. Non-arrays and hostile arrays are omitted. */
function copyArray(value: unknown): unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) out.push(value[i]);
    return out;
  } catch {
    return undefined;
  }
}

function snapshotOf(doc: ChartLiveDocInput): ChartLiveDocSnapshot {
  const out: ChartLiveDocSnapshot = {};
  for (const key of LIVE_KEYS) {
    const copied = copyArray(readField(doc, key));
    if (copied) out[key] = copied;
  }
  return out;
}

function emit(uri: string): void {
  const current = listeners.slice();
  for (const listener of current) {
    try {
      listener(uri);
    } catch {
      // one listener must not block the rest
    }
  }
}

/**
 * Publish the live chart doc for `uri`.
 * `null` deletes. Same uri replaces. Listeners run after the map updates.
 * Never throws.
 */
export function setChartLiveDoc(uri: string, doc: ChartLiveDocInput | null): void {
  if (typeof uri !== 'string' || uri.length === 0) return;
  if (doc === null) {
    docs.delete(uri);
    emit(uri);
    return;
  }
  if (!isPlainRecord(doc)) {
    docs.set(uri, {});
    emit(uri);
    return;
  }
  docs.set(uri, snapshotOf(doc));
  emit(uri);
}

/** Snapshot for `uri`, or null when nothing is published. Arrays are copies. */
export function getChartLiveDoc(uri: string): ChartLiveDocSnapshot | null {
  if (typeof uri !== 'string' || uri.length === 0) return null;
  const stored = docs.get(uri);
  if (!stored) return null;
  return snapshotOf(stored);
}

/** Delete `uri` and notify listeners. Never throws. */
export function clearChartLiveDoc(uri: string): void {
  setChartLiveDoc(uri, null);
}

/**
 * Subscribe to live-doc publishes. Returns an unsubscribe function.
 * A throwing listener does not prevent later listeners from running.
 * Never throws.
 */
export function subscribeChartLiveDoc(listener: ChartLiveDocListener): () => void {
  if (typeof listener !== 'function') {
    return () => undefined;
  }
  listeners.push(listener);
  let on = true;
  return () => {
    if (!on) return;
    on = false;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

/**
 * Overlay live array fields onto a parsed chart record.
 * Live wins per key when that field is an array. Other parsed keys stay.
 * Null live leaves `parsed` untouched. Both missing → null.
 */
export function mergeChartDoc(
  parsed: Record<string, unknown> | null,
  live: ChartLiveDocInput | null,
): Record<string, unknown> | null {
  const parsedOk = isPlainRecord(parsed);
  if (!isPlainRecord(live)) return parsedOk ? parsed : null;
  const out: Record<string, unknown> = parsedOk ? { ...parsed } : {};
  for (const key of LIVE_KEYS) {
    const copied = copyArray(readField(live, key));
    if (copied) out[key] = copied;
  }
  return out;
}
