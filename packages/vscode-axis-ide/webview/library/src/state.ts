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
 * Library studio reducer. Search is client-side over title, shorttitle, id, tags, and category.
 * Pine source is never stored.
 */

export const COPY_FLASH_MS = 1200;

export type LibraryKind = 'indicator' | 'strategy';
export type LibraryKindFilter = 'all' | LibraryKind;

export type LibraryCard = {
  id: string;
  title: string;
  shorttitle: string;
  description: string;
  category: string;
  categoryLabel: string;
  kind: LibraryKind;
  overlay: boolean;
  covers: string;
  tags: readonly string[];
};

export type LibraryViewState = {
  cards: LibraryCard[];
  catalogError: string;
  query: string;
  kind: LibraryKindFilter;
  category: string;
  loaded: boolean;
};

export type CategoryOption = {
  id: string;
  label: string;
  count: number;
};

export type PersistedLibraryUi = {
  query: string;
  kind: LibraryKindFilter;
  category: string;
};

const EMPTY_CARDS: LibraryCard[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(raw: Record<string, unknown>, key: string): string {
  try {
    const value = raw[key];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function isKindFilter(value: unknown): value is LibraryKindFilter {
  return value === 'all' || value === 'indicator' || value === 'strategy';
}

export function initialLibraryState(persisted?: PersistedLibraryUi | null): LibraryViewState {
  return {
    cards: EMPTY_CARDS,
    catalogError: '',
    query: persisted?.query ?? '',
    kind: persisted && isKindFilter(persisted.kind) ? persisted.kind : 'all',
    category: persisted?.category?.trim() ? persisted.category : 'all',
    loaded: false,
  };
}

export function readPersistedLibraryUi(raw: unknown): PersistedLibraryUi | null {
  if (!isRecord(raw)) return null;
  const query = readString(raw, 'query');
  const kindRaw = readString(raw, 'kind');
  const category = readString(raw, 'category').trim() || 'all';
  return {
    query,
    kind: isKindFilter(kindRaw) ? kindRaw : 'all',
    category,
  };
}

function cardFromUnknown(raw: unknown): LibraryCard | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw, 'id').trim();
  if (!id) return null;
  let tags: string[] = [];
  try {
    const value = raw.tags;
    if (Array.isArray(value)) {
      tags = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
  } catch {
    tags = [];
  }
  let kind: LibraryKind = 'indicator';
  try {
    if (raw.kind === 'strategy') kind = 'strategy';
  } catch {
    kind = 'indicator';
  }
  let overlay = false;
  try {
    overlay = raw.overlay === true;
  } catch {
    overlay = false;
  }
  return {
    id,
    title: readString(raw, 'title').trim() || id,
    shorttitle: readString(raw, 'shorttitle').trim() || id,
    description: readString(raw, 'description'),
    category: readString(raw, 'category'),
    categoryLabel: readString(raw, 'categoryLabel'),
    kind,
    overlay,
    covers: readString(raw, 'covers'),
    tags,
  };
}

export function decodeHostMessage(raw: unknown): { cards: LibraryCard[]; catalogError: string } | null {
  if (!isRecord(raw)) return null;
  let type = '';
  try {
    type = typeof raw.type === 'string' ? raw.type : '';
  } catch {
    return null;
  }
  if (type !== 'library.init' && type !== 'library.state') return null;
  let catalogError = '';
  try {
    catalogError = typeof raw.catalogError === 'string' ? raw.catalogError : '';
  } catch {
    catalogError = '';
  }
  const cards: LibraryCard[] = [];
  try {
    const list = raw.cards;
    if (Array.isArray(list)) {
      for (const item of list) {
        const card = cardFromUnknown(item);
        if (card) cards.push(card);
      }
    }
  } catch {
    return { cards: [], catalogError };
  }
  return { cards, catalogError };
}

export function applyCatalog(
  state: LibraryViewState,
  cards: readonly LibraryCard[],
  catalogError: string,
): LibraryViewState {
  return {
    ...state,
    cards: [...cards],
    catalogError,
    loaded: true,
  };
}

export function setSearchQuery(state: LibraryViewState, query: string): LibraryViewState {
  return { ...state, query };
}

export function setKindFilter(state: LibraryViewState, kind: LibraryKindFilter): LibraryViewState {
  return { ...state, kind };
}

export function setCategoryFilter(state: LibraryViewState, category: string): LibraryViewState {
  const next = category.trim() || 'all';
  return { ...state, category: next };
}

export function clearFilters(state: LibraryViewState): LibraryViewState {
  return { ...state, query: '', kind: 'all', category: 'all' };
}

export function matchesQuery(card: LibraryCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    card.title,
    card.shorttitle,
    card.id,
    card.tags.join(' '),
    card.category,
    card.categoryLabel,
  ]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((part) => hay.includes(part));
}

/** Chip id for a card. Empty categories share `other` so the chip matches the filter. */
export function categoryKey(card: LibraryCard): string {
  return card.category.trim() || 'other';
}

function inCategory(card: LibraryCard, category: string): boolean {
  return category === 'all' || categoryKey(card) === category;
}

export function filteredCards(state: LibraryViewState): LibraryCard[] {
  return state.cards.filter((card) => {
    if (state.kind !== 'all' && card.kind !== state.kind) return false;
    if (!inCategory(card, state.category)) return false;
    return matchesQuery(card, state.query);
  });
}

export function formatScriptCount(count: number): string {
  return count === 1 ? '1 script' : `${count} scripts`;
}

export function formatShowing(count: number): string {
  return `showing ${count}`;
}

export function kindCounts(
  state: LibraryViewState,
): { all: number; indicator: number; strategy: number } {
  let all = 0;
  let indicator = 0;
  let strategy = 0;
  for (const card of state.cards) {
    if (!inCategory(card, state.category)) continue;
    if (!matchesQuery(card, state.query)) continue;
    all += 1;
    if (card.kind === 'strategy') strategy += 1;
    else indicator += 1;
  }
  return { all, indicator, strategy };
}

export function categoryOptions(state: LibraryViewState): CategoryOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const card of state.cards) {
    if (state.kind !== 'all' && card.kind !== state.kind) continue;
    if (!matchesQuery(card, state.query)) continue;
    const id = categoryKey(card);
    const label = card.categoryLabel.trim() || card.category.trim() || 'Other';
    const prev = counts.get(id);
    if (prev) prev.count += 1;
    else counts.set(id, { label, count: 1 });
  }
  return [...counts.entries()]
    .map(([id, row]) => ({ id, label: row.label, count: row.count }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function kindLabel(kind: LibraryKind): string {
  return kind === 'strategy' ? 'Strategy' : 'Indicator';
}

export function overlayLabel(overlay: boolean): string {
  return overlay ? 'Overlay' : 'Pane';
}
