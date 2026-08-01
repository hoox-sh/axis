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
 * Drawing templates — save / load analysis packs (named drawing sets).
 *
 * Pure serialize/deserialize helpers plus localStorage I/O under
 * {@link DRAWING_TEMPLATES_KEY}. Drawings are stored in a points-based portable
 * shape and rehydrated via {@link normalizeDrawing} so the live layer still gets
 * dual legacy fields (`p1`/`p2`/`price`/`color`).
 *
 * Does **not** mount UI or touch the chart layer — callers wire store + layer.
 */

import {
  attachLegacyFields,
  normalizeDrawing,
  normalizeUserDrawings,
  type Drawing as NormalizedDrawing,
  type DrawingStyle,
  type DrawingMeta,
} from './normalize';

// ── Constants ───────────────────────────────────────────────────────────────

/** localStorage key for the templates catalog. */
export const DRAWING_TEMPLATES_KEY = 'axis.drawingTemplates.v1';

/** Discriminator for single-template export files. */
export const TEMPLATE_FORMAT = 'axis.drawingTemplate' as const;

/** Catalog / template schema version. */
export const TEMPLATE_VERSION = 1 as const;

// ── Types ───────────────────────────────────────────────────────────────────

/** Optional chart context captured when a template is saved. */
export interface DrawingTemplateMeta {
  symbol?: string;
  interval?: string;
  exchange?: string;
}

/**
 * Portable points-based drawing shape used in template JSON.
 * Geometry always in `points`; style/meta optional with defaults applied on load.
 */
export interface SerializedDrawing {
  id: string;
  kind: string;
  points: Array<{ time: number; price: number }>;
  style?: Partial<DrawingStyle> & Record<string, unknown>;
  meta?: DrawingMeta;
  visible?: boolean;
  zIndex?: number;
}

/** One named analysis pack. */
export interface DrawingTemplate {
  id: string;
  name: string;
  /** Unix ms when first created. */
  createdAt: number;
  /** Unix ms of last overwrite. */
  updatedAt: number;
  /** Optional symbol / interval context (informational). */
  meta?: DrawingTemplateMeta;
  drawings: SerializedDrawing[];
}

/** Full localStorage payload. */
export interface DrawingTemplatesStore {
  version: typeof TEMPLATE_VERSION;
  templates: DrawingTemplate[];
}

/** Lightweight list row (no drawings payload). */
export interface DrawingTemplateSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  drawingCount: number;
  meta?: DrawingTemplateMeta;
}

/** How to apply a template onto the current drawing list. */
export type LoadTemplateMode = 'replace' | 'merge';

/** Single-file export envelope. */
export interface DrawingTemplateExport {
  format: typeof TEMPLATE_FORMAT;
  version: typeof TEMPLATE_VERSION;
  template: DrawingTemplate;
}

/** Multi-template export envelope. */
export interface DrawingTemplatesExport {
  format: 'axis.drawingTemplates';
  version: typeof TEMPLATE_VERSION;
  templates: DrawingTemplate[];
}

// ── Internals ───────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function genId(prefix = 'tpl'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

// ── Pure serialize / deserialize ────────────────────────────────────────────

/**
 * Convert one raw / dual-shape drawing into a portable {@link SerializedDrawing}.
 * Returns null if the drawing cannot be normalized.
 */
export function serializeDrawing(raw: unknown): SerializedDrawing | null {
  const d = normalizeDrawing(raw);
  if (!d) return null;

  const out: SerializedDrawing = {
    id: d.id,
    kind: d.kind,
    points: d.points.map((p) => ({ time: p.time, price: p.price })),
  };

  if (d.style) {
    out.style = { ...d.style };
  }
  if (d.meta && Object.keys(d.meta).length > 0) {
    out.meta = { ...d.meta };
  }

  // Preserve optional extras from the input object when present.
  if (isRecord(raw)) {
    if (typeof raw.visible === 'boolean') out.visible = raw.visible;
    const z = asFiniteNumber(raw.zIndex);
    if (z != null) out.zIndex = z;
  }

  return out;
}

/**
 * Serialize a drawings array. Invalid entries are dropped.
 * Pure — does not touch storage or the store.
 */
