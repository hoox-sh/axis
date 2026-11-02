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
import { formatLiveStatus, resolveLiveHud } from './status';

describe('resolveLiveHud', () => {
  test('returns off when disabled or disconnected', () => {
    expect(
      resolveLiveHud({ enabled: false, connected: true, wireStatus: 'live' }),
    ).toBe('off');
    expect(resolveLiveHud({ enabled: true, connected: false })).toBe('off');
  });

  test('returns degraded while connecting, loading, or errored', () => {
    expect(resolveLiveHud({ enabled: true, connected: false, connecting: true })).toBe(
      'degraded',
    );
    expect(
      resolveLiveHud({
        enabled: true,
        connected: true,
        wireStatus: 'datafeed-loading',
      }),
    ).toBe('degraded');
    expect(
      resolveLiveHud({ enabled: true, connected: true, wireStatus: 'calculating' }),
    ).toBe('degraded');
    expect(
      resolveLiveHud({ enabled: true, connected: false, errored: true }),
    ).toBe('degraded');
  });

  test('returns live when connected', () => {
    expect(resolveLiveHud({ enabled: true, connected: true })).toBe('live');
    expect(
      resolveLiveHud({ enabled: true, connected: true, wireStatus: 'live' }),
    ).toBe('live');
    expect(
      resolveLiveHud({ enabled: true, connected: true, wireStatus: 'streaming' }),
    ).toBe('live');
  });
});

describe('formatLiveStatus', () => {
  test('labels cover live / degraded / off', () => {
    expect(formatLiveStatus('live').text).toMatch(/AXIS Live/);
    expect(formatLiveStatus('degraded').text).toMatch(/Live/);
    expect(formatLiveStatus('off').text).toMatch(/off/i);
    expect(formatLiveStatus('live').tooltip).not.toMatch(/pn_/);
    expect(formatLiveStatus('off').tooltip).toMatch(/off/i);
  });
});

describe('resolveLiveHud never-throw', () => {
  test('hostile getters fall back to off', () => {
    const hostile = {
      get enabled(): boolean {
        throw new Error('boom');
      },
      connected: true,
    };
    expect(resolveLiveHud(hostile as never)).toBe('off');
  });

  test('idle and error wire statuses are degraded', () => {
    expect(
      resolveLiveHud({ enabled: true, connected: true, wireStatus: 'idle' }),
    ).toBe('degraded');
    expect(
      resolveLiveHud({ enabled: true, connected: true, wireStatus: 'error' }),
    ).toBe('degraded');
  });
});
