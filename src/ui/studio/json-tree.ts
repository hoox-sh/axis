// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers for the studio JSON tree (Results → Raw).
 *
 * @module ui/studio/json-tree
 */

/** Render bucket for a JSON node; `empty` covers `[]`/`{}` so the tree can label them. */
export type JsonKind = 'null' | 'bool' | 'number' | 'string' | 'array' | 'object' | 'empty';

/** First page of array/object children before “show more”. */
export const JSON_PAGE = 32;
/** Expand-all stops walking arrays larger than this. */
export const JSON_EXPAND_MAX = 48;

/**
 * Classify any runtime value for the JSON tree. Arrays/objects with no entries
 * report `empty` (not `array`/`object`) so the UI can render `[]` / `{}`.
 *
 * @param value - Any runtime value, including `undefined`.
 * @returns The {@link JsonKind} bucket used for styling and expandability.
 */
export function jsonKind(value: unknown): JsonKind {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : 'array';
  if (typeof value === 'object') {
    return Object.keys(value as object).length === 0 ? 'empty' : 'object';
  }
  return 'string';
}

/**
 * Whether a node can be expanded (non-empty array or object).
 *
 * @param value - Any runtime value.
 * @returns `true` for non-empty arrays and plain objects.
 */
export function isContainer(value: unknown): boolean {
  const k = jsonKind(value);
  return k === 'array' || k === 'object';
}

/**
 * List a container's children in display order, using array indices as keys so
 * duplicates and holes still render distinctly.
 *
 * @param value - Array or object; primitives yield no entries.
 * @returns `[key, value]` pairs; empty for non-containers.
 */
export function childEntries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((item, i) => [String(i), item]);
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>);
  return [];
}

/**
 * Number of children without materializing them (large series stay cheap).
 *
 * @param value - Array or object; primitives report `0`.
 * @returns Array length or own-key count.
 */
export function childCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value as object).length;
  return 0;
}

/**
 * Render a leaf value as text plus its kind. Strings are JSON-quoted; non-finite
 * numbers and `undefined` are spelled out so they are not mistaken for data.
 * Serialization failures fall back to `String(value)` instead of throwing.
 *
 * @param value - Leaf value to format.
 * @returns Kind bucket and display text.
 */
export function formatPrimitive(value: unknown): { kind: JsonKind; text: string } {
  if (value === null) return { kind: 'null', text: 'null' };
  if (value === undefined) return { kind: 'null', text: 'undefined' };
  if (typeof value === 'boolean') return { kind: 'bool', text: value ? 'true' : 'false' };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { kind: 'number', text: 'NaN' };
    if (!Number.isFinite(value))
      return { kind: 'number', text: value > 0 ? 'Infinity' : '-Infinity' };
    return { kind: 'number', text: String(value) };
  }
  if (typeof value === 'string') return { kind: 'string', text: JSON.stringify(value) };
  if (Array.isArray(value) && value.length === 0) return { kind: 'empty', text: '[]' };
  if (value && typeof value === 'object' && Object.keys(value).length === 0) {
    return { kind: 'empty', text: '{}' };
  }
  try {
    return { kind: 'string', text: JSON.stringify(value) ?? String(value) };
  } catch {
    return { kind: 'string', text: String(value) };
  }
}

/** Collapsed preview: `[500]`, `{6}`, or a primitive. */
export function previewLabel(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.length}]`;
  }
  if (value && typeof value === 'object') {
    const n = Object.keys(value).length;
    if (n === 0) return '{}';
    return `{${n}}`;
  }
  return formatPrimitive(value).text;
}

/**
 * Aggregate counts for the tree footer. Walks the whole value, so it is meant
 * for the current result payload, not for a live 5k-bar series.
 *
 * @param value - Root value to measure.
 * @returns Own-key count, array count, and leaf count.
 */
export function jsonStats(value: unknown): { keys: number; arrays: number; values: number } {
  let keys = 0;
  let arrays = 0;
  let values = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      arrays += 1;
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      for (const child of Object.values(v as Record<string, unknown>)) {
        keys += 1;
        walk(child);
      }
      return;
    }
    values += 1;
  };
  walk(value);
  return { keys, arrays, values };
}

/**
 * Build a stable path key for open-state tracking (`$` root, `$.a.b` children).
 *
 * @param parent - Parent path, `$` for the root.
 * @param key - Child key or array index.
 * @returns The child path used as the expansion key.
 */
export function childPath(parent: string, key: string): string {
  return parent === '$' ? `$.${key}` : `${parent}.${key}`;
}

/** Paths to open for Expand (objects to `maxDepth`; skip huge arrays). */
export function collectOpenPaths(value: unknown, root = '$', maxDepth = 3): string[] {
  const out: string[] = [root];
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth >= maxDepth) return;
    if (Array.isArray(v)) {
      if (v.length === 0 || v.length > JSON_EXPAND_MAX) return;
      out.push(path);
      v.forEach((item, i) => {
        walk(item, childPath(path, String(i)), depth + 1);
      });
      return;
    }
    if (v && typeof v === 'object') {
      out.push(path);
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        walk(child, childPath(path, k), depth + 1);
      }
    }
  };
  walk(value, root, 0);
  return out;
}

/**
 * Case-insensitive key filter. An empty query matches everything so the caller
 * does not special-case "no search".
 *
 * @param key - Object key or array index string.
 * @param query - Raw search text; empty means match.
 * @returns `true` when the key contains the query.
 */
export function keyMatches(key: string, query: string): boolean {
  if (!query) return true;
  return key.toLowerCase().includes(query.toLowerCase());
}

/**
 * Case-insensitive match against a leaf's rendered text. Containers never match
 * here — they match through {@link subtreeMatches} so a parent stays visible.
 *
 * @param value - Leaf value to test.
 * @param query - Raw search text; empty means match.
 * @returns `true` when the formatted leaf text contains the query.
 */
export function primitiveMatches(value: unknown, query: string): boolean {
  if (!query) return true;
  const k = jsonKind(value);
  if (k === 'array' || k === 'object') return false;
  return formatPrimitive(value).text.toLowerCase().includes(query.toLowerCase());
}

/**
 * Whether this node or a descendant should stay visible for `query`.
 * Huge arrays are key-only so a 5k-bar series does not get walked.
 */
export function subtreeMatches(value: unknown, query: string, budget = { n: 400 }): boolean {
  if (!query) return true;
  if (primitiveMatches(value, query)) return true;
  if (budget.n <= 0) return false;
  if (Array.isArray(value)) {
    if (value.length > JSON_EXPAND_MAX) return false;
    for (const item of value) {
      budget.n -= 1;
      if (subtreeMatches(item, query, budget)) return true;
    }
    return false;
  }
  if (value && typeof value === 'object') {
    for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
      budget.n -= 1;
      if (keyMatches(k, query) || subtreeMatches(child, query, budget)) return true;
    }
  }
  return false;
}
