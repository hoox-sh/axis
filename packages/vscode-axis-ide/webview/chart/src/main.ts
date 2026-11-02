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
 * AXIS chart webview: ready handshake → chart.init / chart.full / chart.delta.
 * Seq gap on delta → post chart.requestReload (host resume stub).
 * MVP trendline: toolbar → drawing.setTool; two clicks → drawing.commit.
 */

import './style.css';
import {
  TOOL_TRENDLINE,
  createDrawingOverlay,
  createLwcCoordAdapter,
  createTrendlinePlacer,
  type DrawingOverlay,
} from './drawings';
import { createChartPainter, type ChartPainter } from './paint';
import { decodeHostMessage, PROTOCOL_VERSION } from './protocol';
import {
  applyChartHostMessage,
  initialChartState,
  pluginChipSpecs,
  type ChartViewState,
  type UserDrawing,
} from './state';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let state: ChartViewState = initialChartState();
let painter: ChartPainter | null = null;
let overlay: DrawingOverlay | null = null;
let apiRef: VsCodeApi | null = null;
let rangeUnsub: (() => void) | null = null;
const placer = createTrendlinePlacer();

function postReady(api: VsCodeApi): void {
  if (disposed) return;
  api.postMessage({
    v: PROTOCOL_VERSION,
    type: 'webview.ready',
    payload: {
      view: 'chart',
      capabilities: ['chart-shell', 'chart-full', 'chart-delta', 'drawing-trendline'],
    },
    ts: Date.now(),
  });
}

function postRequestReload(api: VsCodeApi): void {
  if (disposed) return;
  try {
    api.postMessage({
      v: PROTOCOL_VERSION,
      type: 'chart.requestReload',
      payload: {},
      ts: Date.now(),
    });
  } catch {
    // host may be gone
  }
}

function postSetTool(api: VsCodeApi, tool: string): void {
  if (disposed) return;
  try {
    api.postMessage({
      v: PROTOCOL_VERSION,
      type: 'drawing.setTool',
      payload: { tool },
      ts: Date.now(),
    });
  } catch {
    // host may be gone
  }
}

function postCommit(api: VsCodeApi, drawing: UserDrawing): void {
  if (disposed) return;
  try {
    api.postMessage({
      v: PROTOCOL_VERSION,
      type: 'drawing.commit',
      payload: {
        id: drawing.id,
        tool: drawing.tool,
        points: [
          { time: drawing.points[0].time, price: drawing.points[0].price },
          { time: drawing.points[1].time, price: drawing.points[1].price },
        ],
      },
      ts: Date.now(),
    });
  } catch {
    // host may be gone
  }
}

function redrawOverlay(): void {
  if (disposed || !overlay) return;
  overlay.redraw(state.drawings, placer.getDraft());
}

function ensurePainter(): ChartPainter | null {
  if (disposed) return null;
  if (painter) return painter;
  const host = document.getElementById('chart-host');
  if (!host) return null;
  painter = createChartPainter(host);
  rangeUnsub = painter.onVisibleRangeChange(() => {
    redrawOverlay();
  });
  return painter;
}

function ensureOverlay(): DrawingOverlay | null {
  if (disposed) return null;
  if (overlay) return overlay;
  const svg = document.getElementById('drawing-overlay');
  if (!svg || !(svg instanceof SVGSVGElement)) return null;
  overlay = createDrawingOverlay(svg, () =>
    createLwcCoordAdapter(painter?.getChart() ?? null, painter?.getSeries() ?? null),
  );
  return overlay;
}

const RUN_STATUS_PULSE = new Set(['ok', 'error', 'plugins']);

