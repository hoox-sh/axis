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
import { resolveRunContext } from './run-context';

describe('resolveRunContext', () => {
  test('defaults when no chart JSON (doc historyBars wins over setting)', () => {
    const ctx = resolveRunContext(null, { historyBarsSetting: 50 });
    expect(ctx.bars.length).toBe(1500);
    expect(ctx.engineId).toBe('server');
    expect(ctx.endpoint).toContain('127.0.0.1');
    expect(ctx.seriesKey).toContain('|');
    expect(ctx.seq).toBe(1);
  });

  test('reads sibling chart doc fields and always yields mock bars', () => {
    const json = JSON.stringify({
      schema: 'axis.chart.v1',
      symbol: 'ETH/USDT',
      exchange: 'binance',
      market: 'spot',
      interval: '5m',
      historyBars: 80,
      engine: 'server',
    });
    const ctx = resolveRunContext(json);
    expect(ctx.bars.length).toBe(80);
    expect(ctx.seriesKey).toBe('binance|spot|ETH/USDT|5m');
    expect(ctx.doc.symbol).toBe('ETH/USDT');
  });

  test('uses settings engineId/endpoint when provided', () => {
    const ctx = resolveRunContext(null, {
      engineId: 'server',
      endpoint: 'http://127.0.0.1:5002',
    });
    expect(ctx.engineId).toBe('server');
    expect(ctx.endpoint).toBe('http://127.0.0.1:5002');
  });

  test('falls back to server when doc.engine is empty', () => {
    const json = JSON.stringify({
      schema: 'axis.chart.v1',
      engine: '',
      historyBars: 60,
    });
    const ctx = resolveRunContext(json, { engineId: '  ' });
    expect(ctx.engineId).toBe('server');
    expect(ctx.bars.length).toBe(60);
  });

  test('catch path returns defaults on hostile settings', () => {
    const settings = {};
    Object.defineProperty(settings, 'historyBarsSetting', {
      get() {
        throw new Error('hostile');
      },
    });
    const ctx = resolveRunContext(null, settings as { historyBarsSetting?: number });
    expect(ctx.engineId).toBe('server');
    expect(ctx.bars.length).toBeGreaterThan(0);
  });
});
