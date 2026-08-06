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
 * Built-in **historical OHLCV sources** for AXIS.
 *
 * Each source implements {@link SourcePlugin}: `fetchHistorical({ symbol, interval, config })`
 * → `Promise<Bar[]>`. Bars use **unix seconds** for `time`. Definitions live here;
 * registration and lookup go through the unified {@link registry}.
 *
 * ## Built-ins (UI order)
 *
 * | id | Network | Notes |
 * |----|---------|-------|
 * | `binance-rest` | yes | `GET /api/v3/klines`; optional synthetic fallback |
 * | `okx-rest` | yes | `GET /api/v5/market/candles` (BTCUSDT → BTC-USDT) |
 * | `bybit-rest` | yes | Bybit v5 spot klines |
 * | `coinbase-rest` | yes | Exchange candles (max ~300) |
 * | `mock-walk` | no | Synthetic random walk; optional deterministic seed |
 * | `csv-upload` | no | Last file from {@link upload-store} |
 * | `data-manager` | no | Local bars-cache from Data Source Manager |
 *
 * ## Public API
 *
 * - Plugin constants: {@link binanceRest}, {@link okxRest}, {@link bybitRest}, …
 * - {@link ensureSourcesRegistered}, {@link getSource}, {@link listSources}
 * - {@link registerDynamicSource} / {@link unregisterDynamicSource} — URL plugins
 *
 * @module sources/catalog
 * @see {@link SourcePlugin} in `plugins/types`
 */

import type { Bar } from '../store/types';
import type { ConfigSchema, SourcePlugin as UnifiedSourcePlugin } from '../plugins/types';
import { registry } from '../plugins/registry';
import { sanitizeBar } from '../data/parse-bars';
import {
  DATA_MANAGER_SOURCE_ID,
  dataManagerLabel,
  resolveDataManagerBars,
} from '../data/data-manager-source';
import { getUploadedBars } from './upload-store';

export type SourceConfigSchema = ConfigSchema;
/** @deprecated Prefer importing SourcePlugin from plugins/types */
export type SourcePlugin = UnifiedSourcePlugin;

function intervalToMs(iv: string): number {
  const m = /^(\d+)([mhdw])$/.exec(iv || '');
  if (!m) return 86400 * 1000;
  const n = parseInt(m[1], 10);
  const mult: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return n * (mult[m[2]] || 86_400_000);
}

