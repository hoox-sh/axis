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
 * Resolve mock bars + seriesKey for a run from an optional sibling chart doc.
 * Runs always use mock/fixture bars until HistoryClient (Task 11) — `useMockBars`
 * chart setting is ignored on this path so Run never posts an empty window.
 */

import {
  defaultChartDocument,
  parseChartDocument,
  type AxisChartDocV1,
} from '../editors/chart-document';
import { buildChartSession } from '../host/chart-session';
import type { OhlcvBar } from '../host/mock-bars';
import { DEFAULT_ENGINE_ENDPOINT } from './engine-http';
import type { RunMode } from './orchestrator';

export interface RunContextSettings {
  historyBarsSetting?: number;
  engineId?: string;
  endpoint?: string;
}

export interface ResolvedRunContext {
  doc: AxisChartDocV1;
  bars: OhlcvBar[];
  seriesKey: string;
  engineId: string;
  endpoint: string;
  mode: RunMode;
  /** Handshake seq from buildChartSession (usually 1) — run must paint seq > this. */
  seq: number;
}

/**
 * Build mock-bar run context from chart JSON text (sibling) or defaults.
 * Always generates mock bars (Task 09 / PR-06). Never throws.
 */
export function resolveRunContext(
  chartJsonText: string | null | undefined,
  settings?: RunContextSettings,
): ResolvedRunContext {
  try {
    let doc: AxisChartDocV1 = defaultChartDocument();
    if (typeof chartJsonText === 'string' && chartJsonText.trim()) {
      const parsed = parseChartDocument(chartJsonText);
      if (parsed.ok) doc = parsed.doc;
    }
    // Force mock until HistoryClient — ignore axis.chart.useMockBars for runs.
    const session = buildChartSession({
      doc,
      useMockBars: true,
      historyBarsSetting: settings?.historyBarsSetting,
    });
    const engineId =
      (settings?.engineId && settings.engineId.trim()) ||
      (doc.engine && doc.engine.trim()) ||
      'server';
    const endpoint =
      (settings?.endpoint && settings.endpoint.trim()) || DEFAULT_ENGINE_ENDPOINT;
    return {
      doc,
      bars: session.bars,
      seriesKey: session.seriesKey,
      engineId,
      endpoint,
      mode: 'auto',
      seq: session.full.seq,
    };
  } catch {
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
    };
  }
}
