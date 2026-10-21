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

/** Fixed-window limiter behaviour for `/api/run` and the OAuth relay. */

import { beforeEach, describe, expect, it } from 'bun:test';
import { _resetRateLimitsForTests, allowRate } from '../src/rate-limit';

describe('allowRate', () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it('allows up to the limit then rejects', () => {
    expect(allowRate('k', 3, 60_000)).toBe(true);
    expect(allowRate('k', 3, 60_000)).toBe(true);
    expect(allowRate('k', 3, 60_000)).toBe(true);
    expect(allowRate('k', 3, 60_000)).toBe(false);
    expect(allowRate('k', 3, 60_000)).toBe(false);
  });

  it('buckets independently per key', () => {
    expect(allowRate('a', 1, 60_000)).toBe(true);
    expect(allowRate('a', 1, 60_000)).toBe(false);
    expect(allowRate('b', 1, 60_000)).toBe(true);
  });

  it('starts a fresh window once it expires', async () => {
    expect(allowRate('k', 1, 5)).toBe(true);
    expect(allowRate('k', 1, 5)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(allowRate('k', 1, 5)).toBe(true);
  });

  it('prunes expired buckets without rejecting live ones', () => {
    for (let i = 0; i < 6000; i += 1) allowRate(`old-${i}`, 1, 1);
    // Prune only drops entries older than 2x the window used at insert time.
    expect(allowRate('live', 1, 60_000)).toBe(true);
  });

  it('charges a weighted request against the same budget', () => {
    expect(allowRate('w', 10, 60_000, 4)).toBe(true);
    expect(allowRate('w', 10, 60_000, 4)).toBe(true);
    // 8 of 10 used — a third batch of 4 does not fit.
    expect(allowRate('w', 10, 60_000, 4)).toBe(false);
    // The rejected batch was not counted, so the remaining budget is intact.
    expect(allowRate('w', 10, 60_000, 2)).toBe(true);
    expect(allowRate('w', 10, 60_000, 1)).toBe(false);
  });

  it('rejects a weighted request that exceeds the limit on a fresh window', () => {
    expect(allowRate('big', 3, 60_000, 4)).toBe(false);
    // A rejected request on a fresh window must not open a bucket.
    expect(allowRate('big', 3, 60_000, 3)).toBe(true);
  });

  it('treats a non-positive weight as one call', () => {
    expect(allowRate('z', 1, 60_000, 0)).toBe(true);
    expect(allowRate('z', 1, 60_000, -5)).toBe(false);
  });
});