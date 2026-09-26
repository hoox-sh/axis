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
 * Chart context-menu hit testing and item lists.
 *
 * Regions match the Lightweight Charts host: plot, right/left price scale,
 * and the time scale. Callers add drawing and script-chip hits on top.
 *
 * @module chart/context-menu
 */

import type { ContextMenuEntry } from '../ui/context-menu';
import { CHART_TYPES } from './chart-type';
import type { ChartPlotRect } from './plot-rect';

/** Which axis gutter or plot the pointer landed in. */
export type ChartRegion = 'plot' | 'price-scale' | 'time-scale';

/** One pane host plus its plot rectangle (CSS pixels, viewport coords for the host). */
export type PaneHitBox = {
  paneId: string;
  paneType: string;
  host: { left: number; top: number; width: number; height: number };
  plot: ChartPlotRect;
};

/** Classified chart surface under the pointer. */
export type ChartHit = {
  paneId: string;
  paneType: string;
  region: ChartRegion;
};

/** Menu body. `chart` is the host when the pointer misses every pane. */
export type ChartMenuKind =
  | 'plot'
  | 'price-scale'
  | 'time-scale'
  | 'pane'
  | 'script'
  | 'chart'
  | 'drawing';

export type ChartMenuScript = {
  id: string;
  name: string;
  visible: boolean;
};

export type ChartMenuContext = {
  kind: ChartMenuKind;
  paneLabel?: string;
  chartType?: string;
  scale?: {
    auto: boolean;
    log: boolean;
    labels: boolean;
    last: boolean;
    names: boolean;
  };
  /** Formatted price under the pointer. Omit copy/alert rows when null. */
  priceLabel?: string | null;
  drawing?: {
    label: string;
    locked: boolean;
    hidden: boolean;
    lockAll: boolean;
  };
  script?: ChartMenuScript;
  paneScripts?: ChartMenuScript[];
  canHidePane?: boolean;
};

/**
 * Pick the pane under `(clientX, clientY)` and whether that point is plot,
 * price scale, or time scale.
 *
 * The right price scale is the full-height gutter. The time scale is the
 * strip under the plot, only where x is still inside the plot width.
 */
export function classifyChartPointer(
  clientX: number,
  clientY: number,
  panes: readonly PaneHitBox[],
): ChartHit | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !panes?.length) return null;
  let best: PaneHitBox | null = null;
  let bestArea = Infinity;
  for (const pane of panes) {
    const h = pane.host;
    if (!h || h.width <= 0 || h.height <= 0) continue;
    const right = h.left + h.width;
    const bottom = h.top + h.height;
    if (clientX < h.left || clientX >= right || clientY < h.top || clientY >= bottom) continue;
    const area = h.width * h.height;
    if (area < bestArea) {
      best = pane;
      bestArea = area;
    }
  }
  if (!best) return null;
  const plot = best.plot;
  const plotLeft = best.host.left + (Number.isFinite(plot.left) ? plot.left : 0);
  const plotTop = best.host.top + (Number.isFinite(plot.top) ? plot.top : 0);
  const plotRight = plotLeft + (Number.isFinite(plot.width) ? plot.width : 0);
  const plotBottom = plotTop + (Number.isFinite(plot.height) ? plot.height : 0);
  const hostRight = best.host.left + best.host.width;
  const hostBottom = best.host.top + best.host.height;

  let region: ChartRegion = 'plot';
  const inRightScale = plot.rightScale > 0 && clientX >= plotRight && clientX < hostRight;
  const inLeftScale = plot.left > 0 && clientX < plotLeft && clientX >= best.host.left;
  if (inRightScale || inLeftScale) region = 'price-scale';
  else if (plot.timeScale > 0 && clientY >= plotBottom && clientY < hostBottom) region = 'time-scale';

  return { paneId: best.paneId, paneType: best.paneType, region };
}

/**
 * Price at a plot-relative Y. `coordinateToPrice` is the series method;
 * failures and non-finite results are null.
 */
