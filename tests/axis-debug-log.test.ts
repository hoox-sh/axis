/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Rotating localStorage debug log (`src/debug-log.ts`).
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  AXIS_DEBUG_ENV_KEY,
  axisDebug,
  flushAxisDebugLog,
  readAxisDebugLog,
  resetAxisDebugSamples,
} from '../src/debug';
import {
  RotatingLogStore,
  axisDebugLogFilename,
  formatAxisDebugLine,
  setAxisDebugLogStore,
} from '../src/debug-log';
import { installMemoryLocalStorage } from './setup';

const originalAxis = process.env[AXIS_DEBUG_ENV_KEY];

afterEach(() => {
  if (originalAxis === undefined) delete process.env[AXIS_DEBUG_ENV_KEY];
  else process.env[AXIS_DEBUG_ENV_KEY] = originalAxis;
  resetAxisDebugSamples();
  setAxisDebugLogStore(null);
});

function memoryStorage() {
  const mem = installMemoryLocalStorage();
  return {
    getItem: (k: string) => mem.getItem(k),
    setItem: (k: string, v: string) => {
      mem.setItem(k, v);
      return true;
    },
    removeItem: (k: string) => mem.removeItem(k),
  };
}

describe('RotatingLogStore', () => {
  it('appends lines and reads them back after flush', () => {
    const store = new RotatingLogStore({
      fileCount: 3,
      fileBytes: 256,
      prefix: 't.log.',
      storage: memoryStorage(),
      flushMs: 60_000,
    });
    store.append('one\n');
    store.append('two\n');
    expect(store.readAll()).toBe('one\ntwo\n');
    store.flush();
    expect(store.readAll()).toBe('one\ntwo\n');
    expect(store.stats().lines).toBe(2);
  });

  it('rotates when the current file exceeds the byte cap', () => {
    const storage = memoryStorage();
    const store = new RotatingLogStore({
      fileCount: 3,
      fileBytes: 16,
      prefix: 't.log.',
      storage,
      flushMs: 60_000,
    });
    store.append('aaaaaaaa\n'); // 9
    store.append('bbbbbbbb\n'); // 9 → rotate, current = bbbbbbbb
    store.append('cccccccc\n'); // rotate again
    const all = store.readAll();
    expect(all).toContain('cccccccc\n');
    expect(all.indexOf('aaaaaaaa\n')).toBeLessThan(all.indexOf('bbbbbbbb\n'));
    expect(all.indexOf('bbbbbbbb\n')).toBeLessThan(all.indexOf('cccccccc\n'));
    expect(storage.getItem('t.log.1')).toBe('bbbbbbbb\n');
    expect(storage.getItem('t.log.2')).toBe('aaaaaaaa\n');
  });

  it('drops the oldest file when the ring is full', () => {
    const store = new RotatingLogStore({
      fileCount: 2,
      fileBytes: 8,
      prefix: 't.log.',
      storage: memoryStorage(),
      flushMs: 60_000,
    });
    store.append('aaaa\n'); // 5
    store.append('bbbb\n'); // rotate, 1=aaaa
    store.append('cccc\n'); // rotate, 1=bbbb, aaaa dropped
    const all = store.readAll();
    expect(all).not.toContain('aaaa\n');
    expect(all).toContain('bbbb\n');
    expect(all).toContain('cccc\n');
  });

  it('retries a failed write after dropping the oldest file', () => {
    const data = new Map<string, string>();
    let failOnce = true;
    const store = new RotatingLogStore({
      fileCount: 2,
      fileBytes: 64,
      prefix: 't.log.',
      flushMs: 60_000,
      storage: {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          if (failOnce && k === 't.log.0') {
            failOnce = false;
            return false;
          }
          data.set(k, v);
          return true;
        },
        removeItem: (k) => {
          data.delete(k);
        },
      },
    });
    store.append('hello\n');
    store.flush();
    expect(data.get('t.log.0')).toBe('hello\n');
  });

  it('clear wipes every file and the in-memory buffer', () => {
    const storage = memoryStorage();
    const store = new RotatingLogStore({
      fileCount: 2,
      fileBytes: 64,
      prefix: 't.log.',
      storage,
      flushMs: 60_000,
    });
    store.append('keep\n');
    store.flush();
    store.clear();
    expect(store.readAll()).toBe('');
    expect(storage.getItem('t.log.0')).toBeNull();
  });
});

describe('formatAxisDebugLine / filename', () => {
  it('writes an ISO line with JSON payload', () => {
    const line = formatAxisDebugLine('chart', 'setData', { n: 10 }, Date.parse('2026-10-26T12:00:00.000Z'));
    expect(line).toBe('2026-10-26T12:00:00.000Z [chart] setData {"n":10}\n');
  });

  it('builds a download filename from the timestamp', () => {
    expect(axisDebugLogFilename(Date.parse('2026-10-26T12:30:45.123Z'))).toBe(
      'axis-debug-20261026T123045Z.log',
    );
  });
});

describe('debug emit persists to the ring', () => {
  it('writes chart/engine lines into the singleton store', () => {
    const storage = memoryStorage();
    const store = new RotatingLogStore({
      fileCount: 2,
      fileBytes: 4096,
      prefix: 'axis.debug.log.',
      storage,
      flushMs: 60_000,
    });
    setAxisDebugLogStore(store);
    process.env[AXIS_DEBUG_ENV_KEY] = '1';
    axisDebug('chart', 'setData', { n: 4 });
    flushAxisDebugLog();
    const text = readAxisDebugLog();
    expect(text).toContain('[chart] setData');
    expect(text).toContain('"n":4');
  });
});
