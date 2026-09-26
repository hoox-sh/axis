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
 * Route a chart context-menu id to host callbacks, and scroll the time scale
 * to the last bar. Side effects stay in the callbacks so this file is testable
 * without a mounted chart.
 *
 * @module chart/context-actions
 */

/** Window event so the [A]/[L] cluster re-reads manager scale flags. */
export const CHART_SCALE_EVENT = 'axis-chart-scale';

export type ChartMenuEnv = {
  resetView: () => void;
  scrollLatest: () => void;
  toggleAuto: () => void;
  toggleLog: () => void;
  resetScale: () => void;
  toggleLabels: () => void;
  toggleLast: () => void;
  toggleNames: () => void;
  setChartType: (id: string) => void;
  copyPrice: () => void;
  addAlert: () => void;
  saveShot: () => void;
  copyShot: () => void;
  openSettings: () => void;
  hidePane: () => void;
  scriptSettings: (id: string) => void;
  scriptVisible: (id: string) => void;
  scriptSource: (id: string) => void;
  scriptRerun: (id: string) => void;
  scriptRemove: (id: string) => void;
  drawingDuplicate: () => void;
  drawingLock: () => void;
  drawingHide: () => void;
  drawingFront: () => void;
  drawingBack: () => void;
  drawingDelete: () => void;
};

const SCRIPT_PREFIXES = [
  ['script.settings.', 'scriptSettings'],
  ['script.visible.', 'scriptVisible'],
  ['script.source.', 'scriptSource'],
  ['script.rerun.', 'scriptRerun'],
  ['script.remove.', 'scriptRemove'],
] as const;

/**
 * Run the action for a menu id from {@link buildChartMenu}.
 * Unknown ids no-op. Script ids carry the indicator id after the prefix.
 */
export function dispatchChartMenu(id: string, env: ChartMenuEnv): void {
  if (!id || !env) return;
  if (id.startsWith('type.')) {
    const chartType = id.slice('type.'.length);
    if (chartType) env.setChartType(chartType);
    return;
  }
  for (const [prefix, key] of SCRIPT_PREFIXES) {
    if (id.startsWith(prefix)) {
      const scriptId = id.slice(prefix.length);
      if (scriptId) env[key](scriptId);
      return;
    }
  }
  switch (id) {
    case 'view.reset':
      env.resetView();
      return;
    case 'view.latest':
      env.scrollLatest();
      return;
    case 'scale.auto':
      env.toggleAuto();
      return;
    case 'scale.log':
      env.toggleLog();
      return;
    case 'scale.reset':
      env.resetScale();
      return;
    case 'scale.labels':
      env.toggleLabels();
      return;
    case 'scale.last':
      env.toggleLast();
      return;
    case 'scale.names':
      env.toggleNames();
      return;
    case 'price.copy':
      env.copyPrice();
      return;
    case 'price.alert':
      env.addAlert();
      return;
    case 'shot.save':
      env.saveShot();
      return;
    case 'shot.copy':
      env.copyShot();
      return;
    case 'app.settings':
      env.openSettings();
      return;
    case 'pane.hide':
      env.hidePane();
      return;
    case 'drawing.duplicate':
      env.drawingDuplicate();
      return;
    case 'drawing.lock':
      env.drawingLock();
      return;
    case 'drawing.hide':
      env.drawingHide();
      return;
    case 'drawing.front':
      env.drawingFront();
      return;
    case 'drawing.back':
      env.drawingBack();
      return;
    case 'drawing.delete':
      env.drawingDelete();
      return;
    default:
      return;
  }
}

/**
 * Put the last bar at the right edge. Prefers `scrollToRealTime`, then
 * `scrollToPosition(0)`. Returns false when the chart has neither.
 * Accepts the live Lightweight Charts instance (structural, not a nominal type).
 */
export function scrollChartToLatest(chart: unknown): boolean {
  if (!chart || typeof chart !== 'object') return false;
  const timeScale = (chart as { timeScale?: unknown }).timeScale;
  if (typeof timeScale !== 'function') return false;
  try {
    const ts = timeScale.call(chart) as {
      scrollToRealTime?: unknown;
      scrollToPosition?: unknown;
    } | null;
    if (!ts) return false;
    if (typeof ts.scrollToRealTime === 'function') {
      ts.scrollToRealTime();
      return true;
    }
    if (typeof ts.scrollToPosition === 'function') {
      ts.scrollToPosition(0, false);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