function resolveConfig(
  schema: SourceConfigSchema | undefined,
  config?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(schema || {})) {
    out[k] = def && 'default' in def ? def.default : undefined;
  }
  for (const [k, v] of Object.entries(config || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Build a bar from venue fields; drop partial/NaN OHLCV so callers never see
 * poison candles. `time` may be seconds or milliseconds.
 */
function barFromFields(
  time: unknown,
  open: unknown,
  high: unknown,
  low: unknown,
  close: unknown,
  volume?: unknown,
): Bar | null {
  return sanitizeBar({
    time,
    open: typeof open === 'string' ? parseFloat(open) : open,
    high: typeof high === 'string' ? parseFloat(high) : high,
    low: typeof low === 'string' ? parseFloat(low) : low,
    close: typeof close === 'string' ? parseFloat(close) : close,
    volume:
      volume == null || volume === ''
        ? undefined
        : typeof volume === 'string'
          ? parseFloat(volume)
          : volume,
  });
}

/** Map array of raw venue rows → valid bars only (order preserved). */
function mapValidBars(
  rows: unknown[],
  mapRow: (row: unknown) => Bar | null,
): Bar[] {
  const out: Bar[] = [];
  for (const row of rows) {
    const b = mapRow(row);
    if (b) out.push(b);
  }
  return out;
}

/**
 * Synthetic walk. When `endTimeSec` is set, the newest bar sits at that
 * timestamp (walk-back pagination). Otherwise uses wall-clock now.
 */
function synthesizeWalk(
  n: number,
  interval: string,
  start: number,
  endTimeSec?: number,
): Bar[] {
  const step = Math.floor(intervalToMs(interval) / 1000);
  const out: Bar[] = [];
  let price = start;
  const end =
    typeof endTimeSec === 'number' && Number.isFinite(endTimeSec) && endTimeSec > 0
      ? Math.floor(endTimeSec)
      : Math.floor(Date.now() / 1000);
  for (let i = n - 1; i >= 0; i--) {
    const t = end - i * step;
    const drift = (Math.random() - 0.48) * price * 0.02;
    const open = price;
    const close = Math.max(0.01, price + drift);
    const high = Math.max(open, close) + Math.random() * price * 0.005;
    const low = Math.min(open, close) - Math.random() * price * 0.005;
    out.push({
      time: t,
      open,
      high,
      low,
      close,
      volume: 100 + Math.random() * 1000,
    });
    price = close;
  }
  return out;
}

/** Prefer job AbortSignal; else a 15s timeout so hung venues cannot stall forever. */
function fetchSignal(signal?: AbortSignal): AbortSignal {
  if (signal) return signal;
  return AbortSignal.timeout(15_000);
}

/** Append unix-sec bounds as venue ms query params when present. */
function appendTimeParams(
  params: URLSearchParams,
  opts: { startTime?: number; endTime?: number },
  mode: 'ms' | 'sec' = 'ms',
): void {
  const mult = mode === 'ms' ? 1000 : 1;
  if (typeof opts.startTime === 'number' && Number.isFinite(opts.startTime) && opts.startTime > 0) {
    params.set('startTime', String(Math.floor(opts.startTime * mult)));
  }
  if (typeof opts.endTime === 'number' && Number.isFinite(opts.endTime) && opts.endTime > 0) {
    params.set('endTime', String(Math.floor(opts.endTime * mult)));
  }
}

/** Page size caps used by the Data Source Manager walk-back loop. */
export function sourcePageLimit(sourceId: string): number {
  switch (sourceId) {
    case 'okx-rest':
      return 300;
    case 'coinbase-rest':
      return 280;
    case 'binance-rest':
    case 'bybit-rest':
      return 1000;
    case 'mock-walk':
      return 1000;
    default:
      return 500;
  }
}

export const binanceRest: SourcePlugin = {
  id: 'binance-rest',
  name: 'Binance REST',
  kind: 'source',
  builtIn: true,
  description:
    'Public Binance kline API (api.binance.com). Falls back to a synthetic walk if the network is unavailable.',
  capabilities: { needsNetwork: true },
  configSchema: {
    baseUrl: { type: 'string', default: 'https://api.binance.com', label: 'API base URL' },
    limit: { type: 'number', default: 500, min: 50, max: 1000, label: 'Bars' },
    fallback: { type: 'boolean', default: true, label: 'Synthesize on failure' },
  },
  async fetchHistorical({ symbol, interval, config, startTime, endTime, signal }) {
    const cfg = resolveConfig(this.configSchema, config);
    const baseUrl = String(cfg.baseUrl || 'https://api.binance.com');
    const limit = Math.min(1000, Number(cfg.limit) || 500);
    const params = new URLSearchParams({
      symbol: String(symbol || '').toUpperCase(),
      interval: String(interval || '1d'),
      limit: String(limit),
    });
    appendTimeParams(params, { startTime, endTime }, 'ms');
    const url = `${baseUrl}/api/v3/klines?${params}`;
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: fetchSignal(signal),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error('empty kline response');
      // Binance: [openTimeMs, o, h, l, c, volume, ...]
      const bars = mapValidBars(data, (row) => {
        if (!Array.isArray(row) || row.length < 5) return null;
        return barFromFields(row[0], row[1], row[2], row[3], row[4], row[5]);
      });
      if (!bars.length) throw new Error('empty kline response');
      return bars;
    } catch (err: unknown) {
      if (signal?.aborted) throw err;
      if (!cfg.fallback) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[binance-rest] Network error, falling back to synthetic data: ${msg}`);
      return synthesizeWalk(limit || 200, interval, 100, endTime);
    }
  },
};

export const mockWalk: SourcePlugin = {
  id: 'mock-walk',
  name: 'Mock Walk',
  kind: 'source',
  builtIn: true,
  description: 'Pure-synthetic random walk. Always available; deterministic seed optional.',
  capabilities: { offline: true },
  configSchema: {
    seed: { type: 'number', default: 0, label: 'Seed (0 = random)' },
    startPrice: { type: 'number', default: 100, label: 'Start price' },
    limit: { type: 'number', default: 500, min: 50, max: 5000, label: 'Bars' },
  },
  async fetchHistorical({ interval, config, endTime, startTime }) {
    const cfg = resolveConfig(this.configSchema, config);
    const limit = Number(cfg.limit) || 500;
    const startPrice = Number(cfg.startPrice) || 100;
    const seed = Number(cfg.seed) || 0;
    const endSec =
      typeof endTime === 'number' && Number.isFinite(endTime) && endTime > 0
        ? Math.floor(endTime)
        : Math.floor(Date.now() / 1000);
    // Optional window: clamp bar count so walk-back pages do not overshoot startTime
    let pageLimit = limit;
    if (typeof startTime === 'number' && Number.isFinite(startTime) && startTime > 0) {
      const step = Math.floor(intervalToMs(interval) / 1000) || 1;
      const spanBars = Math.floor((endSec - Math.floor(startTime)) / step) + 1;
      if (spanBars > 0) pageLimit = Math.min(limit, spanBars);
      if (pageLimit <= 0) return [];
    }
    if (seed) {
      let s = seed >>> 0;
      const rand = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const out: Bar[] = [];
      const step = Math.floor(intervalToMs(interval) / 1000);
      let price = startPrice;
      for (let i = pageLimit - 1; i >= 0; i--) {
        const t = endSec - i * step;
        const drift = (rand() - 0.48) * price * 0.02;
        const open = price;
        const close = Math.max(0.01, price + drift);
        const high = Math.max(open, close) + rand() * price * 0.005;
        const low = Math.min(open, close) - rand() * price * 0.005;
        out.push({
          time: t,
          open,
          high,
          low,
          close,
          volume: 100 + rand() * 1000,
        });
        price = close;
      }
      return out;
    }
    return synthesizeWalk(pageLimit, interval, startPrice, endSec);
  },
};

export const csvUpload: SourcePlugin = {
  id: 'csv-upload',
  name: 'CSV / JSON Upload',
  kind: 'source',
  builtIn: true,
  description:
    'Uses the last file the user uploaded (CSV with time,open,high,low,close[,volume] or JSON array).',
  capabilities: { offline: true },
  configSchema: {},
  async fetchHistorical() {
    const bars = getUploadedBars();
    if (!Array.isArray(bars) || !bars.length) {
      throw new Error('No uploaded file. Use Upload to pick a CSV/JSON file first.');
    }
    return bars;
  },
};

/**
 * Local OHLCV from the Data Source Manager bars-cache (IndexedDB / memory).
 * Pick a series in the datasets browser, or Load uses the best match for
 * the current symbol + interval.
 */
export const dataManagerSource: SourcePlugin = {
  id: DATA_MANAGER_SOURCE_ID,
  name: 'Data Manager (cache)',
  kind: 'source',
  builtIn: true,
  description:
    'Load OHLCV from the Data Source Manager local cache. Backfill offline series first, then select Load.',
  capabilities: { offline: true },
  configSchema: {},
  async fetchHistorical({ symbol, interval }) {
    const resolved = await resolveDataManagerBars(symbol, interval);
    if (!resolved?.bars?.length) {
      throw new Error(
        'No cached dataset for this symbol. Open Data Source Manager → Datasets, or run a backfill first.',
      );
    }
    void dataManagerLabel(resolved);
    return resolved.bars;
  },
};

/** Map AXIS intervals to OKX bar codes */
function okxBar(interval: string): string {
  const m: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1h': '1H',
    '4h': '4H',
    '1d': '1D',
    '1w': '1W',
  };
  return m[interval] || '1D';
}

/** BTCUSDT → BTC-USDT for OKX/Coinbase-style ids */
function dashPair(symbol: string, quote = 'USDT'): string {
  const s = symbol.toUpperCase().replace(/[-_/]/g, '');
  if (s.endsWith(quote)) return `${s.slice(0, -quote.length)}-${quote}`;
  if (s.endsWith('USD')) return `${s.slice(0, -3)}-USD`;
  return `${s}-${quote}`;
}

function bybitInterval(interval: string): string {
  const m: Record<string, string> = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
    '1w': 'W',
  };
  return m[interval] || 'D';
}

export const okxRest: SourcePlugin = {
  id: 'okx-rest',
  name: 'OKX REST',
  kind: 'source',
  builtIn: true,
  description: 'Public OKX candlesticks (www.okx.com). Symbol like BTCUSDT → BTC-USDT.',
  capabilities: { needsNetwork: true },
  configSchema: {
    limit: { type: 'number', default: 300, min: 50, max: 300, label: 'Bars' },
  },
  async fetchHistorical({ symbol, interval, config, endTime, signal }) {
    const cfg = resolveConfig(this.configSchema, config);
    const limit = Math.min(300, Number(cfg.limit) || 300);
    const instId = dashPair(symbol, 'USDT');
    const params = new URLSearchParams({
      instId,
      bar: okxBar(interval),
      limit: String(limit),
    });
    // OKX: `after` = older pagination cursor (request data older than this ts ms)
    if (typeof endTime === 'number' && Number.isFinite(endTime) && endTime > 0) {
      params.set('after', String(Math.floor(endTime * 1000)));
    }
    const url = `https://www.okx.com/api/v5/market/candles?${params}`;
    const res = await fetch(url, { cache: 'no-store', signal: fetchSignal(signal) });
    if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== '0' || !Array.isArray(json.data)) {
      throw new Error(json.msg || 'OKX empty response');
    }
    // OKX returns newest first: [ts, o, h, l, c, vol, ...]
    const newestFirst = mapValidBars(json.data, (row) => {
      if (!Array.isArray(row) || row.length < 5) return null;
      return barFromFields(row[0], row[1], row[2], row[3], row[4], row[5]);
    });
    const bars = newestFirst.reverse();
    if (!bars.length) throw new Error('OKX returned no candles');
    return bars;
  },
};

export const bybitRest: SourcePlugin = {
  id: 'bybit-rest',
  name: 'Bybit REST',
  kind: 'source',
  builtIn: true,
  description: 'Public Bybit v5 spot klines (api.bybit.com).',
  capabilities: { needsNetwork: true },
  configSchema: {
    limit: { type: 'number', default: 500, min: 50, max: 1000, label: 'Bars' },
  },
  async fetchHistorical({ symbol, interval, config, startTime, endTime, signal }) {
    const cfg = resolveConfig(this.configSchema, config);
    const limit = Math.min(1000, Number(cfg.limit) || 500);
    const sym = symbol.toUpperCase().replace(/[-_/]/g, '');
    const params = new URLSearchParams({
      category: 'spot',
      symbol: sym,
      interval: bybitInterval(interval),
      limit: String(limit),
    });
    if (typeof startTime === 'number' && Number.isFinite(startTime) && startTime > 0) {
      params.set('start', String(Math.floor(startTime * 1000)));
    }
    if (typeof endTime === 'number' && Number.isFinite(endTime) && endTime > 0) {
      params.set('end', String(Math.floor(endTime * 1000)));
    }
    const url = `https://api.bybit.com/v5/market/kline?${params}`;
    const res = await fetch(url, { cache: 'no-store', signal: fetchSignal(signal) });
    if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
    const json = await res.json();
    const list = json?.result?.list;
    if (json.retCode !== 0 || !Array.isArray(list)) {
      throw new Error(json.retMsg || 'Bybit empty response');
    }
    // newest first
    const newestFirst = mapValidBars(list, (row) => {
      if (!Array.isArray(row) || row.length < 5) return null;
      return barFromFields(row[0], row[1], row[2], row[3], row[4], row[5]);
    });
    const bars = newestFirst.reverse();
    if (!bars.length) throw new Error('Bybit returned no candles');
    return bars;
  },
};

export const coinbaseRest: SourcePlugin = {
  id: 'coinbase-rest',
  name: 'Coinbase REST',
  kind: 'source',
  builtIn: true,
  description: 'Coinbase Exchange public candles. Symbol BTCUSDT → BTC-USD.',
  capabilities: { needsNetwork: true },
  configSchema: {
    granularity: { type: 'number', default: 0, label: 'Override granularity (sec, 0=auto)' },
  },
  async fetchHistorical({ symbol, interval, startTime, endTime, signal, config }) {
    const product = dashPair(symbol.replace(/USDT$/i, 'USD'), 'USD');
    const granMap: Record<string, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
      '1w': 604800,
    };
    const gran = granMap[interval] || 86400;
    // Coinbase returns max ~300 candles; request a window ending at endTime
    const end =
      typeof endTime === 'number' && Number.isFinite(endTime) && endTime > 0
        ? Math.floor(endTime)
        : Math.floor(Date.now() / 1000);
    const start =
      typeof startTime === 'number' && Number.isFinite(startTime) && startTime > 0
        ? Math.floor(startTime)
        : end - gran * 280;
    // Cap span so we stay within venue page size
    const cappedStart = Math.max(start, end - gran * 280);
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${gran}&start=${new Date(cappedStart * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    void config;
    const res = await fetch(url, { cache: 'no-store', signal: fetchSignal(signal) });
    if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('Coinbase empty response');
    // [time, low, high, open, close, volume] newest first — note field order
    const bars = mapValidBars(data, (row) => {
      if (!Array.isArray(row) || row.length < 5) return null;
      // Coinbase: time, low, high, open, close, volume
      return barFromFields(row[0], row[3], row[2], row[1], row[4], row[5]);
    }).sort((a, b) => a.time - b.time);
    if (!bars.length) throw new Error('Coinbase empty response');
    return bars;
  },
};

/** Built-in sources in UI order */
export const BUILTIN_SOURCES: SourcePlugin[] = [
  binanceRest,
  okxRest,
  bybitRest,
  coinbaseRest,
  mockWalk,
  csvUpload,
  dataManagerSource,
];

let registered = false;

/** Idempotent registration of {@link BUILTIN_SOURCES} into the unified registry. */
export function ensureSourcesRegistered(): void {
  if (registered) return;
  registered = true;
  for (const s of BUILTIN_SOURCES) {
    if (!registry.getSource(s.id)) {
      registry.registerSource(s);
    }
  }
}

/** Look up a source by id (ensures built-ins are registered). */
export function getSource(id: string): SourcePlugin | undefined {
  ensureSourcesRegistered();
  return registry.getSource(id);
}

/** All registered sources in registration order. */
export function listSources(): SourcePlugin[] {
  ensureSourcesRegistered();
  return registry.listSources();
}

/** Register a runtime plugin source (dynamic URL loader). */
export function registerDynamicSource(source: SourcePlugin): void {
  ensureSourcesRegistered();
  if (!source?.id || source.kind !== 'source') {
    throw new Error('Invalid source plugin');
  }
  if (typeof source.fetchHistorical !== 'function') {
    throw new Error('Source must implement fetchHistorical');
  }
  registry.registerSource({ ...source, builtIn: source.builtIn ?? false });
}

export function unregisterDynamicSource(id: string): void {
  ensureSourcesRegistered();
  registry.unregisterSource(id);
}

export function listDynamicSourceIds(): string[] {
  ensureSourcesRegistered();
  return registry.listSources().filter((s) => !s.builtIn).map((s) => s.id);
}

/** @internal test helper */
export function _resetSourceRegistrationFlag() {
  registered = false;
}
