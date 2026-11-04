// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layers panel preferences — which sections the user collapsed.
 *
 * A small id list in `localStorage`; read helpers never throw (unavailable
 * storage → empty list), so SSR / private-mode boots stay quiet.
 *
 * @module ui/layers/prefs
 */

import { getJson, setJson } from '../../utils/storage';

/** Collapsed section ids (`scripts`, `panes`, `overlays`, …). */
export const LAYERS_COLLAPSED_KEY = 'axis.layers.collapsed';

/** Section ids the panel knows about. Unknown ids are ignored on read. */
export const LAYER_SECTION_IDS = ['scripts', 'panes', 'overlays', 'onchain', 'drawings'] as const;

export type LayerSectionId = (typeof LAYER_SECTION_IDS)[number];

function isSectionId(value: unknown): value is LayerSectionId {
  return typeof value === 'string' && (LAYER_SECTION_IDS as readonly string[]).includes(value);
}

export function readCollapsedSections(): LayerSectionId[] {
  const raw = getJson<unknown>(LAYERS_COLLAPSED_KEY);
  if (!Array.isArray(raw)) return [];
  const out: LayerSectionId[] = [];
  for (const value of raw) {
    if (isSectionId(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

export function writeCollapsedSections(ids: readonly string[]): LayerSectionId[] {
  const next: LayerSectionId[] = [];
  for (const id of ids) {
    if (isSectionId(id) && !next.includes(id)) next.push(id);
  }
  setJson(LAYERS_COLLAPSED_KEY, next);
  return next;
}

/** Flip one section and persist. Returns the next collapsed list. */
export function toggleCollapsedSection(
  id: LayerSectionId,
  current?: readonly string[],
): LayerSectionId[] {
  const base = current ? [...current] : readCollapsedSections();
  const at = base.indexOf(id);
  if (at >= 0) base.splice(at, 1);
  else base.push(id);
  return writeCollapsedSections(base);
}
