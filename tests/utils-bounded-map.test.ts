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
 * Bounded collections.
 *
 * The scan found six module-level maps that grew with the number of distinct
 * keys a session touched — a WS client, a series memo, a dismissed job id, a
 * pending live bar, a bar-close verifier — with nothing ever evicting them.
 */

import { describe, expect, it } from 'bun:test';
import { BoundedMap, BoundedSet } from '../src/utils/bounded-map';

describe('BoundedMap', () => {
  it('behaves like a Map below the cap', () => {
    const m = new BoundedMap<string, number>(4);
    m.set('a', 1).set('b', 2);
    expect(m.get('a')).toBe(1);
    expect(m.has('b')).toBe(true);
    expect(m.size).toBe(2);
    expect([...m.keys()]).toEqual(['a', 'b']);
    expect([...m.values()]).toEqual([1, 2]);
    expect([...m.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    m.forEach((v, k) => {
      expect(k).toBeTruthy();
      expect(v).toBeTruthy();
    });
  });

  it('never grows past the cap', () => {
    const m = new BoundedMap<string, number>(3);
    for (let i = 0; i < 100; i += 1) m.set(`k${i}`, i);
    expect(m.size).toBe(3);
  });

  it('evicts the oldest entry first', () => {
    const m = new BoundedMap<string, number>(3);
    m.set('a', 1).set('b', 2).set('c', 3);
    m.set('d', 4);
    expect(m.has('a')).toBe(false);
    expect(m.has('d')).toBe(true);
    expect([...m.keys()]).toEqual(['b', 'c', 'd']);
  });

  it('refreshes the order when a key is written again', () => {
    const m = new BoundedMap<string, number>(3);
    m.set('a', 1).set('b', 2).set('c', 3);
    m.set('a', 10);
    m.set('d', 4);
    // 'a' was rewritten, so 'b' is now the oldest.
    expect(m.has('a')).toBe(true);
    expect(m.has('b')).toBe(false);
    expect(m.get('a')).toBe(10);
  });

  it('does not refresh the order on a read', () => {
    const m = new BoundedMap<string, number>(3);
    m.set('a', 1).set('b', 2).set('c', 3);
    m.get('a');
    m.set('d', 4);
    expect(m.has('a')).toBe(false);
  });

  it('reports an eviction so the entry can release what it held', () => {
    const evicted: string[] = [];
    const m = new BoundedMap<string, number>(2, {
      onEvict: (key) => {
        evicted.push(key);
      },
    });
    m.set('a', 1).set('b', 2).set('c', 3);
    expect(evicted).toEqual(['a']);
    expect(m.has('a')).toBe(false);
  });

  it('passes the evicted value to the hook', () => {
    const seen: Array<[string, number | undefined]> = [];
    const m = new BoundedMap<string, number>(1, {
      onEvict: (key, value) => {
        seen.push([key, value]);
      },
    });
    m.set('a', 7).set('b', 8);
    expect(seen).toEqual([['a', 7]]);
  });

  it('supports delete and clear', () => {
    const m = new BoundedMap<string, number>(4);
    m.set('a', 1).set('b', 2);
    expect(m.delete('a')).toBe(true);
    expect(m.delete('a')).toBe(false);
    m.clear();
    expect(m.size).toBe(0);
  });

  it('never has a cap below one', () => {
    const m = new BoundedMap<string, number>(0);
    m.set('a', 1);
    expect(m.size).toBe(1);
  });
});

describe('BoundedSet', () => {
  it('behaves like a Set below the cap', () => {
    const s = new BoundedSet<string>(4);
    s.add('a').add('b');
    expect(s.has('a')).toBe(true);
    expect(s.size).toBe(2);
    expect([...s.values()]).toEqual(['a', 'b']);
  });

  it('never grows past the cap', () => {
    const s = new BoundedSet<string>(3);
    for (let i = 0; i < 100; i += 1) s.add(`k${i}`);
    expect(s.size).toBe(3);
  });

  it('evicts the oldest entry first', () => {
    const s = new BoundedSet<string>(3);
    s.add('a').add('b').add('c');
    s.add('d');
    expect(s.has('a')).toBe(false);
    expect(s.has('d')).toBe(true);
  });

  it('supports delete and clear', () => {
    const s = new BoundedSet<string>(4);
    s.add('a').add('b');
    expect(s.delete('a')).toBe(true);
    s.clear();
    expect(s.size).toBe(0);
  });
});
