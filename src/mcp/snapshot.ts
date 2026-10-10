/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Sanitized live-app snapshot for MCP `app.get` / `app.snapshot`.
 * Omits secrets (API keys, exchange credentials, plugin passwords) and
 * truncates OHLCV to a summary unless `includeBars` is set.
 *
 * @module mcp/snapshot
 */

import { store, loadEditorDoc, listRunResultOptions } from '../store';
import { getPanelChrome, isPanelOpen } from '../store';
import { PANEL_IDS } from '../ui/panels/panel-manager';
import { registry } from '../plugins/registry';
import { getActiveEngineId, getActiveSourceId, getActiveStorageId, getActiveStreamId } from '../plugins/active';
import { loadAlerts } from '../alerts';

const SECRET_KEY = /(apiKey|secret|passphrase|token|password|authorization|cookie)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (Array.isArray(value)) {
    return value.length > 50 ? `[array ${value.length}]` : value.map((v) => redact(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) {
        out[k] = typeof v === 'string' && v ? '[redacted]' : v ? '[redacted]' : v;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 4000) {
    return `${value.slice(0, 4000)}…[${value.length} chars]`;
  }
  return value;
}

/** Cap for `includeBars` payloads (F9: bounded, newest-last). */
export const MCP_SNAPSHOT_BARS_MAX = 300;

/** Summary strip used when `includeBars` is false (and by `chart.get`). */
export function barSummary(bars: Array<{ time?: number; close?: number }>) {
  const n = bars.length;
  const first = n ? bars[0] : null;
  const last = n ? bars[n - 1] : null;
  return {
    count: n,
    firstTime: first?.time ?? null,
    lastTime: last?.time ?? null,
    lastClose: last?.close ?? null,
  };
}

/** Bounded newest-last plain OHLCV rows for `includeBars: true` (F9). */
export function boundedBarRows(
  bars: Array<{
    time?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  }>,
  max: number = MCP_SNAPSHOT_BARS_MAX,
): Array<Record<string, number | null>> {
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : MCP_SNAPSHOT_BARS_MAX;
  const tail = bars.length > cap ? bars.slice(-cap) : bars;
  return tail.map((b) => ({
    time: typeof b.time === 'number' && Number.isFinite(b.time) ? b.time : null,
    open: typeof b.open === 'number' && Number.isFinite(b.open) ? b.open : null,
    high: typeof b.high === 'number' && Number.isFinite(b.high) ? b.high : null,
    low: typeof b.low === 'number' && Number.isFinite(b.low) ? b.low : null,
    close: typeof b.close === 'number' && Number.isFinite(b.close) ? b.close : null,
    ...(typeof b.volume === 'number' && Number.isFinite(b.volume) ? { volume: b.volume } : {}),
  }));
}

function lastRunSummary(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const plots = r.plots;
  const plotKeys = plots && typeof plots === 'object' ? Object.keys(plots as object).slice(0, 40) : [];
  return {
    ok: r.ok ?? r.status ?? null,
    error: r.error ?? r.message ?? null,
    plotKeys,
    strategy: r.strategy ?? r.stats ?? null,
    alerts: Array.isArray(r.alerts) ? (r.alerts as unknown[]).length : undefined,
    logs: Array.isArray(r.logs) ? (r.logs as unknown[]).length : undefined,
  };
}

/** Sanitized app settings for MCP `settings.get` (never includes secrets). */
export function buildSettingsSnapshot(): Record<string, unknown> {
  return {
    endpoint: store.endpoint,
    engine: store.engine,
    interval: store.interval,
    historyBars: store.historyBars,
    refreshSec: store.watchlist?.refreshSec ?? null,
    live: {
      preferAfterLoad: store.live?.preferAfterLoad ?? null,
      rerunOn: store.live?.rerunOn ?? null,
    },
    uiScale: store.uiScale,
    autoload: store.autoload,
    priceScaleLabelsVisible: store.priceScaleLabelsVisible,
    lastValueLabelsVisible: store.lastValueLabelsVisible,
    lastValueNamesVisible: store.lastValueNamesVisible,
    strategyUi: store.strategyUi
      ? {
          slippageNextOpen: !!store.strategyUi.slippageNextOpen,
          invertTradeLabels: !!store.strategyUi.invertTradeLabels,
          exactOnCandle: store.strategyUi.exactOnCandle !== false,
        }
      : null,
    telemetry: store.telemetry
      ? {
          hudCompact: !!store.telemetry.hud?.compact,
          shareOnError: !!store.telemetry.shareOnError,
        }
      : null,
  };
}

/** Build a JSON-safe snapshot of the live AXIS session. */
export function buildAppSnapshot(opts: { includeBars?: boolean } = {}): Record<string, unknown> {
  const bars = store.bars || [];
  const scripts = (store.scripts || []).map((s) => ({
    id: s.id,
    name: s.name,
    paneId: s.paneId,
    visible: s.visible,
    codeChars: s.code ? s.code.length : 0,
  }));
  const panels: Record<string, unknown> = {};
  for (const id of PANEL_IDS) {
    const chrome = getPanelChrome(id);
    panels[id] = { open: isPanelOpen(id), dock: chrome.dock };
  }
  const alerts = loadAlerts().map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    symbol: a.symbol,
    kind: a.kind,
    interval: a.interval ?? null,
  }));

  const snap: Record<string, unknown> = {
    symbol: store.symbol,
    interval: store.interval,
    exchange: store.exchange,
    source: store.source,
    engine: store.engine,
    chartType: store.chartType,
    theme: store.theme,
    uiScale: store.uiScale,
    status: store.status,
    statusMessage: store.statusMessage,
    live: {
      active: store.live?.active ?? false,
      streamId: store.live?.streamId ?? null,
      preferAfterLoad: store.live?.preferAfterLoad ?? null,
    },
    activePlugins: {
      source: getActiveSourceId(),
      stream: getActiveStreamId(),
      engine: getActiveEngineId(),
      storage: getActiveStorageId(),
      dataset: store.activePlugins?.dataset || '',
    },
    chartLayout: store.chartLayout
      ? { mode: store.chartLayout.mode, activeId: store.chartLayout.activeId, slotCount: store.chartLayout.slots?.length }
      : null,
    chartTheme: store.chartTheme ? { presetId: store.chartTheme.presetId } : null,
    scripts,
    panes: (store.panes || []).map((p) => ({ id: p.id, type: p.type, visible: p.visible, height: p.height })),
    editor: {
      open: store.editor?.open ?? false,
      mode: store.editor?.mode ?? 'docked',
      docChars: loadEditorDoc().length,
      doc: loadEditorDoc(),
    },
    watchlist: {
      open: store.watchlist?.open ?? false,
      activeId: store.watchlist?.activeId,
      symbols: [...(store.watchlist?.symbols || [])],
      lists: (store.watchlist?.lists || []).map((l) => ({ id: l.id, name: l.name, count: l.symbols.length })),
    },
    drawings: {
      count: store.drawings?.length ?? 0,
      tool: store.drawingTool,
      selectedId: store.selectedDrawingId ?? null,
    },
    settings: buildSettingsSnapshot(),
    panels,
    alerts,
    logs: (store.logs || []).slice(-50).map((l) => ({
      id: l.id,
      ts: l.ts,
      level: l.level,
      message: l.message,
      source: l.source,
    })),
    lastRun: lastRunSummary(store.lastRun),
    runResults: listRunResultOptions().slice(0, 20),
    plugins: registry.summary(),
    telemetry: store.telemetry
      ? {
          source: store.telemetry.source?.state,
          stream: store.telemetry.stream?.state,
          engine: store.telemetry.engine?.state,
          storage: store.telemetry.storage?.state,
          onchain: store.telemetry.onchain?.state,
        }
      : null,
    compare: store.compare
      ? { enabled: store.compare.enabled, symbol: store.compare.symbol, mode: store.compare.mode }
      : null,
  };
  const redacted = redact(snap) as Record<string, unknown>;
  // F9: bars bypass the generic redact array cap (`[array N]` above 50) —
  // summaries stay summaries, and full bars are bounded newest-last rows.
  redacted.bars = opts.includeBars ? boundedBarRows(bars) : barSummary(bars);
  return redacted;
}
