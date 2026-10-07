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
});