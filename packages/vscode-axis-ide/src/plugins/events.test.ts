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

import { afterEach, describe, expect, test } from 'bun:test';
import {
  chartPluginsFromActive,
  notifyActivePlugins,
  resetActivePluginsEventsForTests,
  subscribeActivePlugins,
} from './events';
import type { ActivePluginsV1 } from './types';

afterEach(() => {
  resetActivePluginsEventsForTests();
});

describe('active plugins events bus', () => {
  test('fans out and respects dispose; never throws on listener errors', () => {
    const seen: ActivePluginsV1[] = [];
    const sub = subscribeActivePlugins((active) => {
      seen.push(active);
    });
    subscribeActivePlugins(() => {
      throw new Error('boom');
    });
    const payload: ActivePluginsV1 = { source: 'okx-rest', engine: 'server' };
    expect(() => notifyActivePlugins(payload)).not.toThrow();
    expect(seen).toEqual([payload]);
    sub.dispose();
    expect(() => notifyActivePlugins({ stream: 'binance-ws' })).not.toThrow();
    expect(seen).toHaveLength(1);
  });

  test('reset clears listeners', () => {
    const seen: ActivePluginsV1[] = [];
    subscribeActivePlugins((a) => seen.push(a));
    resetActivePluginsEventsForTests();
    notifyActivePlugins({ engine: 'server' });
    expect(seen).toEqual([]);
  });

  test('chartPluginsFromActive picks HUD keys and ignores junk', () => {
    expect(
      chartPluginsFromActive({
        source: 'binance-rest',
        stream: 'binance-ws',
        engine: 'server',
        storage: 'local',
        dataset: 'tvl',
      }),
    ).toEqual({
      source: 'binance-rest',
      stream: 'binance-ws',
      engine: 'server',
      storage: 'local',
    });
    expect(chartPluginsFromActive({ source: '  ', engine: 1 as never })).toEqual({});
    expect(chartPluginsFromActive(null as never)).toEqual({});
    expect(chartPluginsFromActive('x' as never)).toEqual({});
    expect(chartPluginsFromActive(['binance-rest'] as never)).toEqual({});

    const hostile: ActivePluginsV1 = { stream: 'binance-ws' };
    Object.defineProperty(hostile, 'source', {
      get() {
        throw new Error('boom-source');
      },
    });
    expect(chartPluginsFromActive(hostile)).toEqual({ stream: 'binance-ws' });
  });
});
