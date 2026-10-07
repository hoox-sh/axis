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

/** Leading-edge drop guard shared by the update poller, boot errors, and error share. */

import { describe, expect, it } from 'bun:test';
import { createThrottle } from '../src/utils/throttle';

describe('createThrottle', () => {
  it('allows the leading call then drops repeats inside the window', () => {
    const t = createThrottle(1000);
    expect(t.allow()).toBe(true);
    expect(t.allow()).toBe(false);
    expect(t.allow()).toBe(false);
  });

  it('allows again once the window expires', async () => {
    const t = createThrottle(5);
    expect(t.allow()).toBe(true);
    expect(t.allow()).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(t.allow()).toBe(true);
  });

  it('tracks each key independently', () => {
    const t = createThrottle(1000);
    expect(t.allow('a')).toBe(true);
    expect(t.allow('b')).toBe(true);
    expect(t.allow('a')).toBe(false);
    expect(t.allow('b')).toBe(false);
  });

  it('honours a per-call window override over the default', async () => {
    const t = createThrottle(60_000);
    // Narrow override lets a repeat through sooner than the 60s default would.
    expect(t.allow('k', 5)).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(t.allow('k', 5)).toBe(true);
    // The default still applies when no override is passed.
    expect(t.allow('j')).toBe(true);
    expect(t.allow('j')).toBe(false);
  });

  it('does not re-stamp the window on a rejected call', () => {
    const t = createThrottle(1000);
    expect(t.allow('k')).toBe(true);
    expect(t.allow('k')).toBe(false);
    expect(t.allow('k')).toBe(false);
  });

  it('reset clears every key', () => {
    const t = createThrottle(1000);
    expect(t.allow('a')).toBe(true);
    t.reset();
    expect(t.allow('a')).toBe(true);
  });
});