function renderPlotCount(plots: ChartViewState['plots']): void {
  const el = document.getElementById('chart-plot-count');
  if (!el) return;
  const n = Array.isArray(plots) ? plots.length : 0;
  if (n > 0) {
    el.hidden = false;
    el.textContent = `plots ${n}`;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

function renderPluginChips(plugins: ChartViewState['plugins']): void {
  const root = document.getElementById('chart-plugins');
  if (!root) return;
  const chips = pluginChipSpecs(plugins);
  root.replaceChildren();
  if (chips.length === 0) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  for (const chip of chips) {
    const el = document.createElement('span');
    el.className = 'chart-plugins__chip';
    el.dataset.kind = chip.kind;
    el.textContent = `${chip.prefix} ${chip.id}`;
    root.appendChild(el);
  }
}

function applyRunStatus(raw: unknown): void {
  const shell = document.getElementById('chart-shell');
  if (!shell) return;
  const status = typeof raw === 'string' ? raw.trim() : '';
  if (!RUN_STATUS_PULSE.has(status)) return;
  try {
    // Retrigger the 300ms pulse when the same status repeats.
    shell.removeAttribute('data-run-status');
    void shell.getBoundingClientRect();
    shell.setAttribute('data-run-status', status);
  } catch {
    // detached / hostile DOM
  }
}

function syncToolButton(): void {
  const btn = document.getElementById('tool-trendline');
  if (!btn) return;
  const active = placer.tool === TOOL_TRENDLINE;
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.classList.toggle('is-active', active);
  const shell = document.getElementById('chart-shell');
  if (shell) {
    shell.setAttribute('data-axis-tool', placer.tool ?? '');
  }
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) {
    // Drop unexpected / malformed host traffic (wrong direction, bad envelope).
    return;
  }
  const outcome = applyChartHostMessage(state, decoded.type, decoded.payload);
  state = outcome.state;
  if (outcome.requestReload && apiRef) {
    postRequestReload(apiRef);
  }
  if (disposed) return;
  const p = ensurePainter();
  if (disposed) return;
  p?.apply(state);
  ensureOverlay();
  redrawOverlay();
  renderPlotCount(state.plots);
  renderPluginChips(state.plugins);
  if (decoded.type === 'host.run.status') {
    applyRunStatus(decoded.payload.state);
  }
}

function onToolbarClick(event: Event): void {
  if (disposed || !apiRef) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest('[data-tool]');
  if (!(btn instanceof HTMLElement)) return;
  const tool = btn.getAttribute('data-tool') ?? '';
  if (tool !== TOOL_TRENDLINE) return;
  // Toggle trendline tool.
  const next = placer.tool === TOOL_TRENDLINE ? null : TOOL_TRENDLINE;
  placer.setTool(next);
  syncToolButton();
  postSetTool(apiRef, next ?? 'cursor');
  redrawOverlay();
}

function onStageClick(event: MouseEvent): void {
  if (disposed || !apiRef) return;
  if (placer.tool !== TOOL_TRENDLINE) return;
  // Ignore clicks on the toolbar.
  const t = event.target;
  if (t instanceof Element && t.closest('#chart-toolbar')) return;

  const host = document.getElementById('chart-host');
  if (!host) return;
  const rect = host.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const coords = createLwcCoordAdapter(
    painter?.getChart() ?? null,
    painter?.getSeries() ?? null,
  );
  const point = coords.toChartPoint(x, y);
  if (!point) return;

  const committed = placer.onClick(point);
  if (committed) {
    // Optimistic local append (host dirty + persist; reload restores from doc).
    const without = state.drawings.filter((d) => d.id !== committed.id);
    state = { ...state, drawings: [...without, committed] };
    postCommit(apiRef, committed);
  }
  redrawOverlay();
}

function main(): void {
  const api = acquireVsCodeApi();
  apiRef = api;
  // Listener before ready — host may reply synchronously after postMessage.
  window.addEventListener('message', onHostMessage);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      try {
        rangeUnsub?.();
      } catch {
        // ignore
      }
      rangeUnsub = null;
      try {
        overlay?.dispose();
      } catch {
        // ignore
      }
      overlay = null;
      try {
        painter?.dispose();
      } catch {
        // ignore
      }
      painter = null;
      apiRef = null;
    },
    { once: true },
  );

  const toolbar = document.getElementById('chart-toolbar');
  toolbar?.addEventListener('click', onToolbarClick);
  const stage = document.getElementById('chart-stage') ?? document.getElementById('chart-host');
  stage?.addEventListener('click', onStageClick);

  ensurePainter();
  ensureOverlay();
  syncToolButton();
  postReady(api);
}

main();
