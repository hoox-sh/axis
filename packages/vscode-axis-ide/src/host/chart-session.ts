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
 * Chart session snapshot for the custom editor handshake (PR-05 / PR-06b).
 * Builds `chart.init` + `chart.full` (mock bars or empty clear).
 * Real venue bars are fetched asynchronously via HistoryClient when mock is off.
 */

import {
  buildChartInitStub,
  defaultChartCssVars,
} from '../editors/chart-messages';
import type { AxisChartDocV1 } from '../editors/chart-document';
import type { ChartFullPayload, ChartInitPayload } from '../protocol';
import {
  MOCK_BARS_DEFAULT,
  clampMockBarCount,
  generateMockBars,
  type OhlcvBar,
} from './mock-bars';
import {
  buildSeriesKey,
  type SeriesKeyFields,
} from './series-key';

export type { SeriesKeyFields };
export { buildSeriesKey };

/** Handshake `chart.full.seq` (mock or empty clear). History paint uses +1. */
export const CHART_HANDSHAKE_SEQ = 1;

/** `chart.full.seq` after a successful HistoryClient paint (above handshake). */
export const CHART_HISTORY_SEQ = CHART_HANDSHAKE_SEQ + 1;

/**
 * Resolve mock bar count: explicit positive doc.historyBars → else setting → else default.
 * Non-positive doc values are treated as unset (setting / default win).
 */
export function resolveMockBarCount(
  docHistoryBars: number,
  settingHistoryBars?: number,
): number {
  if (typeof docHistoryBars === 'number' && Number.isFinite(docHistoryBars) && docHistoryBars > 0) {
    return clampMockBarCount(docHistoryBars);
  }
  if (
    typeof settingHistoryBars === 'number' &&
    Number.isFinite(settingHistoryBars) &&
    settingHistoryBars > 0
  ) {
    return clampMockBarCount(settingHistoryBars);
  }
  return clampMockBarCount(MOCK_BARS_DEFAULT);
}

export interface ChartSessionOptions {
  doc: AxisChartDocV1;
  /** When true (default), generate mock bars. When false, post empty chart.full to clear. */
  useMockBars?: boolean;
  /** `axis.chart.historyBars` setting (used when doc count is unset/non-positive). */
  historyBarsSetting?: number;
  cssVars?: Record<string, string>;
  /** Override seq for tests (default {@link CHART_HANDSHAKE_SEQ}). */
  seq?: number;
}

export interface ChartSessionSnapshot {
  seriesKey: string;
  init: ChartInitPayload;
  /** Always present — empty bars when mock is off so the webview clears prior series. */
  full: ChartFullPayload;
  bars: OhlcvBar[];
  useMockBars: boolean;
}

/** Build init + full from the current document — call per handshake, never cache. */
export function buildChartSession(opts: ChartSessionOptions): ChartSessionSnapshot {
  const useMockBars = opts.useMockBars !== false;
  const seriesKey = buildSeriesKey(opts.doc);
  const init = buildChartInitStub({
    theme: opts.doc.theme,
    panes: opts.doc.panes,
    seriesKey,
    cssVars: opts.cssVars ?? defaultChartCssVars(),
  });
  const seq =
    typeof opts.seq === 'number' && Number.isFinite(opts.seq)
      ? opts.seq
      : CHART_HANDSHAKE_SEQ;

  if (!useMockBars) {
    const full: ChartFullPayload = { bars: [], seq };
    return { seriesKey, init, full, bars: [], useMockBars: false };
  }

  const count = resolveMockBarCount(opts.doc.historyBars, opts.historyBarsSetting);
  const bars = generateMockBars({
    count,
    interval: opts.doc.interval || '1m',
    seed: seriesKey,
  });
  const full: ChartFullPayload = { bars, seq };
  return { seriesKey, init, full, bars, useMockBars: true };
}
