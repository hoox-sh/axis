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
 * Library studio messages (`axis.library`). Pure — no vscode import.
 * Cards never include Pine `code`. parseLibraryWebMessage never throws.
 */

import type { BuiltinCatalogEntry } from '../host/builtins';

export type LibraryKind = 'indicator' | 'strategy';

/** Builtin row shipped to the webview. `code` is intentionally absent. */
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

export type LibraryHostToWeb =
  | { type: 'library.init'; cards: LibraryCard[]; catalogError: string }
  | { type: 'library.state'; cards: LibraryCard[]; catalogError: string };

export type LibraryWebToHost =
  | { type: 'library.ready' }
  | { type: 'library.apply'; id: string }
  | { type: 'library.copy'; id: string };

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

function readKind(raw: Record<string, unknown>): LibraryKind {
  try {
    return raw.kind === 'strategy' ? 'strategy' : 'indicator';
  } catch {
    return 'indicator';
  }
}

function readOverlay(raw: Record<string, unknown>): boolean {
  try {
    return raw.overlay === true;
  } catch {
    return false;
  }
}

function readTags(raw: Record<string, unknown>): string[] {
  try {
    const value = raw.tags;
    if (!Array.isArray(value)) return [];
    const tags: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item) tags.push(item);
    }
    return tags;
  } catch {
    return [];
  }
}

function cardFromUnknown(raw: unknown): LibraryCard | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw, 'id').trim();
  if (!id) return null;
  const title = readString(raw, 'title').trim() || id;
  const shorttitle = readString(raw, 'shorttitle').trim() || id;
  return {
    id,
    title,
    shorttitle,
    description: readString(raw, 'description'),
    category: readString(raw, 'category'),
    categoryLabel: readString(raw, 'categoryLabel'),
    kind: readKind(raw),
    overlay: readOverlay(raw),
    covers: readString(raw, 'covers'),
    tags: readTags(raw),
  };
}

/**
 * Strip Pine source (and any other fields) off catalog rows.
 * Never throws — non-arrays and hostile entries become `[]` or are skipped.
 */
export function toLibraryCards(scripts: readonly BuiltinCatalogEntry[]): LibraryCard[] {
  try {
    if (!Array.isArray(scripts)) return [];
    const cards: LibraryCard[] = [];
    for (const raw of scripts) {
      const card = cardFromUnknown(raw);
      if (card) cards.push(card);
    }
    return cards;
  } catch {
    return [];
  }
}

function catalogErrorText(catalogError: unknown): string {
  return typeof catalogError === 'string' ? catalogError : '';
}

/** Host → web snapshot. `library.state` refreshes the same card payload as init. */
export function toLibraryHostMessage(
  type: 'library.init' | 'library.state',
  scripts: readonly BuiltinCatalogEntry[],
  catalogError?: unknown,
): LibraryHostToWeb {
  const cards = toLibraryCards(scripts);
  const error = catalogErrorText(catalogError);
  if (type === 'library.state') {
    return { type: 'library.state', cards, catalogError: error };
  }
  return { type: 'library.init', cards, catalogError: error };
}

function readType(raw: Record<string, unknown>): string {
  try {
    return typeof raw.type === 'string' ? raw.type : '';
  } catch {
    return '';
  }
}

function readId(raw: Record<string, unknown>): string | null {
  try {
    const value = raw.id;
    if (typeof value !== 'string') return null;
    const id = value.trim();
    return id ? id : null;
  } catch {
    return null;
  }
}

/** Decode a webview → host message. Hostile input returns null. Never throws. */
export function parseLibraryWebMessage(raw: unknown): LibraryWebToHost | null {
  if (!isRecord(raw)) return null;
  const type = readType(raw);
  if (type === 'library.ready') return { type: 'library.ready' };
  if (type === 'library.apply' || type === 'library.copy') {
    const id = readId(raw);
    if (!id) return null;
    return { type, id };
  }
  return null;
}