export function pointerPrice(
  clientY: number,
  hostTop: number,
  plotTop: number,
  coordinateToPrice: ((y: number) => number | null) | undefined,
): number | null {
  if (typeof coordinateToPrice !== 'function') return null;
  const y = clientY - hostTop - plotTop;
  if (!Number.isFinite(y)) return null;
  try {
    const price = coordinateToPrice(y);
    return typeof price === 'number' && Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

function item(
  id: string,
  label: string,
  extra?: { disabled?: boolean; checked?: boolean; danger?: boolean },
): ContextMenuEntry {
  return { type: 'item', id, label, ...extra };
}

function sep(id: string): ContextMenuEntry {
  return { type: 'sep', id };
}

function viewRows(): ContextMenuEntry[] {
  return [item('view.reset', 'Reset chart view'), item('view.latest', 'Scroll to latest')];
}

function settingsRow(): ContextMenuEntry[] {
  return [sep('sep-settings'), item('app.settings', 'Chart settings')];
}

function shotRows(): ContextMenuEntry[] {
  return [item('shot.save', 'Save screenshot'), item('shot.copy', 'Copy screenshot')];
}

function scaleRows(scale: NonNullable<ChartMenuContext['scale']>, withReset: boolean): ContextMenuEntry[] {
  const rows: ContextMenuEntry[] = [];
  if (withReset) rows.push(item('scale.reset', 'Reset price scale'));
  rows.push(
    item('scale.auto', 'Auto scale', { checked: scale.auto }),
    item('scale.log', 'Logarithmic scale', { checked: scale.log }),
  );
  return rows;
}

function labelRows(scale: NonNullable<ChartMenuContext['scale']>): ContextMenuEntry[] {
  return [
    item('scale.labels', 'Price scale labels', { checked: scale.labels }),
    item('scale.last', 'Last price labels', { checked: scale.last }),
    item('scale.names', 'Plot names on labels', { checked: scale.names }),
  ];
}

function chartTypeRows(current: string | undefined): ContextMenuEntry[] {
  return CHART_TYPES.map((t) =>
    item(`type.${t.id}`, t.label, { checked: t.id === current }),
  );
}

function scriptRows(script: ChartMenuScript): ContextMenuEntry[] {
  const name = script.name.trim() || 'Script';
  return [
    item(`script.settings.${script.id}`, `${name} settings`),
    item(`script.visible.${script.id}`, script.visible ? `Hide ${name}` : `Show ${name}`),
    item(`script.source.${script.id}`, `Open ${name} source`),
    item(`script.rerun.${script.id}`, `Re-run ${name}`),
    item(`script.remove.${script.id}`, `Remove ${name}`, { danger: true }),
  ];
}

function priceRows(label: string): ContextMenuEntry[] {
  return [item('price.copy', `Copy ${label}`), item('price.alert', `Alert at ${label}`)];
}

/**
 * Entries for one chart context menu. Ids are stable (`view.reset`,
 * `type.candles`, `script.remove.<id>`, …) so the dispatcher can switch on them.
 */
export function buildChartMenu(ctx: ChartMenuContext): ContextMenuEntry[] {
  const scale = ctx.scale ?? {
    auto: false,
    log: false,
    labels: true,
    last: true,
    names: true,
  };

  if (ctx.kind === 'drawing' && ctx.drawing) {
    const d = ctx.drawing;
    const blocked = d.locked || d.lockAll;
    return [
      item('drawing.duplicate', 'Duplicate', { disabled: blocked }),
      item('drawing.lock', d.locked ? 'Unlock' : 'Lock', { checked: d.locked }),
      item('drawing.hide', d.hidden ? 'Show' : 'Hide', { checked: d.hidden }),
      item('drawing.front', 'Bring to front', { disabled: blocked }),
      item('drawing.back', 'Send to back', { disabled: blocked }),
      sep('sep-drawing-delete'),
      item('drawing.delete', 'Delete', { danger: true, disabled: blocked }),
    ];
  }

  if (ctx.kind === 'script' && ctx.script) {
    return [...scriptRows(ctx.script), sep('sep-script-view'), ...viewRows(), ...settingsRow()];
  }

  if (ctx.kind === 'price-scale') {
    const rows: ContextMenuEntry[] = [
      ...scaleRows(scale, true),
      sep('sep-scale-labels'),
      ...labelRows(scale),
    ];
    if (ctx.priceLabel) rows.push(sep('sep-scale-price'), ...priceRows(ctx.priceLabel));
    rows.push(...settingsRow());
    return rows;
  }

  if (ctx.kind === 'time-scale') {
    return [
      item('view.reset', 'Reset time scale'),
      item('view.latest', 'Scroll to latest'),
      ...settingsRow(),
    ];
  }

  if (ctx.kind === 'pane') {
    const rows: ContextMenuEntry[] = [];
    const scripts = (ctx.paneScripts ?? []).slice(0, 8);
    scripts.forEach((s, i) => {
      if (i > 0) rows.push(sep(`sep-script-${s.id}`));
      rows.push(...scriptRows(s));
    });
    if (scripts.length > 0 && ctx.canHidePane) rows.push(sep('sep-pane-hide'));
    if (ctx.canHidePane) rows.push(item('pane.hide', `Hide ${ctx.paneLabel?.trim() || 'pane'}`));
    if (rows.length > 0) rows.push(sep('sep-pane-view'));
    rows.push(...viewRows(), ...settingsRow());
    return rows;
  }

  if (ctx.kind === 'chart') {
    return [...viewRows(), sep('sep-chart-shot'), ...shotRows(), ...settingsRow()];
  }

  // Price-pane plot
  const rows: ContextMenuEntry[] = [
    ...viewRows(),
    sep('sep-plot-scale'),
    ...scaleRows(scale, false),
  ];
  if (ctx.priceLabel) {
    rows.push(sep('sep-plot-price'), ...priceRows(ctx.priceLabel));
  }
  rows.push(sep('sep-plot-type'), ...chartTypeRows(ctx.chartType), sep('sep-plot-shot'), ...shotRows(), ...settingsRow());
  return rows;
}

/** Aria label for the open menu. */
export function chartMenuLabel(ctx: ChartMenuContext): string {
  if (ctx.kind === 'drawing') return ctx.drawing?.label ? `${ctx.drawing.label} menu` : 'Drawing menu';
  if (ctx.kind === 'script') return ctx.script?.name ? `${ctx.script.name} menu` : 'Script menu';
  if (ctx.kind === 'price-scale') return 'Price scale menu';
  if (ctx.kind === 'time-scale') return 'Time scale menu';
  if (ctx.kind === 'pane') return ctx.paneLabel ? `${ctx.paneLabel} menu` : 'Pane menu';
  if (ctx.kind === 'chart') return 'Chart menu';
  return 'Chart menu';
}
