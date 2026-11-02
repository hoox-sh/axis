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

import { describe, expect, test } from 'bun:test';
import { CHART_HISTORY_SEQ } from '../host/chart-session';
import type { HistoryFetchLike } from '../host/history-client';
import { resolveRunContext } from './run-context';

describe('resolveRunContext', () => {
  test('defaults when no chart JSON (doc historyBars wins over setting)', async () => {
    const result = await resolveRunContext(null, { historyBarsSetting: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.bars.length).toBe(1500);
    expect(result.ctx.engineId).toBe('server');
    expect(result.ctx.endpoint).toContain('127.0.0.1');
    expect(result.ctx.seriesKey).toContain('|');
    expect(result.ctx.seq).toBe(1);
    expect(result.ctx.useMockBars).toBe(true);
  });

  test('reads sibling chart doc fields and yields mock bars when useMockBars true', async () => {
    const json = JSON.stringify({
      schema: 'axis.chart.v1',
      symbol: 'ETH/USDT',
      exchange: 'binance',
      market: 'spot',
      interval: '5m',
      historyBars: 80,
      engine: 'server',
    });
    const result = await resolveRunContext(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.bars.length).toBe(80);
    expect(result.ctx.seriesKey).toBe('binance|spot|ETH/USDT|5m');
    expect(result.ctx.doc.symbol).toBe('ETH/USDT');
  });

  test('uses activeEngineId when engineId omitted', async () => {
    const result = await resolveRunContext(null, { activeEngineId: 'pyodide' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.engineId).toBe('pyodide');
    expect(result.ctx.useMockBars).toBe(true);
  });

  test('engineId wins over activeEngineId; empty engineId falls through', async () => {
    const win = await resolveRunContext(null, {
      engineId: 'server',
      activeEngineId: 'pyodide',
    });
    expect(win.ok).toBe(true);
    if (win.ok) expect(win.ctx.engineId).toBe('server');

    const empty = await resolveRunContext(null, {
      engineId: '  ',
      activeEngineId: 'pyodide',
    });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.ctx.engineId).toBe('pyodide');
  });

  test('uses settings engineId/endpoint when provided', async () => {
    const result = await resolveRunContext(null, {
      engineId: 'server',
      endpoint: 'http://127.0.0.1:5002',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.engineId).toBe('server');
    expect(result.ctx.endpoint).toBe('http://127.0.0.1:5002');
  });

  test('falls back to server when doc.engine is empty', async () => {
    const json = JSON.stringify({
      schema: 'axis.chart.v1',
      engine: '',
      historyBars: 60,
    });
    const result = await resolveRunContext(json, { engineId: '  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.engineId).toBe('server');
    expect(result.ctx.bars.length).toBe(60);
  });

  test('catch path returns mock defaults on hostile settings when mock on', async () => {
    const settings = {};
    Object.defineProperty(settings, 'historyBarsSetting', {
      get() {
        throw new Error('hostile');
      },
    });
    const result = await resolveRunContext(null, settings as { historyBarsSetting?: number });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.engineId).toBe('server');
    expect(result.ctx.bars.length).toBeGreaterThan(0);
  });

  test('useMockBars false fetches history and sets history seq', async () => {
    const fetchImpl: HistoryFetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          {
            time: 1_700_000_000,
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 9,
          },
        ]),
    });
    const json = JSON.stringify({
      schema: 'axis.chart.v1',
      symbol: 'BTCUSDT',
      exchange: 'binance',
      interval: '1m',
      historyBars: 10,
    });
    const result = await resolveRunContext(json, {
      useMockBars: false,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.useMockBars).toBe(false);
    expect(result.ctx.bars).toHaveLength(1);
    expect(result.ctx.seriesKey).toBe('binance|spot|BTC/USDT|1m');
    expect(result.ctx.seq).toBe(CHART_HISTORY_SEQ);
  });

  test('useMockBars false fails the run context on history error (no empty POST)', async () => {
    const fetchImpl: HistoryFetchLike = async () => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: 'down' }),
    });
    const result = await resolveRunContext(
      JSON.stringify({
        schema: 'axis.chart.v1',
        symbol: 'ETH/USDT',
        exchange: 'binance',
        interval: '1m',
      }),
      { useMockBars: false, fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/HTTP 502|down/);
  });

  test('useMockBars false fails when datafeed returns empty bars', async () => {
    const fetchImpl: HistoryFetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    });
    const result = await resolveRunContext(
      JSON.stringify({
        schema: 'axis.chart.v1',
        symbol: 'ETH/USDT',
        exchange: 'binance',
        interval: '1m',
      }),
      { useMockBars: false, fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no bars/i);
  });

  test('useMockBars false catch path returns error (no mock fallback)', async () => {
    const settings = {
      useMockBars: false,
      get historyBarsSetting(): number {
        throw new Error('hostile-mock-off');
      },
    };
    const result = await resolveRunContext(
      JSON.stringify({
        schema: 'axis.chart.v1',
        symbol: 'ETH/USDT',
        exchange: 'binance',
      }),
      settings as { useMockBars?: boolean; historyBarsSetting?: number },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/hostile-mock-off|run context failed/);
  });
});
