// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers for the Script Library panel: chips, search, sort.
 *
 * @module ui/library/format
 */

import type { ScriptKind } from '../../indicators/script-meta';
import type { ScriptMeta } from '../../plugins/types';

/** Kind chip colors for library cards. */
export function kindChipClass(kind: ScriptKind): string {
  switch (kind) {
    case 'strategy':
      return 'border-accent-2/45 text-accent-2 bg-accent-2/10';
    case 'library':
      return 'border-border text-text-dim bg-bg/50';
    case 'indicator':
      return 'border-accent/45 text-accent bg-accent/10';
    default:
      return 'border-border/50 text-text-faint bg-bg/30';
  }
}

/** Blob/file shas and commit ids — show 7 chars when long enough. */
export function shortRev(rev?: string): string {
  if (!rev) return '';
  return rev.length > 10 ? rev.slice(0, 7) : rev;
}

export type ScriptKindFilter = 'all' | ScriptKind;

export type ScriptSort = 'stored' | 'recent';

export function scriptKindOf(item: ScriptMeta): ScriptKind {
  return (item.scriptKind as ScriptKind) || 'unknown';
}

/** Case-insensitive match on name, description, path, kind, version, and id. */
export function scriptMatchesQuery(item: ScriptMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    item.name,
    item.description,
    item.path,
    item.id,
    item.scriptKind,
    item.pineVersion,
    item.revision,
    item.tags?.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((part) => hay.includes(part));
}

export function filterPersonalScripts(
  items: readonly ScriptMeta[],
  query: string,
  kind: ScriptKindFilter = 'all',
): ScriptMeta[] {
  return items.filter((item) => {
    if (kind !== 'all' && scriptKindOf(item) !== kind) return false;
    return scriptMatchesQuery(item, query);
  });
}

/** `stored` keeps the storage plugin's order. `recent` is newest `updatedAt` first. */
export function sortPersonalScripts(
  items: readonly ScriptMeta[],
  mode: ScriptSort,
): ScriptMeta[] {
  if (mode !== 'recent') return [...items];
  return [...items].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name),
  );
}

export function countScriptsByKind(
  items: readonly ScriptMeta[],
): Record<ScriptKindFilter, number> {
  const counts = {
    all: items.length,
    indicator: 0,
    strategy: 0,
    library: 0,
    unknown: 0,
  } satisfies Record<ScriptKindFilter, number>;
  for (const item of items) {
    const kind = scriptKindOf(item);
    if (kind in counts) counts[kind] += 1;
  }
  return counts;
}

export const SCRIPT_KIND_FILTERS: { id: ScriptKindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'indicator', label: 'IND' },
  { id: 'strategy', label: 'STR' },
  { id: 'library', label: 'LIB' },
];

/** Filters that have at least one script, plus All. Unknown is included only when present. */
export function visibleKindFilters(
  counts: Record<ScriptKindFilter, number>,
): { id: ScriptKindFilter; label: string }[] {
  const filters = [...SCRIPT_KIND_FILTERS];
  if (counts.unknown > 0) filters.push({ id: 'unknown', label: 'Other' });
  return filters.filter((f) => f.id === 'all' || counts[f.id] > 0);
}
