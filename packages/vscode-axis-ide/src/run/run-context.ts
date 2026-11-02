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
 * Resolve bars + seriesKey for a run from an optional sibling chart doc (PR-06b).
 * When `useMockBars` is true (default), generate fixture bars.
 * When false, fetch venue history via HistoryClient — failures return `{ ok:false }`
 * so the run path does not POST empty data.
 */

import {
  defaultChartDocument,
  parseChartDocument,
  type AxisChartDocV1,
} from '../editors/chart-document';
import {
  CHART_HANDSHAKE_SEQ,
  CHART_HISTORY_SEQ,
  buildChartSession,
  resolveMockBarCount,
} from '../host/chart-session';
import {
  fetchHistorical,
  type HistoryFetchLike,
} from '../host/history-client';
import type { OhlcvBar } from '../host/mock-bars';
import { DEFAULT_ENGINE_ENDPOINT } from './engine-http';
import type { RunMode } from './orchestrator';

export interface RunContextSettings {
  historyBarsSetting?: number;
  engineId?: string;
  endpoint?: string;
  /** `axis.chart.useMockBars` — default true. */
  useMockBars?: boolean;
  /** `axis.datafeed.url`. */
  datafeedUrl?: string;
  /** `axis.engine.allowRemoteEndpoint` — also gates datafeed. */
  allowRemote?: boolean;
  fetchImpl?: HistoryFetchLike;
  signal?: AbortSignal;
}

export interface ResolvedRunContext {
  doc: AxisChartDocV1;
  bars: OhlcvBar[];
  seriesKey: string;
  engineId: string;
  endpoint: string;
  mode: RunMode;
  /**
   * Last chart.full seq for this path (handshake=1 mock; history paint=2).
   * Run must paint seq > this.
   */
  seq: number;
  useMockBars: boolean;
}

export type ResolveRunContextResult =
  | { ok: true; ctx: ResolvedRunContext }
  | { ok: false; error: string };

function fallbackMockContext(): ResolvedRunContext {
  const doc = defaultChartDocument();
  const session = buildChartSession({ doc, useMockBars: true });
  return {
    doc,
    bars: session.bars,
    seriesKey: session.seriesKey,
    engineId: 'server',
    endpoint: DEFAULT_ENGINE_ENDPOINT,
    mode: 'auto',
    seq: session.full.seq,
    useMockBars: true,
  };
}

/**
 * Build run context from chart JSON text (sibling) or defaults.
 * Never throws. When mock is off and history fails, returns `{ ok: false }`.
 */
export async function resolveRunContext(
  chartJsonText: string | null | undefined,
  settings?: RunContextSettings,
): Promise<ResolveRunContextResult> {
  try {
    let doc: AxisChartDocV1 = defaultChartDocument();
    if (typeof chartJsonText === 'string' && chartJsonText.trim()) {
      const parsed = parseChartDocument(chartJsonText);
      if (parsed.ok) doc = parsed.doc;
    }

    const useMockBars = settings?.useMockBars !== false;
    const engineId =
      (settings?.engineId && settings.engineId.trim()) ||
      (doc.engine && doc.engine.trim()) ||
      'server';
    const endpoint =
      (settings?.endpoint && settings.endpoint.trim()) || DEFAULT_ENGINE_ENDPOINT;

    if (useMockBars) {
      const session = buildChartSession({
        doc,
        useMockBars: true,
        historyBarsSetting: settings?.historyBarsSetting,
      });
      return {
        ok: true,
        ctx: {
          doc,
          bars: session.bars,
          seriesKey: session.seriesKey,
          engineId,
          endpoint,
          mode: 'auto',
          seq: session.full.seq || CHART_HANDSHAKE_SEQ,
          useMockBars: true,
        },
      };
    }

    // Real history — do not fall back to mock when the user asked for venue bars.
    const session = buildChartSession({
      doc,
      useMockBars: false,
      historyBarsSetting: settings?.historyBarsSetting,
    });
    const limit = resolveMockBarCount(doc.historyBars, settings?.historyBarsSetting);
    const history = await fetchHistorical({
      exchange: doc.exchange || 'binance',
      symbol: doc.symbol,
      timeframe: doc.interval || '1m',
      limit,
      baseUrl: settings?.datafeedUrl,
      allowRemote: settings?.allowRemote,
      fetchImpl: settings?.fetchImpl,
      signal: settings?.signal,
    });
    if (!history.ok) {
      return { ok: false, error: history.error };
    }
    if (!history.bars.length) {
      return {
        ok: false,
        error:
          'AXIS history: datafeed returned no bars. Check exchange/symbol/interval or enable axis.chart.useMockBars.',
      };
    }
    return {
      ok: true,
      ctx: {
        doc,
        bars: history.bars,
        seriesKey: session.seriesKey,
        engineId,
        endpoint,
        mode: 'auto',
        seq: CHART_HISTORY_SEQ,
        useMockBars: false,
      },
    };
  } catch (e) {
    // Hostile settings / unexpected — only mock fallback when mock was requested.
    if (settings?.useMockBars === false) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `AXIS run context failed: ${message}` };
    }
    return { ok: true, ctx: fallbackMockContext() };
  }
}
