// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The live-bar sanitizer.
 *
 * Five stream plugins and the engine wire built bars by hand, so a bar with a
 * non-finite price reached the chart. They now share one sanitizer — the
 * live variant of `sanitizeBar`, which keeps the `closed` flag so a forming
 * tick stays distinguishable from a closed candle.
 */

import { describe, expect, it } from 'bun:test';
import { sanitizeStreamBar } from '../src/data/parse-bars';

describe('sanitizeStreamBar', () => {
  it('keeps a well-formed bar', () => {
    const bar = sanitizeStreamBar({
      time: 1_700_000_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
      closed: true,
    });
    expect(bar).toEqual({
      time: 1_700_000_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
      closed: true,
    });
  });

  it('coerces numeric strings', () => {
    const bar = sanitizeStreamBar({
      time: '1700000000',
      open: '1',
      high: '2',
      low: '0.5',
      close: '1.5',
    });
    expect(bar?.close).toBe(1.5);
  });

  it('drops a bar with a non-finite price', () => {
    expect(
      sanitizeStreamBar({ time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: NaN }),
    ).toBeNull();
    expect(
      sanitizeStreamBar({ time: 1_700_000_000, open: 'x', high: 2, low: 0.5, close: 1.5 }),
    ).toBeNull();
  });

  it('drops a bar with an unusable time', () => {
    expect(sanitizeStreamBar({ time: 0, open: 1, high: 2, low: 0.5, close: 1.5 })).toBeNull();
    expect(sanitizeStreamBar({ time: NaN, open: 1, high: 2, low: 0.5, close: 1.5 })).toBeNull();
    expect(sanitizeStreamBar({ open: 1, high: 2, low: 0.5, close: 1.5 })).toBeNull();
  });

  it('repairs a high below the open', () => {
    const bar = sanitizeStreamBar({ time: 1, open: 5, high: 3, low: 1, close: 4 });
    expect(bar?.high).toBe(5);
  });

  it('keeps the closed flag, and falls back to the caller value', () => {
    expect(
      sanitizeStreamBar({ time: 1, open: 1, high: 2, low: 0.5, close: 1, closed: false })?.closed,
    ).toBe(false);
    expect(
      sanitizeStreamBar({ time: 1, open: 1, high: 2, low: 0.5, close: 1 }, false)?.closed,
    ).toBe(false);
    expect(
      sanitizeStreamBar({ time: 1, open: 1, high: 2, low: 0.5, close: 1 })?.closed,
    ).toBeUndefined();
  });

  it('leaves a missing volume missing', () => {
    const bar = sanitizeStreamBar({ time: 1, open: 1, high: 2, low: 0.5, close: 1 });
    expect(bar?.volume).toBeUndefined();
  });

  it('drops a negative volume', () => {
    const bar = sanitizeStreamBar({ time: 1, open: 1, high: 2, low: 0.5, close: 1, volume: -1 });
    expect(bar?.volume).toBeUndefined();
  });

  it('rejects a non-object', () => {
    expect(sanitizeStreamBar(null)).toBeNull();
    expect(sanitizeStreamBar(undefined)).toBeNull();
    expect(sanitizeStreamBar('bar')).toBeNull();
    expect(sanitizeStreamBar([1, 2, 3, 4, 5])).toBeNull();
  });
});
