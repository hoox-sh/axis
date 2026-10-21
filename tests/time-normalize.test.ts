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
 * The single time normalizer.
 *
 * The scan found three copies of the same ms-to-seconds rule — the venue
 * parser, the plot-time helper and the engine-time helper — each rejecting a
 * slightly different set of values. They now share one function, so a time
 * the venue accepts cannot be rejected by the engine, and vice versa.
 *
 * The venue parser keeps its own entry point because an ISO date string is a
 * venue shape that an engine plot time never has.
 */

import { describe, expect, it } from 'bun:test';
import { normalizeBarTime } from '../src/data/parse-bars';
import { normalizeBarTime as normalizeBarTimeFromRunHelpers } from '../src/indicators/run-helpers';

/** Unix seconds past ~year 2100. */
const MAX_UNIX_SECONDS = 4_102_444_800;

describe('normalizeBarTime', () => {
  it('keeps unix seconds', () => {
    expect(normalizeBarTime(1_700_000_000)).toBe(1_700_000_000);
  });

  it('converts milliseconds to seconds', () => {
    expect(normalizeBarTime(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it('folds microsecond leftovers once more', () => {
    expect(normalizeBarTime(1_700_000_000_000_000)).toBe(1_700_000_000);
  });

  it('accepts a numeric string', () => {
    expect(normalizeBarTime('1700000000')).toBe(1_700_000_000);
    expect(normalizeBarTime(' 1700000000 ')).toBe(1_700_000_000);
  });

  it('rejects non-finite', () => {
    expect(normalizeBarTime(null)).toBeNull();
    expect(normalizeBarTime(undefined)).toBeNull();
    expect(normalizeBarTime(NaN)).toBeNull();
    expect(normalizeBarTime(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeBarTime('x')).toBeNull();
    expect(normalizeBarTime('')).toBeNull();
  });

  it('rejects a boolean', () => {
    expect(normalizeBarTime(true)).toBeNull();
    expect(normalizeBarTime(false)).toBeNull();
  });

  it('rejects a non-positive time', () => {
    expect(normalizeBarTime(0)).toBeNull();
    expect(normalizeBarTime(-1)).toBeNull();
  });

  it('rejects a time past ~year 2100', () => {
    expect(normalizeBarTime(MAX_UNIX_SECONDS)).toBe(MAX_UNIX_SECONDS);
    expect(normalizeBarTime(MAX_UNIX_SECONDS + 1)).toBeNull();
  });

  it('is the same function the plot-time helper exposes', () => {
    expect(normalizeBarTimeFromRunHelpers).toBe(normalizeBarTime);
  });
});

describe('the venue parse path', () => {
  it('accepts unix seconds and milliseconds', () => {
    expect(normalizeBarTime(1_700_000_000)).toBe(1_700_000_000);
    expect(normalizeBarTime(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it('accepts an ISO date string', () => {
    expect(normalizeBarTime('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000);
  });

  it('rejects an unparseable string', () => {
    expect(normalizeBarTime('not a date')).toBeNull();
    expect(normalizeBarTime('')).toBeNull();
  });

  it('rejects a non-positive or out-of-range time', () => {
    expect(normalizeBarTime(0)).toBeNull();
    expect(normalizeBarTime(MAX_UNIX_SECONDS + 1)).toBeNull();
  });
});
