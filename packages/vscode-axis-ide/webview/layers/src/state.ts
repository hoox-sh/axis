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
 * Layers view-model. Section order and empty copy match `layers-messages.ts`.
 */

export const LAYER_TITLES = [
  'Scripts',
  'Panes',
  'Overlays',
  'On-chain',
  'Drawings',
] as const;

export type LayerTitle = (typeof LAYER_TITLES)[number];

const EMPTY_LABEL: Record<LayerTitle, string> = {
  Scripts: 'Apply a builtin',
  Panes: 'No panes yet',
  Overlays: 'No overlays yet',
  'On-chain': 'No on-chain yet',
  Drawings: 'No drawings yet',
};

const ROLE: Record<LayerTitle, string> = {
  Scripts: 'Builtins and scripts applied on this chart',
  Panes: 'Price and indicator panes in the chart',
  Overlays: 'Series drawn on the price pane',
  'On-chain': 'On-chain datasets bound to this chart',
  Drawings: 'User drawings saved in the chart file',
};

export const SOURCE_OPEN = 'from the open chart';
export const SOURCE_CLOSED = 'no chart open';

export type LayersRowView = {
  id: string;
  label: string;
  detail: string;
};

export type LayersSectionView = {
  id: string;
  title: string;
  role: string;
  count: number;
  rows: LayersRowView[];
  empty: string;
};

export type LayersViewState = {
  chartOpen: boolean;
  total: number;
  source: string;
  sections: LayersSectionView[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sectionId(title: string): string {
  return `layers.section.${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function emptySection(title: LayerTitle): LayersSectionView {
  return {
    id: sectionId(title),
    title,
    role: ROLE[title],
    count: 0,
    rows: [],
    empty: EMPTY_LABEL[title],
  };
}

/** Five empty cards. Header reads as no chart until the host posts a snapshot. */
export function initialLayersView(): LayersViewState {
  return {
    chartOpen: false,
    total: 0,
    source: SOURCE_CLOSED,
    sections: LAYER_TITLES.map((title) => emptySection(title)),
  };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function rowOf(raw: unknown, index: number): LayersRowView | null {
  try {
    if (!isPlainObject(raw)) return null;
    const label = textOf(raw.label).trim();
    if (!label) return null;
    const id = textOf(raw.id).trim() || `row-${index}`;
    return { id, label, detail: textOf(raw.detail) };
  } catch {
    return null;
  }
}

function sectionOf(raw: unknown, index: number): LayersSectionView | null {
  try {
    if (!isPlainObject(raw)) return null;
    const title = textOf(raw.title).trim();
    if (!title) return null;
    const rows: LayersRowView[] = [];
    if (Array.isArray(raw.rows)) {
      for (let i = 0; i < raw.rows.length; i++) {
        const row = rowOf(raw.rows[i], i);
        if (row) rows.push(row);
      }
    }
    const countRaw = raw.count;
    const count =
      typeof countRaw === 'number' && Number.isFinite(countRaw) && countRaw >= 0
        ? Math.floor(countRaw)
        : rows.length;
    const empty = textOf(raw.empty).trim();
    const role = textOf(raw.role).trim();
    const id = textOf(raw.id).trim() || sectionId(title) || `layers.section.${index}`;
    return {
      id,
      title,
      role: role || 'Layer',
      count,
      rows,
      empty: empty || 'Empty',
    };
  } catch {
    return null;
  }
}

function coerceSnapshot(raw: unknown): LayersViewState | null {
  if (!isPlainObject(raw)) return null;
  const sections: LayersSectionView[] = [];
  if (Array.isArray(raw.sections)) {
    for (let i = 0; i < raw.sections.length; i++) {
      const section = sectionOf(raw.sections[i], i);
      if (section) sections.push(section);
    }
  }
  if (sections.length === 0) return null;
  const chartOpen = raw.chartOpen === true;
  const totalRaw = raw.total;
  const total =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw) && totalRaw >= 0
      ? Math.floor(totalRaw)
      : sections.reduce((sum, section) => sum + section.count, 0);
  const sourceText = textOf(raw.source).trim();
  const source = sourceText || (chartOpen ? SOURCE_OPEN : SOURCE_CLOSED);
  return { chartOpen, total, source, sections };
}

/** Host `{ type: 'layers.set', snapshot }`. Never throws. */
export function viewFromHostMessage(raw: unknown): LayersViewState | null {
  try {
    if (!isPlainObject(raw)) return null;
    if (raw.type !== 'layers.set') return null;
    return coerceSnapshot(raw.snapshot);
  } catch {
    return null;
  }
}
