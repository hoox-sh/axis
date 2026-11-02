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
 * HistoryClient — fetch OHLCV from the local axis-datafeed sidecar (PR-06b).
 *
 * Contract: `GET {base}/datafeed/ohlcv?exchange=&symbol=&timeframe=&since=&limit=`
 * Default base: `http://127.0.0.1:5003`. Injectable `fetch` for unit tests.
 */

import { checkHttpBaseUrl, type EndpointCheck } from '../run/endpoint';
import { MOCK_BARS_CAP, type OhlcvBar } from './mock-bars';
import { pairFormSymbol } from './series-key';

export const DEFAULT_DATAFEED_URL = 'http://127.0.0.1:5003';

export const REMOTE_DATAFEED_DENIED =
  'AXIS datafeed URL must be loopback (127.0.0.1 / localhost / ::1) unless axis.engine.allowRemoteEndpoint is enabled.';

/** Fetch subset used by HistoryClient (globalThis.fetch-compatible). */
export type HistoryFetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface FetchHistoricalRequest {
  exchange: string;
  /** Prefer pair-form (`BTC/USDT`); load-form is pair-formed before the query. */
  symbol: string;
  timeframe: string;
  /** Unix ms (CCXT `since`); omit for most-recent window. */
  since?: number;
  limit?: number;
  /** `axis.datafeed.url` (default loopback :5003). */
  baseUrl?: string;
  /** Reuse engine remote opt-in (`axis.engine.allowRemoteEndpoint`). */
  allowRemote?: boolean;
  fetchImpl?: HistoryFetchLike;
  signal?: AbortSignal;
}

export type FetchHistoricalResult =
  | { ok: true; bars: OhlcvBar[]; endpoint: string }
  | { ok: false; error: string };

/**
 * Normalize and gate the datafeed base URL (same loopback posture as engine).
 */
export function checkDatafeedUrl(
  raw: string | undefined | null,
  opts?: { allowRemote?: boolean },
): EndpointCheck {
  const result = checkHttpBaseUrl(raw, {
    allowRemote: opts?.allowRemote,
    defaultUrl: DEFAULT_DATAFEED_URL,
    label: 'datafeed',
  });
  if (!result.ok && result.error.includes('unless axis.engine.allowRemoteEndpoint')) {
    return { ok: false, error: REMOTE_DATAFEED_DENIED };
  }
  return result;
}

/** Map one datafeed / unknown row into IDE `{ time, open, high, low, close, volume }` (unix seconds). */
export function mapDatafeedBar(raw: unknown): OhlcvBar | null {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const time = Number(r.time);
    const open = Number(r.open);
    const high = Number(r.high);
    const low = Number(r.low);
    const close = Number(r.close);
    const volume = Number(r.volume);
    if (![time, open, high, low, close, volume].every((n) => Number.isFinite(n))) {
      return null;
    }
    // Datafeed already emits unix seconds; tolerate accidental ms (>1e11).
    const sec =
      time > 1e11 ? Math.floor(time / 1000) : Math.floor(time);
    if (sec <= 0) return null;
    return { time: sec, open, high, low, close, volume };
  } catch {
    return null;
  }
}

export function mapDatafeedBars(raw: unknown): OhlcvBar[] {
  if (!Array.isArray(raw)) return [];
  const out: OhlcvBar[] = [];
  for (const row of raw) {
    const bar = mapDatafeedBar(row);
    if (bar) out.push(bar);
    if (out.length >= MOCK_BARS_CAP) break;
  }
  return out;
}

function clampLimit(limit: number | undefined): number | undefined {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return undefined;
  const n = Math.floor(limit);
  if (n <= 0) return undefined;
  return Math.min(n, MOCK_BARS_CAP);
}

/**
 * Fetch historical OHLCV from axis-datafeed. Never throws — returns `{ ok, … }`.
 */
export async function fetchHistorical(
  req: FetchHistoricalRequest,
): Promise<FetchHistoricalResult> {
  try {
    const gated = checkDatafeedUrl(req.baseUrl, { allowRemote: req.allowRemote });
    if (!gated.ok) return { ok: false, error: gated.error };

    const exchange = String(req.exchange ?? '')
      .trim()
      .toLowerCase();
    const symbol = pairFormSymbol(req.symbol ?? '');
    const timeframe = String(req.timeframe ?? '').trim() || '1m';
    if (!exchange) {
      return { ok: false, error: 'AXIS history: exchange is required for datafeed OHLCV.' };
    }
    if (!symbol) {
      return { ok: false, error: 'AXIS history: symbol is required for datafeed OHLCV.' };
    }

    const params = new URLSearchParams({
      exchange,
      symbol,
      timeframe,
    });
    const limit = clampLimit(req.limit);
    if (limit !== undefined) params.set('limit', String(limit));
    if (
      typeof req.since === 'number' &&
      Number.isFinite(req.since) &&
      req.since > 0
    ) {
      params.set('since', String(Math.floor(req.since)));
    }

    const url = `${gated.endpoint}/datafeed/ohlcv?${params.toString()}`;
    const fetchImpl = req.fetchImpl ?? globalThis.fetch.bind(globalThis);
    let res: { ok: boolean; status: number; text(): Promise<string> };
    try {
      res = await fetchImpl(url, { method: 'GET', signal: req.signal });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (req.signal?.aborted) {
        return { ok: false, error: 'AXIS history: fetch aborted.' };
      }
      return {
        ok: false,
        error: `AXIS history: datafeed request failed (${message}). Is axis-datafeed running at ${gated.endpoint}?`,
      };
    }

    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed?.error === 'string' && parsed.error.trim()) {
          detail = parsed.error.trim();
        }
      } catch {
        // keep raw slice
      }
      return {
        ok: false,
        error: `AXIS history: datafeed HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: 'AXIS history: datafeed returned non-JSON body.' };
    }

    if (json !== null && typeof json === 'object' && !Array.isArray(json)) {
      const errObj = json as { error?: unknown };
      if (typeof errObj.error === 'string' && errObj.error.trim()) {
        return { ok: false, error: `AXIS history: ${errObj.error.trim()}` };
      }
    }

    const bars = mapDatafeedBars(json);
    return { ok: true, bars, endpoint: gated.endpoint };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `AXIS history: unexpected failure: ${message}` };
  }
}
