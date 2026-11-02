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
import {
  decodeHostMessage,
  pickChartInitFields,
  PROTOCOL_VERSION,
} from '../../webview/chart/src/protocol';

describe('chart webview host-message decode', () => {
  test('accepts chart.init and allowlists fields', () => {
    const decoded = decodeHostMessage({
      v: PROTOCOL_VERSION,
      type: 'chart.init',
      payload: {
        theme: 'void',
        cssVars: { '--x': '1' },
        seriesKey: 'a|b|c|1m',
        panes: [{ id: 'price', kind: 'price' }],
        plugins: { source: 'binance-rest' },
        extra: 'drop-me',
      },
      ts: 1,
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      const fields = pickChartInitFields(decoded.payload);
      expect(fields.theme).toBe('void');
      expect(fields.seriesKey).toBe('a|b|c|1m');
      expect(fields.cssVars).toEqual({ '--x': '1' });
      expect(fields.plugins).toEqual({ source: 'binance-rest' });
      expect((fields as { extra?: unknown }).extra).toBeUndefined();
    }
  });

  test('rejects view→host and garbage', () => {
    const wrongDir = decodeHostMessage({
      v: 1,
      type: 'webview.ready',
      payload: { view: 'chart' },
      ts: 1,
    });
    expect(wrongDir.ok).toBe(false);

    expect(decodeHostMessage(null).ok).toBe(false);
    expect(decodeHostMessage({ v: 2, type: 'chart.init', payload: {}, ts: 1 }).ok).toBe(false);
  });
});
