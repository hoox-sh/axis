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
 * | `kraken-rest` | yes | Public OHLC |
 * | `mexc-rest` | yes | `GET /api/v3/klines` (Binance-shaped; `1h` → `60m`) |
 * | `geckoterminal-ohlcv` | yes | DEX pool OHLCV via GeckoTerminal (`network:0xPool`) |
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
  getDataManagerSelection,
  resolveDataManagerBars,
} from '../data/data-manager-source';
import { sliceBarsForLoad } from '../data/bars-cache';
import { expandCachedSeriesToNow } from '../data/expand-cache';
import { getUploadedBars } from './upload-store';
import { fetchBinanceJson } from '../data/binance-http';
import { fetchMexcJson } from '../data/mexc-http';
import { mexcKlineInterval, mexcSpotSymbol } from '../data/venues/mexc';

/** Parsed DEX pool id for {@link geckoTerminalOhlcv}. */
export interface GeckoPoolRef {
  network: string;
  poolAddress: string;
}

/**
 * Normalize GeckoTerminal network ids (common aliases → API slug).
 * e.g. `ethereum` → `eth`, `polygon` → `polygon_pos`.
 */
export function normalizeGeckoNetwork(network: string): string {
  const n = String(network || '')
    .trim()
    .toLowerCase();
  if (!n) return 'eth';
  const aliases: Record<string, string> = {
    ethereum: 'eth',
    ether: 'eth',
    mainnet: 'eth',
    bnb: 'bsc',
    'binance-smart-chain': 'bsc',
    binancesmartchain: 'bsc',
    matic: 'polygon_pos',
    polygon: 'polygon_pos',
    'polygon-pos': 'polygon_pos',
    avax: 'avax',
    avalanche: 'avax',
    arb: 'arbitrum',
    'arbitrum-one': 'arbitrum',
    'arbitrum one': 'arbitrum',
  };
  return aliases[n] || n;
}

/**
 * Parse AXIS DEX symbol forms into `{ network, poolAddress }`.
 *
 * Supported:
 * 1. `eth:0x…` or `ethereum:0xPool` (optional trailing label after address)
 * 2. `network/0x…`
 * 3. bare `0x` address → `defaultNetwork` (config.network, usually `eth`)
 *
 * Also accepts Solana-style base58 addresses after `network:` / `network/`.
 */
export function parseGeckoPoolSymbol(
  symbol: string,
  defaultNetwork = 'eth',
): GeckoPoolRef {
  const raw = String(symbol || '').trim();
  if (!raw) {
    throw new Error(
      'GeckoTerminal: symbol is required (e.g. eth:0x… or network/0xPoolAddress)',
    );
  }

  // EVM 0x + optional Solana base58 pool addresses
  const addrBody = '0x[a-fA-F0-9]{6,}|[1-9A-HJ-NP-Za-km-z]{32,44}';

  // Form 1: network:address [optional name…]
  const colon = new RegExp(
    `^([a-zA-Z0-9_-]+)\\s*:\\s*(${addrBody})\\b`,
  ).exec(raw);
  if (colon) {
    return {
      network: normalizeGeckoNetwork(colon[1]),
      poolAddress: colon[2],
    };
  }

  // Form 2: network/address [optional name…]
  const slash = new RegExp(
    `^([a-zA-Z0-9_-]+)\\s*/\\s*(${addrBody})\\b`,
  ).exec(raw);
  if (slash) {
    return {
      network: normalizeGeckoNetwork(slash[1]),
      poolAddress: slash[2],
    };
  }

  // Form 3: bare EVM address
  const bareEvm = /^(0x[a-fA-F0-9]{40})\b/i.exec(raw);
  if (bareEvm) {
    return {
      network: normalizeGeckoNetwork(defaultNetwork),
      poolAddress: bareEvm[1],
    };
  }

  throw new Error(
    `GeckoTerminal: cannot parse symbol "${raw}". ` +
      'Use network:0xPool, network/0xPool, or a bare 0x address ' +
      '(default network from source config).',
  );
}

type GeckoTerminalModule = {
  fetchGeckoPoolOhlcv: (opts: {
    network: string;
    poolAddress: string;
    interval: string;
    limit?: number;
    endTime?: number;
    startTime?: number;
    signal?: AbortSignal;
    baseUrl?: string;
  }) => Promise<Bar[]>;
  searchGeckoPools?: (
    query: string,
    opts?: {
      limit?: number;
      signal?: AbortSignal;
      baseUrl?: string;
      network?: string;
    },
  ) => Promise<
    Array<
      | string
      | {
          network: string;
          address: string;
          name?: string;
          symbol?: string;
        }
    >
  >;
};

