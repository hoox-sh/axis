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

import {
  store,
  setStore,
  addIndicator,
  addPane,
  setStatus,
  setLastRun,
  appendLog,
  recordRunLatency,
  setTelemetryPlane,
  setTelemetryState,
} from '../store';
import { getManager } from '../chart/manager-access';
import { PLOT_PALETTE } from '../chart/series-factory';
import { normalizeStrategyEvents, eventsToMarkers, buildEquityCurve } from '../results/events';
import { buildStrategyReport } from '../results/strategy';
import { getActiveDrawingLayer } from '../chart/drawing-layer';
import { getActiveEngine, getActiveEngineConfig } from '../plugins/active';
import type { RunResult as EngineRunResult } from '../plugins/types';
import { classifyTransport } from '../ui/telemetry';

export type RunResult = EngineRunResult & {
  series: Record<string, (number | null)[]>;
};

export interface RunOptions {
  /** Quiet status bar / fewer log lines (live re-runs) */
  silent?: boolean;
  /** Open Results drawer after run (default true when not silent) */
  openResults?: boolean;
}

export async function runScript(script: string, opts: RunOptions = {}): Promise<RunResult> {
  const silent = !!opts.silent;
  if (!silent) setStatus('running', 'Executing Pine Script…');
  const t0 = performance.now();
  try {
    const engine = getActiveEngine();
    const config = getActiveEngineConfig();
    const transport = classifyTransport('engine', engine.id, engine.capabilities);
    const mode = String(config?.mode || 'interpret');
    setTelemetryPlane('engine', {
      id: engine.id,
      name: engine.name,
      transport,
      state: 'connecting',
      detail: mode,
      error: null,
    });
    // Outer budget must cover WS probe + REST fallback (engine manages sub-budgets).
    const timeoutMs = silent
      ? 60_000
      : Math.min(180_000, Math.max(90_000, 45_000 + (store.bars?.length || 0) * 40));
    const result = await engine.run({
      script,
      bars: store.bars,
      config,
      // Do not abort the whole run on a short timer while engine may still REST-fallback.
      // Engine uses its own AbortSignal.timeout for HTTP; pass undefined for max reliability.
      signal: undefined,
    });
    const ms = result.meta?.ms ?? performance.now() - t0;
    const runTransport =
      result.meta?.transport === 'ws'
        ? 'ws'
        : result.meta?.transport === 'local'
          ? 'local'
          : transport;
    recordRunLatency(ms);
    if (result.status === 'error') {
      const msg = result.error || 'Engine error';
      setTelemetryState('engine', 'error', {
        error: msg,
        latencyMs: ms,
        detail: mode,
        transport: runTransport,
      });
      if (!silent) setStatus('error', msg);
      else appendLog('error', `Live re-run failed: ${msg}`, 'live');
      return {
        ...result,
        series: result.series || {},
        events: result.events || [],
        meta: { ...result.meta, ms },
      };
    }
    setTelemetryState('engine', 'open', {
      latencyMs: ms,
      detail: `${mode} · ${runTransport} · ${ms.toFixed(0)}ms`,
      error: null,
      transport: runTransport,
    });
    if (!silent) setStatus('ready', `Completed in ${ms.toFixed(0)}ms`);
    return {
      ...result,
      series: result.series || {},
      events: result.events || [],
      meta: {
        ...result.meta,
        ms,
        overlay: result.meta?.overlay ?? true,
        script_name: result.meta?.script_name || 'plot',
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const ms = performance.now() - t0;
    recordRunLatency(ms);
    setTelemetryState('engine', 'error', { error: msg, latencyMs: ms });
    if (!silent) setStatus('error', msg);
    else appendLog('error', `Live re-run: ${msg}`, 'live');
    return {
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: msg,
      meta: { ms },
    };
  }
}

/**
 * Run a Pine Script and apply results to the chart.
 * @param script - Pine Script source code
 * @param indicatorId - If provided, an existing indicator ID to update.
 * @param opts - silent / openResults for live path
 */
export async function runAndApply(
  script: string,
  indicatorId?: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const silent = !!opts.silent;
  const openResults = opts.openResults ?? !silent;

  const result = await runScript(script, opts);
  setLastRun(result);
  if (openResults) {
    setStore('resultsPanel', 'open', true);
  }
  if (result.status === 'error') return result;

  const manager = getManager();
  if (!manager) return result;

  // Pine: indicator defaults overlay=false; strategy defaults overlay=true.
  // Explicit false must never be coerced to true.
  const overlayFlag = result.meta?.overlay;
  const overlay = overlayFlag !== false && overlayFlag !== 0 && overlayFlag !== 'false';
  const existing = indicatorId
    ? store.scripts.find((s) => s.id === indicatorId)
    : undefined;
  const scriptName = String(result.meta?.script_name || existing?.name || 'Indicator');
  let paneId = 'price';
  if (!overlay) {
    paneId =
      existing?.paneId && existing.paneId !== 'price' ? existing.paneId : 'indicator';
    if (!manager.getPane(paneId)) {
      // Keep store panes list in sync
      if (!store.panes.some((p) => p.id === 'indicator')) {
        addPane('indicator', scriptName);
      }
      manager.createPane('indicator', 'indicator', scriptName, 140);
      paneId = 'indicator';
      manager.syncTimeScales();
    } else {
      try {
        manager.setLabel(paneId, scriptName);
      } catch {
        /* ignore */
      }
    }
  }

  const ohlcvTimes = store.bars.map((b) => b.time);
  const plotMeta = (result.meta?.plot_meta || {}) as Record<
    string,
    { title?: string; color?: string | null; linewidth?: number; index?: number }
  >;
  const seriesEntries = Object.entries(result.series || {}).filter(
    ([k]) => !k.startsWith('__') && !k.startsWith('_'),
  );

  const toLineData = (arr: (number | null)[]) =>
    arr
      .map((v, i) => {
        const t = ohlcvTimes[i];
        if (v == null || typeof v !== 'number' || isNaN(v)) return null;
        if (t == null || !Number.isFinite(t)) return null;
        return { time: t as number, value: v };
      })
      .filter(Boolean) as { time: number; value: number }[];

  // Stable overlay sync: update-in-place when keys match (no remove→blank→add flash)
  const overlayLines: Array<{
    name: string;
    data: { time: number; value: number }[];
    color?: string;
  }> = [];
  if (seriesEntries.length > 0) {
    let colorIdx = 0;
    for (const [k, arr] of seriesEntries) {
      const data = toLineData(arr as (number | null)[]);
      if (!data.length) continue;
      const meta = plotMeta[k];
      const color =
        (meta?.color && String(meta.color)) ||
        PLOT_PALETTE[colorIdx % PLOT_PALETTE.length];
      colorIdx += 1;
      overlayLines.push({ name: k, data, color });
    }
  } else if (result.plots.length) {
    const data = toLineData(result.plots as (number | null)[]);
    if (data.length) overlayLines.push({ name: scriptName, data, color: PLOT_PALETTE[0] });
  }
  manager.syncOverlayLines(paneId, overlayLines);

  // Non-overlay scripts must not leave series on the price pane
  if (!overlay && paneId !== 'price') {
    const pricePane = manager.getPane('price');
    if (pricePane) {
      for (const line of overlayLines) {
        const key = `overlay_${line.name}`;
        if (pricePane.series[key]) {
          try {
            pricePane.chart.removeSeries(pricePane.series[key]);
          } catch {
            /* ignore */
          }
          delete pricePane.series[key];
        }
      }
    }
  }

  // Strategy: markers on price pane + equity curve
  const events = result.events || [];
  if (events.length) {
    const normalized = normalizeStrategyEvents(events, {
      bars: store.bars,
      includeOrders: false,
    });
    const markers = eventsToMarkers(normalized);
    manager.setTradeMarkers(markers);

    const report = buildStrategyReport(events, store.bars);
    if (report.trades.length) {
      const equity = buildEquityCurve(report.trades, 10_000);
      manager.setEquityCurve(equity);
      if (!silent) {
        appendLog(
          'ok',
          `Strategy: ${report.stats.trades} trades · net ${report.stats.totalPnl >= 0 ? '+' : ''}${report.stats.totalPnl.toFixed(2)} · ${markers.length} markers`,
          'strategy',
        );
      }
    } else {
      // Live silent re-runs: skip hide to avoid equity pane thrash
      if (!silent) {
        manager.hideEquityPane();
        if (markers.length) {
          appendLog('ok', `Strategy events: ${events.length} · ${markers.length} markers`, 'strategy');
        }
      }
    }
  } else if (!silent) {
    manager.hideEquityPane();
  }

  // Pine drawings: atomic replace (no clear→empty→set flash)
  const drawings = (result as RunResult & { drawings?: unknown[] }).drawings;
  const layer = getActiveDrawingLayer();
  if (drawings?.length) {
    layer?.setScriptDrawings(drawings);
    if (!silent) {
      appendLog('ok', `Pine drawings: ${drawings.length} object(s)`, 'drawings');
    }
  } else if (!silent) {
    // Only clear on interactive full runs when engine returned none
    layer?.clearScriptDrawings();
  }

  if (indicatorId === undefined) {
    const plots: Record<string, { color: string }> = {};
    let colorIdx = 0;
    if (seriesEntries.length) {
      for (const [k] of seriesEntries) {
        const meta = plotMeta[k];
        plots[k] = {
          color:
            (meta?.color && String(meta.color)) ||
            PLOT_PALETTE[colorIdx % PLOT_PALETTE.length],
        };
        colorIdx += 1;
      }
    } else {
      plots[scriptName] = { color: PLOT_PALETTE[0] };
    }
    addIndicator(scriptName, script, paneId, plots);
  }

  return result;
}

/** True if endpoint host is loopback (browser = this machine, not the VPS). */
function endpointIsLoopback(endpoint: string): boolean {
  try {
    const u = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`);
    const h = u.hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  } catch {
    return /localhost|127\.0\.0\.1/.test(endpoint);
  }
}

/** Page is served from a non-loopback host (e.g. VPS demo). */
function pageIsRemote(): boolean {
  if (typeof location === 'undefined') return false;
  const h = location.hostname.toLowerCase();
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '' && h !== '[::1]';
}

/** Probe Pro API health at current endpoint. */
export async function probeEndpoint(endpoint?: string): Promise<{ ok: boolean; message: string }> {
  const base = (endpoint || store.endpoint || '').replace(/\/$/, '');
  if (!base) {
    return { ok: false, message: 'No Backend URL set' };
  }

  const loopback = endpointIsLoopback(base);
  const remotePage = pageIsRemote();

  try {
    const res = await fetch(`${base}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
      mode: 'cors',
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} from ${base}` };
    const text = await res.text();
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { endpoints?: unknown; status?: unknown; service?: string };
      if (j.endpoints || j.status) {
        detail = j.service ? `Pro API reachable (${j.service})` : 'Pro API reachable';
      }
    } catch {
      /* plain text ok */
    }
    if (loopback && remotePage) {
      detail += ' · note: loopback API is on *this* PC, not the VPS';
    }
    return { ok: true, message: detail };
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e);
    const isNet =
      /networkerror|failed to fetch|load failed|network request failed/i.test(raw) ||
      (e instanceof TypeError && /fetch/i.test(raw));

    if (isNet && loopback) {
      return {
        ok: false,
        message:
          `Cannot reach ${base} (browser → this machine). ` +
          (remotePage
            ? 'AXIS is on a remote host: localhost is *your PC*, not the VPS. ' +
              'Start local pyne on :5002, or set Backend URL to the VPS API ' +
              '(e.g. http://162.254.38.194:5002).'
            : 'Is pyne Pro API running? (cd pyne && make run)'),
      };
    }
    if (isNet) {
      return {
        ok: false,
        message:
          `Cannot reach ${base}. Check: API process up, port open, firewall, ` +
          `CORS ALLOWED_ORIGINS includes this page origin (${typeof location !== 'undefined' ? location.origin : '?'}).`,
      };
    }
    if (/abort|timeout/i.test(raw)) {
      return { ok: false, message: `Timeout probing ${base} (8s)` };
    }
    return { ok: false, message: raw };
  }
}