export function serializeDrawings(drawings: unknown): SerializedDrawing[] {
  if (!Array.isArray(drawings)) return [];
  const out: SerializedDrawing[] = [];
  for (const item of drawings) {
    const s = serializeDrawing(item);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Rehydrate one serialized (or dual-shape) drawing for the live store/layer.
 * Applies normalize + legacy field attach; re-applies visible/zIndex when set.
 */
export function deserializeDrawing(raw: unknown): NormalizedDrawing | null {
  const d = normalizeDrawing(raw);
  if (!d) return null;

  if (isRecord(raw)) {
    const any = d as NormalizedDrawing & Record<string, unknown>;
    if (typeof raw.visible === 'boolean') any.visible = raw.visible;
    const z = asFiniteNumber(raw.zIndex);
    if (z != null) any.zIndex = z;
  }

  return attachLegacyFields(d);
}

/**
 * Rehydrate a drawings array. Non-arrays → []. Invalid entries dropped.
 * Pure — equivalent to {@link normalizeUserDrawings} plus visible/zIndex passthrough.
 */
export function deserializeDrawings(raw: unknown): NormalizedDrawing[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedDrawing[] = [];
  for (const item of raw) {
    const d = deserializeDrawing(item);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Normalize drawings for store use (alias of deserialize for callers that
 * already hold template payload drawings).
 */
export function hydrateTemplateDrawings(
  drawings: SerializedDrawing[] | unknown,
): NormalizedDrawing[] {
  return deserializeDrawings(drawings);
}

// ── Template parse / create ─────────────────────────────────────────────────

/** Parse optional symbol/interval meta from unknown. */
export function parseTemplateMeta(raw: unknown): DrawingTemplateMeta | undefined {
  if (!isRecord(raw)) return undefined;
  const meta: DrawingTemplateMeta = {};
  const symbol = asNonEmptyString(raw.symbol);
  const interval = asNonEmptyString(raw.interval);
  const exchange = asNonEmptyString(raw.exchange);
  if (symbol) meta.symbol = symbol;
  if (interval) meta.interval = interval;
  if (exchange) meta.exchange = exchange;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Parse one template object. Returns null if name/id invalid or drawings missing.
 * Drawings are re-serialized through normalize so garbage is dropped.
 */
export function parseTemplate(raw: unknown): DrawingTemplate | null {
  if (!isRecord(raw)) return null;

  const name = asNonEmptyString(raw.name);
  if (!name) return null;

  const id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : genId('tpl');

  const now = Date.now();
  const createdAt = asFiniteNumber(raw.createdAt) ?? now;
  const updatedAt = asFiniteNumber(raw.updatedAt) ?? createdAt;

  const drawings = serializeDrawings(raw.drawings);
  const meta = parseTemplateMeta(raw.meta);

  const tpl: DrawingTemplate = {
    id,
    name,
    createdAt,
    updatedAt,
    drawings,
  };
  if (meta) tpl.meta = meta;
  return tpl;
}

/**
 * Build a new template from a name + drawings list (+ optional chart meta).
 * Generates a fresh id and timestamps.
 */
export function createTemplate(
  name: string,
  drawings: unknown,
  meta?: DrawingTemplateMeta | null,
): DrawingTemplate {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Template name is required');
  }
  const now = Date.now();
  const tpl: DrawingTemplate = {
    id: genId('tpl'),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    drawings: serializeDrawings(drawings),
  };
  const m = parseTemplateMeta(meta ?? undefined);
  if (m) tpl.meta = m;
  return tpl;
}

/**
 * Parse the full catalog store. Tolerant of missing/corrupt input.
 */
export function parseTemplatesStore(raw: unknown): DrawingTemplatesStore {
  if (!isRecord(raw)) {
    return { version: TEMPLATE_VERSION, templates: [] };
  }
  const list = Array.isArray(raw.templates) ? raw.templates : [];
  const templates: DrawingTemplate[] = [];
  for (const item of list) {
    const t = parseTemplate(item);
    if (t) templates.push(t);
  }
  return { version: TEMPLATE_VERSION, templates };
}

// ── Apply (replace / merge) ─────────────────────────────────────────────────

/**
 * Apply a template onto an existing drawings list.
 *
 * - `replace` — returns only the template drawings (fresh ids kept as stored)
 * - `merge` — appends template drawings; regenerates ids that collide with
 *   existing ones so both packs remain addressable
 *
 * Output is fully normalized dual-shape for store/layer.
 */
export function applyTemplateDrawings(
  existing: unknown,
  template: DrawingTemplate | { drawings: unknown },
  mode: LoadTemplateMode = 'replace',
): NormalizedDrawing[] {
  const incoming = hydrateTemplateDrawings(template.drawings);

  if (mode === 'replace') {
    return incoming;
  }

  // merge
  const base = Array.isArray(existing)
    ? (existing
        .map((d) => deserializeDrawing(d))
        .filter(Boolean) as NormalizedDrawing[])
    : [];

  const used = new Set(base.map((d) => d.id));
  const merged = base.slice();
  for (const d of incoming) {
    let id = d.id;
    if (used.has(id)) {
      id = genId('dw');
    }
    used.add(id);
    const copy = { ...d, id } as NormalizedDrawing;
    // Keep legacy mirrors in sync with new id
    merged.push(attachLegacyFields(copy));
  }
  return merged;
}

// ── localStorage I/O ────────────────────────────────────────────────────────

function readStoreRaw(): DrawingTemplatesStore {
  try {
    const raw = localStorage.getItem(DRAWING_TEMPLATES_KEY);
    if (!raw) return { version: TEMPLATE_VERSION, templates: [] };
    return parseTemplatesStore(JSON.parse(raw));
  } catch {
    return { version: TEMPLATE_VERSION, templates: [] };
  }
}

function writeStore(store: DrawingTemplatesStore): void {
  const payload: DrawingTemplatesStore = {
    version: TEMPLATE_VERSION,
    templates: store.templates,
  };
  localStorage.setItem(DRAWING_TEMPLATES_KEY, JSON.stringify(payload));
}

/** Load all templates from localStorage. */
export function loadTemplates(): DrawingTemplate[] {
  return readStoreRaw().templates;
}

/** Replace the entire templates catalog. */
export function saveTemplates(templates: DrawingTemplate[]): void {
  const cleaned: DrawingTemplate[] = [];
  for (const t of templates) {
    const p = parseTemplate(t);
    if (p) cleaned.push(p);
  }
  writeStore({ version: TEMPLATE_VERSION, templates: cleaned });
}

/** List summaries (no drawings payload). */
export function listTemplates(): DrawingTemplateSummary[] {
  return loadTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    drawingCount: t.drawings.length,
    meta: t.meta,
  }));
}

/** Fetch one template by id. */
export function getTemplate(id: string): DrawingTemplate | null {
  return loadTemplates().find((t) => t.id === id) ?? null;
}

/**
 * Save current drawings as a named template.
 * If `opts.id` is set and found, overwrites that entry; otherwise appends.
 */
export function saveTemplate(
  name: string,
  drawings: unknown,
  opts?: {
    meta?: DrawingTemplateMeta | null;
    id?: string;
  },
): DrawingTemplate {
  const catalog = loadTemplates();
  const existingIdx =
    opts?.id != null ? catalog.findIndex((t) => t.id === opts.id) : -1;

  if (existingIdx >= 0) {
    const prev = catalog[existingIdx]!;
    const next: DrawingTemplate = {
      ...prev,
      name: name.trim() || prev.name,
      updatedAt: Date.now(),
      drawings: serializeDrawings(drawings),
    };
    const m = parseTemplateMeta(opts?.meta ?? prev.meta);
    if (m) next.meta = m;
    else delete next.meta;
    catalog[existingIdx] = next;
    saveTemplates(catalog);
    return next;
  }

  const created = createTemplate(name, drawings, opts?.meta);
  catalog.push(created);
  saveTemplates(catalog);
  return created;
}

/** Delete a template by id. Returns true if something was removed. */
export function deleteTemplate(id: string): boolean {
  const catalog = loadTemplates();
  const next = catalog.filter((t) => t.id !== id);
  if (next.length === catalog.length) return false;
  saveTemplates(next);
  return true;
}

// ── Export / import JSON ────────────────────────────────────────────────────

/** Serialize one template to a pretty-printed export file string. */
export function exportTemplateJson(template: DrawingTemplate): string {
  const envelope: DrawingTemplateExport = {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    template: parseTemplate(template) ?? template,
  };
  return JSON.stringify(envelope, null, 2);
}

/** Serialize the full catalog for backup download. */
export function exportAllTemplatesJson(): string {
  const envelope: DrawingTemplatesExport = {
    format: 'axis.drawingTemplates',
    version: TEMPLATE_VERSION,
    templates: loadTemplates(),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Parse an import payload into one or more templates.
 * Accepts:
 * - single template object
 * - `{ format: 'axis.drawingTemplate', template }`
 * - `{ format: 'axis.drawingTemplates', templates: [] }`
 * - bare array of templates
 */
export function parseImportPayload(raw: unknown): DrawingTemplate[] {
  if (Array.isArray(raw)) {
    return raw.map(parseTemplate).filter(Boolean) as DrawingTemplate[];
  }
  if (!isRecord(raw)) return [];

  if (raw.format === TEMPLATE_FORMAT && isRecord(raw.template)) {
    const t = parseTemplate(raw.template);
    return t ? [t] : [];
  }
  if (raw.format === 'axis.drawingTemplates' && Array.isArray(raw.templates)) {
    return raw.templates.map(parseTemplate).filter(Boolean) as DrawingTemplate[];
  }

  // Bare template object
  if (typeof raw.name === 'string' && Array.isArray(raw.drawings)) {
    const t = parseTemplate(raw);
    return t ? [t] : [];
  }

  // Bare drawings array wrapped under drawings key without name → not a template
  return [];
}

/**
 * Parse a JSON string (or already-parsed value) into templates.
 * Throws on invalid JSON string.
 */
export function importTemplateJson(json: string | unknown): DrawingTemplate[] {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  return parseImportPayload(raw);
}

/**
 * Import templates into localStorage.
 * - By default assigns fresh ids to avoid collisions (`forceNewIds: true`).
 * - When `forceNewIds` is false, same-id entries overwrite.
 * Returns number of templates added/updated.
 */
export function importTemplates(
  raw: string | unknown,
  opts?: { forceNewIds?: boolean },
): number {
  const forceNewIds = opts?.forceNewIds !== false;
  const incoming = importTemplateJson(raw);
  if (incoming.length === 0) return 0;

  const catalog = loadTemplates();
  const byId = new Map(catalog.map((t) => [t.id, t]));
  let count = 0;

  for (const t of incoming) {
    const id = forceNewIds ? genId('tpl') : t.id;
    const next: DrawingTemplate = {
      ...t,
      id,
      updatedAt: Date.now(),
    };
    byId.set(id, next);
    count += 1;
  }

  saveTemplates([...byId.values()]);
  return count;
}

// ── Re-exports useful for callers / tests ───────────────────────────────────

export { normalizeUserDrawings };
