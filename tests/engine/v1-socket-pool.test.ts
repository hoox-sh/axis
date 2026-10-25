/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  SocketPool,
  TAB_SOCKET_CAP,
  socketFingerprint,
} from '../../src/engine/v1/socket-pool';

describe('tab socket pool', () => {
  test('same fingerprint is one live socket', () => {
    let n = 0;
    const pool = new SocketPool<number>();
    const create = () => ++n;
    const a = pool.acquire(socketFingerprint('http://a', 'k'), create);
    const b = pool.acquire(socketFingerprint('http://a', 'k'), create);
    expect(a.status).toBe('live');
    expect(b.status).toBe('live');
    if (a.status !== 'live' || b.status !== 'live') throw new Error('expected live');
    expect(a.value).toBe(b.value);
    expect(n).toBe(1);
    expect(pool.size()).toBe(1);
  });

  test('two fingerprints open two sockets', () => {
    let n = 0;
    const pool = new SocketPool<number>();
    const create = () => ++n;
    const a = pool.acquire('a', create);
    const b = pool.acquire('b', create);
    expect(a.status).toBe('live');
    expect(b.status).toBe('live');
    if (a.status !== 'live' || b.status !== 'live') throw new Error('expected live');
    expect(a.value).not.toBe(b.value);
    expect(n).toBe(2);
    expect(pool.size()).toBe(TAB_SOCKET_CAP);
  });

  test('a third fingerprint queues and does not open a socket', () => {
    let n = 0;
    const pool = new SocketPool<number>();
    const create = () => ++n;
    pool.acquire('a', create);
    pool.acquire('b', create);
    const third = pool.acquire('c', create);
    expect(third.status).toBe('queued');
    expect(n).toBe(2);
    expect(pool.size()).toBe(2);
    expect(pool.queued()).toBe(1);
    expect(pool.get('c')).toBeUndefined();
  });

  test('four acquires of the same fingerprint share one client', () => {
    let n = 0;
    const pool = new SocketPool<number>();
    const create = () => ++n;
    for (let i = 0; i < 4; i++) {
      const got = pool.acquire('fp', create);
      expect(got.status).toBe('live');
    }
    expect(n).toBe(1);
    expect(pool.size()).toBe(1);
    expect(pool.refs('fp')).toBe(4);
    expect(pool.release('fp')).toBeUndefined();
    expect(pool.release('fp')).toBeUndefined();
    expect(pool.release('fp')).toBeUndefined();
    expect(pool.size()).toBe(1);
    expect(pool.get('fp')).toBe(1);
    expect(pool.refs('fp')).toBe(1);
    expect(pool.release('fp')).toBe(1);
    expect(pool.size()).toBe(0);
    expect(pool.get('fp')).toBeUndefined();
  });

  test('a holder moving A→B stays size 1', () => {
    let n = 0;
    const pool = new SocketPool<string>();
    const create = (id: string) => () => {
      n += 1;
      return id;
    };
    const a = pool.acquire('a', create('a'), 'primary');
    expect(a.status).toBe('live');
    const b = pool.acquire('b', create('b'), 'primary');
    expect(b.status).toBe('live');
    if (b.status !== 'live') throw new Error('expected live');
    expect(b.value).toBe('b');
    expect(n).toBe(2);
    expect(pool.size()).toBe(1);
    expect(pool.get('a')).toBeUndefined();
    expect(pool.get('b')).toBe('b');
    expect(pool.refs('b')).toBe(1);
  });

  test('the same holder does not bump refs on re-acquire', () => {
    let n = 0;
    const pool = new SocketPool<number>();
    const create = () => ++n;
    pool.acquire('a', create, 'slot-1');
    pool.acquire('a', create, 'slot-1');
    expect(n).toBe(1);
    expect(pool.refs('a')).toBe(1);
    expect(pool.release('a', 'slot-1')).toBe(1);
    expect(pool.size()).toBe(0);
  });

  test('release of one fingerprint lets the queued one proceed', async () => {
    let n = 0;
    const pool = new SocketPool<string>();
    const create = (id: string) => () => {
      n += 1;
      return id;
    };
    const a = pool.acquire('a', create('a'));
    pool.acquire('b', create('b'));
    const third = pool.acquire('c', create('c'));
    expect(third.status).toBe('queued');
    if (third.status !== 'queued') throw new Error('expected queued');
    if (a.status !== 'live') throw new Error('expected live');
    const dead = pool.release('a');
    expect(dead).toBe('a');
    const value = await third.wait;
    expect(value).toBe('c');
    expect(n).toBe(3);
    expect(pool.size()).toBe(2);
    expect(pool.queued()).toBe(0);
    expect(pool.get('a')).toBeUndefined();
    expect(pool.get('c')).toBe('c');
  });
});
