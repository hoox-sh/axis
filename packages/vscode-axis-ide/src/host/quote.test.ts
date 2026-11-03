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
  displayedLastPrice,
  formatQuotePrice,
  resolveDisplayedQuotePrice,
  streamAllowsLivePrice,
} from './quote';

describe('streamAllowsLivePrice', () => {
  test('allows null/undefined/open only', () => {
    expect(streamAllowsLivePrice(null)).toBe(true);
    expect(streamAllowsLivePrice(undefined)).toBe(true);
    expect(streamAllowsLivePrice('open')).toBe(true);
    expect(streamAllowsLivePrice('connecting')).toBe(false);
    expect(streamAllowsLivePrice('degraded')).toBe(false);
    expect(streamAllowsLivePrice('error')).toBe(false);
    expect(streamAllowsLivePrice('closed')).toBe(false);
  });
});

describe('displayedLastPrice', () => {
  test('keeps the candle close while the stream is not open', () => {
    expect(displayedLastPrice({ tickPrice: 110, barClose: 100, streamState: 'open' })).toBe(110);
    expect(
      displayedLastPrice({ tickPrice: 110, barClose: 100, streamState: 'connecting' }),
    ).toBe(100);
    expect(
      displayedLastPrice({ tickPrice: 110, barClose: 100, streamState: 'degraded' }),
    ).toBe(100);
    expect(displayedLastPrice({ tickPrice: 110, barClose: 100, streamState: 'error' })).toBe(
      100,
    );
    expect(displayedLastPrice({ tickPrice: 110, barClose: 100, streamState: 'closed' })).toBe(
      100,
    );
    expect(displayedLastPrice({ tickPrice: 110, barClose: 100 })).toBe(110);
  });

  test('falls back to NaN when barClose is non-finite and stream blocked', () => {
    expect(
      displayedLastPrice({ tickPrice: 110, barClose: NaN, streamState: 'connecting' }),
    ).toBeNaN();
  });

  test('ignores non-finite tick even when stream is open', () => {
    expect(displayedLastPrice({ tickPrice: NaN, barClose: 100, streamState: 'open' })).toBe(
      100,
    );
  });
});

describe('resolveDisplayedQuotePrice / formatQuotePrice', () => {
  test('mirrors displayedLastPrice and formats finite prices', () => {
    expect(
      resolveDisplayedQuotePrice({
        tickPrice: 110,
        barClose: 100,
        streamState: 'connecting',
      }),
    ).toBe(100);
    expect(formatQuotePrice(100)).toBe('100.00');
    expect(formatQuotePrice(1000)).toBe('1000.00');
    expect(formatQuotePrice(0.05)).toBe('0.0500');
    expect(formatQuotePrice(0.00012)).toMatch(/^0\.000/);
    expect(formatQuotePrice(NaN)).toBe('—');
  });
});
