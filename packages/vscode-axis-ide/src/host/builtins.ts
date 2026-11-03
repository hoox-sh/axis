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
 * Offline builtin catalog loader (Q4) — reads VSIX-shipped `media/builtins/catalog.json`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Catalog schema id shipped in media/builtins/catalog.json. */
export const BUILTIN_CATALOG_SCHEMA = 'axis.builtins.v1';

/** Relative path under extensionPath. */
export const BUILTIN_CATALOG_RELATIVE = join('media', 'builtins', 'catalog.json');

export type BuiltinKind = 'indicator' | 'strategy';

/** One offline builtin row (id/title/source enough for QuickPick + apply). */
export interface BuiltinCatalogEntry {
  id: string;
  title: string;
  shorttitle: string;
  description: string;
  category: string;
  categoryLabel: string;
  kind: BuiltinKind;
  overlay: boolean;
  covers: string;
  tags: readonly string[];
  /** Full `//@version=6` Pine body. */
  code: string;
}

export interface BuiltinCatalog {
  schema: typeof BUILTIN_CATALOG_SCHEMA;
  source?: string;
  generatedAt?: string;
  count: number;
  scripts: readonly BuiltinCatalogEntry[];
}

export type CatalogLoadOk = { ok: true; catalog: BuiltinCatalog };
export type CatalogLoadErr = { ok: false; error: string };
export type CatalogLoadResult = CatalogLoadOk | CatalogLoadErr;

export type ReadFileUtf8 = (path: string, encoding: 'utf8') => string;

/** Absolute catalog path inside a packaged / developed extension root. */
export function builtinCatalogPath(extensionPath: string): string {
  return join(String(extensionPath || ''), BUILTIN_CATALOG_RELATIVE);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asBool(v: unknown): boolean {
  return v === true;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function parseEntry(raw: unknown): BuiltinCatalogEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = asString(o.id).trim();
  const code = asString(o.code);
  if (!id || !code) return null;
  const kindRaw = asString(o.kind);
  const kind: BuiltinKind = kindRaw === 'strategy' ? 'strategy' : 'indicator';
  return {
    id,
    title: asString(o.title) || id,
    shorttitle: asString(o.shorttitle) || id,
    description: asString(o.description),
    category: asString(o.category) || 'other',
    categoryLabel: asString(o.categoryLabel) || asString(o.category) || 'Other',
    kind,
    overlay: asBool(o.overlay),
    covers: asString(o.covers),
    tags: asStringArray(o.tags),
    code,
  };
}

/**
 * Parse catalog JSON text. Never throws — hostile / truncated payloads return ok:false.
 */
export function parseBuiltinCatalogJson(text: string): CatalogLoadResult {
  try {
    const raw = JSON.parse(String(text ?? '')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'AXIS builtins catalog must be a JSON object.' };
    }
    const o = raw as Record<string, unknown>;
    if (o.schema !== BUILTIN_CATALOG_SCHEMA) {
      return {
        ok: false,
        error: `AXIS builtins catalog schema must be ${BUILTIN_CATALOG_SCHEMA}.`,
      };
    }
    if (!Array.isArray(o.scripts)) {
      return { ok: false, error: 'AXIS builtins catalog is missing scripts[].' };
    }
    const scripts: BuiltinCatalogEntry[] = [];
    const seen = new Set<string>();
    for (const row of o.scripts) {
      const entry = parseEntry(row);
      if (!entry) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      scripts.push(entry);
    }
    if (scripts.length === 0) {
      return { ok: false, error: 'AXIS builtins catalog has no usable scripts.' };
    }
    return {
      ok: true,
      catalog: {
        schema: BUILTIN_CATALOG_SCHEMA,
        source: asString(o.source) || undefined,
        generatedAt: asString(o.generatedAt) || undefined,
        count: scripts.length,
        scripts,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `AXIS builtins catalog JSON parse failed: ${message}` };
  }
}

/** Read + parse catalog from disk (injectable read for tests). */
export function loadBuiltinCatalogFromFile(
  filePath: string,
  readFile: ReadFileUtf8 = readFileSync,
): CatalogLoadResult {
  try {
    const text = readFile(String(filePath || ''), 'utf8');
    return parseBuiltinCatalogJson(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `AXIS builtins catalog read failed: ${message}` };
  }
}

/** Load from extensionPath/media/builtins/catalog.json. */
export function loadBuiltinCatalog(
  extensionPath: string,
  readFile: ReadFileUtf8 = readFileSync,
): CatalogLoadResult {
  return loadBuiltinCatalogFromFile(builtinCatalogPath(extensionPath), readFile);
}

function haystack(s: BuiltinCatalogEntry): string {
  return `${s.id} ${s.title} ${s.shorttitle} ${s.description} ${s.covers} ${s.tags.join(' ')} ${s.category} ${s.categoryLabel} ${s.kind}`.toLowerCase();
}

/** Case-insensitive multi-token substring filter; empty query → full list copy. */
export function filterBuiltinCatalog(
  scripts: readonly BuiltinCatalogEntry[],
  query: string,
): BuiltinCatalogEntry[] {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [...scripts];
  const parts = q.split(/\s+/).filter(Boolean);
  return scripts.filter((s) => {
    const h = haystack(s);
    return parts.every((p) => h.includes(p));
  });
}

export function getBuiltinById(
  scripts: readonly BuiltinCatalogEntry[],
  id: string,
): BuiltinCatalogEntry | undefined {
  const key = String(id || '');
  return scripts.find((s) => s.id === key);
}