/**
 * Lazy-load `onchain/geckoterminal` so registration works while that module
 * is mid-land. Throws a clear rebuild hint if the client is missing.
 */
async function loadGeckoTerminal(): Promise<GeckoTerminalModule> {
  try {
    // Static specifier so Vite can split the chunk when the file exists.
    const mod = (await import('../onchain/geckoterminal')) as GeckoTerminalModule & {
      default?: GeckoTerminalModule;
    };
    const fetchFn = mod.fetchGeckoPoolOhlcv ?? mod.default?.fetchGeckoPoolOhlcv;
    if (typeof fetchFn !== 'function') {
      throw new Error('export fetchGeckoPoolOhlcv not found');
    }
    const searchFn = mod.searchGeckoPools ?? mod.default?.searchGeckoPools;
    return {
      fetchGeckoPoolOhlcv: fetchFn.bind(mod.default ?? mod),
      searchGeckoPools:
        typeof searchFn === 'function'
          ? searchFn.bind(mod.default ?? mod)
          : undefined,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      'GeckoTerminal client missing (src/onchain/geckoterminal). ' +
        'Rebuild/sync after the on-chain data-plane agent lands that module. ' +
        `(${detail})`,
    );
  }
}

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
    case 'mexc-rest':
    case 'geckoterminal-ohlcv':
      return 1000;
    case 'kraken-rest':
      return 720;
    case 'mock-walk':
      return 1000;
    case 'ccxt-rest':
      return 500;
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
    'Public Binance kline API with host + Worker proxy fallback. Optional synthetic walk only when fallback is enabled.',
  capabilities: { needsNetwork: true, venue: 'binance', market: 'spot', transport: 'rest' },
  configSchema: {
    baseUrl: {
      type: 'string',
      default: 'https://api.binance.com',
      label: 'API base URL',
      advanced: true,
      hidden: true,
    },
    limit: {
      type: 'number',
      default: 500,
      min: 50,
      max: 1000,
      label: 'Bars',
      advanced: true,
      hidden: true,
    },
    fallback: {
      type: 'boolean',
      default: false,
      label: 'Synthesize on failure',
      advanced: true,
      description: 'Demo only — fake prices. Off by default so a network error cannot look like real data.',
    },
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
    try {
      const data = await fetchBinanceJson({
        path: 'klines',
        query: params.toString(),
        baseUrl,
        signal: fetchSignal(signal),
      });
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
  capabilities: { offline: true, venue: 'mock', transport: 'local' },
  configSchema: {
    seed: { type: 'number', default: 0, label: 'Seed (0 = random)' },
    startPrice: { type: 'number', default: 100, label: 'Start price', advanced: true },
    limit: { type: 'number', default: 500, min: 50, max: 100_000, label: 'Bars', advanced: true, hidden: true },
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
  capabilities: { offline: true, venue: 'upload', transport: 'local' },
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
 * Pick a series in the Dataset manager (optional date range / max bars), or
 * Load uses the best match for the current symbol + interval.
 */
export const dataManagerSource: SourcePlugin = {
  id: DATA_MANAGER_SOURCE_ID,
  name: 'Data Manager (cache)',
  kind: 'source',
  builtIn: true,
  description:
    'Load OHLCV from the Data Source Manager local cache, then auto-fill the gap to now via the venue REST source. Live uses the matching exchange stream and expands the dataset.',
  // Offline cache read; network used only to close cache→now when venue is available
  capabilities: { offline: true, needsNetwork: true, venue: 'cache', transport: 'local' },
  configSchema: {},
  async fetchHistorical({ symbol, interval, signal }) {
    const resolved = await resolveDataManagerBars(symbol, interval);
    if (!resolved?.bars?.length) {
      throw new Error(
        'No cached dataset for this symbol. Open Data Source Manager → Dataset manager, or run a backfill first.',
      );
    }
    void dataManagerLabel(resolved);

    // Close gap from cache newest → now; merge into bars-cache (dataset expands)
    let bars = resolved.bars;
    try {
      const exp = await expandCachedSeriesToNow(
        resolved.sourceId,
        resolved.symbol,
        resolved.interval,
        { signal },
      );
      if (exp.bars.length) bars = exp.bars;
    } catch {
      /* keep cached bars if expand fails (offline) */
    }

    // Honour from + maxBars from selection; open upper bound after expand
    const sel = getDataManagerSelection();
    if (sel && (sel.fromSec != null || sel.maxBars != null)) {
      bars = sliceBarsForLoad(bars, {
        fromSec: sel.fromSec,
        maxBars: sel.maxBars,
      });
    }
    return bars;
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
  capabilities: { needsNetwork: true, venue: 'okx', market: 'spot', transport: 'rest' },
  configSchema: {
    limit: { type: 'number', default: 300, min: 50, max: 300, label: 'Bars', advanced: true, hidden: true },
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
  capabilities: { needsNetwork: true, venue: 'bybit', market: 'spot', transport: 'rest' },
  configSchema: {
    limit: { type: 'number', default: 500, min: 50, max: 1000, label: 'Bars', advanced: true, hidden: true },
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
  capabilities: { needsNetwork: true, venue: 'coinbase', market: 'spot', transport: 'rest' },
  configSchema: {
    granularity: {
      type: 'number',
      default: 0,
      label: 'Override granularity (sec, 0=auto)',
      advanced: true,
    },
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

function krakenPair(symbol: string): string {
  const s = String(symbol || '').toUpperCase().replace(/[-_/]/g, '');
  let base = s;
  let quote = 'USD';
  if (s.endsWith('USDT')) {
    base = s.slice(0, -4);
    quote = 'USDT';
  } else if (s.endsWith('USD')) {
    base = s.slice(0, -3);
    quote = 'USD';
  }
  if (base === 'BTC') base = 'XBT';
  return `${base}${quote}`;
}

function krakenIntervalMin(interval: string): number {
  const m: Record<string, number> = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
    '1w': 10080,
  };
  return m[interval] || 1440;
}

export const krakenRest: SourcePlugin = {
  id: 'kraken-rest',
  name: 'Kraken REST',
  kind: 'source',
  builtIn: true,
  description: 'Public Kraken OHLC (api.kraken.com). BTCUSDT → XBTUSDT.',
  capabilities: { needsNetwork: true, venue: 'kraken', market: 'spot', transport: 'rest' },
  configSchema: {
    limit: { type: 'number', default: 720, min: 50, max: 720, label: 'Bars', advanced: true, hidden: true },
  },
  async fetchHistorical({ symbol, interval, config, startTime, endTime, signal }) {
    const cfg = resolveConfig(this.configSchema, config);
    const pair = krakenPair(symbol);
    const iv = krakenIntervalMin(interval);
    const params = new URLSearchParams({
      pair,
      interval: String(iv),
    });
    const url = `https://api.kraken.com/0/public/OHLC?${params}`;
    const res = await fetch(url, { cache: 'no-store', signal: fetchSignal(signal) });
    if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
    const json = await res.json();
    if (Array.isArray(json?.error) && json.error.length) {
      throw new Error(`Kraken: ${json.error.join(', ')}`);
    }
    const result = json?.result && typeof json.result === 'object' ? json.result : {};
    let rows: unknown[] = [];
    for (const [k, v] of Object.entries(result)) {
      if (k === 'last') continue;
      if (Array.isArray(v)) {
        rows = v;
        break;
      }
    }
    if (!rows.length) throw new Error('Kraken returned no candles');
    const lo =
      typeof startTime === 'number' && Number.isFinite(startTime) && startTime > 0
        ? Math.floor(startTime)
        : null;
    const hi =
      typeof endTime === 'number' && Number.isFinite(endTime) && endTime > 0
        ? Math.floor(endTime)
        : null;
    const limit = Math.min(720, Number(cfg.limit) || 720);
    const bars = mapValidBars(rows, (row) => {
      if (!Array.isArray(row) || row.length < 6) return null;
      const t = Math.floor(Number(row[0]));
      if (lo != null && t < lo) return null;
      if (hi != null && t > hi) return null;
      return barFromFields(row[0], row[1], row[2], row[3], row[4], row[6]);
    }).sort((a, b) => a.time - b.time);
    if (!bars.length) throw new Error('Kraken returned no candles');
    return bars.length > limit ? bars.slice(-limit) : bars;
  },
};

export const mexcRest: SourcePlugin = {
  id: 'mexc-rest',
  name: 'MEXC REST',
  kind: 'source',
  builtIn: true,
  description:
    'Public MEXC spot klines (api.mexc.com). Binance-shaped arrays; 1h is interval 60m.',
  capabilities: { needsNetwork: true, venue: 'mexc', market: 'spot', transport: 'rest' },
  configSchema: {
    limit: {
      type: 'number',
      default: 500,
      min: 50,
      max: 1000,
      label: 'Bars',
      advanced: true,
      hidden: true,
    },
  },
  async fetchHistorical({ symbol, interval, config, startTime, endTime, signal }) {
    const cfg = resolveConfig(this.configSchema, config);
    const limit = Math.min(1000, Number(cfg.limit) || 500);
    const params = new URLSearchParams({
      symbol: mexcSpotSymbol(symbol),
      interval: mexcKlineInterval(interval),
      limit: String(limit),
    });
    appendTimeParams(params, { startTime, endTime }, 'ms');
    const json = await fetchMexcJson({
      path: 'klines',
      query: params.toString(),
      signal: fetchSignal(signal),
    });
    if (!Array.isArray(json)) {
      const msg =
        json && typeof json === 'object' && 'msg' in json
          ? String((json as { msg?: unknown }).msg || 'MEXC empty response')
          : 'MEXC empty response';
      throw new Error(msg);
    }
    const bars = mapValidBars(json, (row) => {
      if (!Array.isArray(row) || row.length < 6) return null;
      return barFromFields(row[0], row[1], row[2], row[3], row[4], row[5]);
    });
    if (!bars.length) throw new Error('MEXC returned no candles');
    return bars;
  },
};

/**
 * DEX pool OHLCV via GeckoTerminal public API.
 *
 * **Symbol forms** (see {@link parseGeckoPoolSymbol}):
 * - `eth:0x…` / `ethereum:0xPool` — network + pool address (optional label suffix)
 * - `base/0x…` — slash form
 * - bare `0x…` — uses `config.network` (default `eth`)
 *
 * **Pagination:** one request max **1000** candles. `endTime` (unix sec) maps to
 * Gecko `before_timestamp` — bars strictly before that time. Deep history is
 * **not** multi-page inside this method; use Data Source Manager walk-back
 * (page-by-page `endTime`) for ranges beyond one page.
 *
 * Empty `baseUrl` → Worker proxy when the geckoterminal client resolves it.
 * Live stream: pair with `mock-poll` until a DEX WS exists (Phase 2).
 */
export const geckoTerminalOhlcv: SourcePlugin = {
  id: 'geckoterminal-ohlcv',
  name: 'GeckoTerminal DEX',
  kind: 'source',
  description:
    'DEX pool OHLCV via GeckoTerminal (network:poolAddress symbol). Browser CORS usually needs the AXIS Worker proxy. Max 1000 bars/request; deep history via Data Sources walk-back.',
  builtIn: true,
  capabilities: { needsNetwork: true, needsProxy: true, venue: 'gecko', transport: 'rest' },
  configSchema: {
    baseUrl: {
      type: 'string',
      default: '',
      label: 'API base (empty = Worker proxy)',
      description:
        'Empty = use AXIS Worker on-chain proxy when available. Override with https://api.geckoterminal.com/api/v2 or a custom proxy.',
      placeholder: '{endpoint}/api/onchain/gecko',
      advanced: true,
    },
    network: {
      type: 'string',
      default: 'eth',
      label: 'Default network',
      description: 'Used when the symbol is a bare 0x pool address (e.g. eth, base, solana, bsc).',
      advanced: true,
    },
  },
  async fetchHistorical({
    symbol,
    interval,
    limit,
    endTime,
    startTime,
    signal,
    config,
  }) {
    const cfg = resolveConfig(this.configSchema, config);
    const defaultNetwork = String(cfg.network || 'eth');
    const { network, poolAddress } = parseGeckoPoolSymbol(symbol, defaultNetwork);
    const baseUrl = String(cfg.baseUrl ?? '');
    // Gecko hard max is 1000 candles per request (matches sourcePageLimit).
    const pageLimit =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0
        ? Math.min(1000, Math.floor(limit))
        : sourcePageLimit('geckoterminal-ohlcv');

    const gecko = await loadGeckoTerminal();
    const bars = await gecko.fetchGeckoPoolOhlcv({
      network,
      poolAddress,
      interval: String(interval || '1h'),
      limit: pageLimit,
      // DSM walk-back: endTime → before_timestamp (bars strictly before)
      endTime,
      startTime,
      signal: fetchSignal(signal),
      baseUrl: baseUrl || undefined,
    });
    if (!Array.isArray(bars) || !bars.length) {
      throw new Error(
        `GeckoTerminal: no candles for ${network}:${poolAddress} (${interval || '1h'})`,
      );
    }
    // Ensure ascending by open time (client already sorts; defensive for DSM merge)
    if (bars.length >= 2 && bars[0]!.time > bars[bars.length - 1]!.time) {
      return bars.slice().sort((a, b) => a.time - b.time);
    }
    return bars;
  },
  async searchSymbols(query, config) {
    const q = String(query || '').trim();
    if (!q) return [];
    const cfg = resolveConfig(this.configSchema, config);
    const gecko = await loadGeckoTerminal();
    if (typeof gecko.searchGeckoPools !== 'function') {
      return [];
    }
    const hits = await gecko.searchGeckoPools(q, {
      baseUrl: String(cfg.baseUrl || '') || undefined,
      network: String(cfg.network || 'eth'),
      limit: 20,
    });
    if (!Array.isArray(hits)) return [];
    return hits
      .map((hit) => {
        if (typeof hit === 'string') return hit.trim();
        if (!hit || typeof hit !== 'object') return '';
        const network = normalizeGeckoNetwork(hit.network || String(cfg.network || 'eth'));
        const address = String(hit.address || '').trim();
        if (!address) return '';
        const label = String(hit.name || hit.symbol || '').trim();
        return label ? `${network}:${address} ${label}` : `${network}:${address}`;
      })
      .filter(Boolean);
  },
};

/**
 * CCXT long-tail exchange OHLCV via datafeed gateway (PYNE or sidecar).
 * Routes through `src/data/gateway.ts` — credentials stay server-side.
 */
export const ccxtRest: SourcePlugin = {
  id: 'ccxt-rest',
  name: 'CCXT (Gateway)',
  kind: 'source',
  builtIn: true,
  description: 'Long-tail exchange OHLCV via datafeed gateway (PYNE or sidecar).',
  capabilities: { needsNetwork: true, venue: 'generic', market: 'spot', transport: 'rest' },
  configSchema: {
    exchange: { type: 'string', default: '', label: 'Exchange ID', description: 'CCXT exchange id (bybit, bitget, ...)' },
    gateway: {
      type: 'select',
      default: 'auto',
      label: 'Gateway',
      options: ['auto', 'pyne', 'sidecar'],
      description: 'auto | pyne | sidecar — transport for long-tail venues',
      advanced: true,
    },
  },
  async fetchHistorical({ symbol, interval, limit, endTime, config }) {
    const { gatewayFetch } = await import('../data/gateway');
    const { bindCcxtSession } = await import('../data/ccxt-session');
    const cfg = resolveConfig(this.configSchema, config);
    const exchange = String(cfg.exchange || '').trim();
    if (!exchange) throw new Error('ccxt-rest: exchange id not configured (source settings)');
    const gatewayMode = (String(cfg.gateway || 'auto') as 'auto' | 'pyne' | 'sidecar');
    const cred = await bindCcxtSession(gatewayMode, exchange);
    const params: Record<string, string> = {
      exchange,
      symbol,
      timeframe: interval,
    };
    if (cred) params.cred = cred;
    // Walk-back contract: endTime is the window's right edge. CCXT pages
    // forward from `since`, so derive since = endTime − limit·tf to fetch
    // the page of bars ending at/before endTime (DSM walk-back convergence).
    if (typeof endTime === 'number' && Number.isFinite(endTime) && endTime > 0) {
      const tfMs = intervalToMs(interval);
      const pageSize = limit && Number.isFinite(limit) && limit > 0 ? limit : sourcePageLimit(this.id);
      const since = Math.max(0, Math.floor(endTime * 1000 - pageSize * tfMs));
      params.since = String(since);
    }
    if (limit) params.limit = String(limit);
    const res = await gatewayFetch(gatewayMode, '/ohlcv', params);
    if (!res.ok) throw new Error(`Gateway ohlcv ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('Gateway returned non-array');
    return mapValidBars(json, (row: unknown) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      return barFromFields(r.time, r.open, r.high, r.low, r.close, r.volume);
    });
  },
};

/** Built-in sources in UI order */
export const BUILTIN_SOURCES: SourcePlugin[] = [
  binanceRest,
  okxRest,
  bybitRest,
  coinbaseRest,
  krakenRest,
  mexcRest,
  geckoTerminalOhlcv,
  ccxtRest,
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
