/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `Atomics.wait` is worker-only (HP PR 4, §8.3).
 *
 * The browser throws `TypeError` when the Window thread blocks; this guard
 * refuses earlier and louder so the mistake shows up as a failing test
 * instead of a frozen chart. A test stubs `globalThis.Window` / `self` to
 * simulate the Window thread — Bun itself has no `Window`, which is exactly
 * the "worker-like" case below.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { HpControlBlock, HP_GEN_INDEX, HP_NOTIFY_INDEX } from '../../src/hp/memory/control-block';
import { HP_CONTROL_BYTES } from '../../src/hp/memory/layout';
import { isMainThread } from '../../src/hp/sync/is-main-thread';
import { loadGen, notify, storeGen, waitInWorker } from '../../src/hp/sync/atomics';

type Windowish = { Window?: unknown; self?: unknown };

const g = globalThis as Windowish;
const hadWindow = 'Window' in g;
const hadSelf = 'self' in g;
const prevWindow = g.Window;
const prevSelf = g.self;

function asWindowThread(): void {
  class FakeWindow {}
  g.Window = FakeWindow;
  g.self = new FakeWindow();
}

function restoreGlobals(): void {
  if (hadWindow) g.Window = prevWindow;
  else delete g.Window;
  if (hadSelf) g.self = prevSelf;
  else delete g.self;
}

afterEach(restoreGlobals);

function fresh(): { i32: Int32Array; control: HpControlBlock } {
  const sab = new SharedArrayBuffer(HP_CONTROL_BYTES);
  const control = new HpControlBlock(sab);
  control.init();
  return { i32: control.i32, control };
}

describe('isMainThread', () => {
  test('is false where there is no Window constructor (worker / Bun)', () => {
    restoreGlobals();
    expect(isMainThread()).toBe(false);
  });

  test('is true when self is an instance of Window', () => {
    asWindowThread();
    expect(isMainThread()).toBe(true);
  });

  test('is false when Window exists but self is not one', () => {
    class FakeWindow {}
    g.Window = FakeWindow;
    g.self = {};
    expect(isMainThread()).toBe(false);
  });
});

describe('waitInWorker', () => {
  test('throws on the simulated Window thread before touching Atomics', () => {
    const { i32 } = fresh();
    asWindowThread();
    expect(() => waitInWorker(i32, 0, 0, 1)).toThrow(/Window thread/);
  });

  test('returns not-equal immediately when the word already moved', () => {
    restoreGlobals();
    const { i32 } = fresh();
    Atomics.store(i32, 0, 5);
    expect(waitInWorker(i32, 0, 4, 50)).toBe('not-equal');
  });

  test('times out instead of hanging when nothing notifies', () => {
    restoreGlobals();
    const { i32 } = fresh();
    // The real worker parks on the generation word (0 after init) until a
    // commit bumps it; with no writer the wait must end, not hang.
    expect(waitInWorker(i32, HP_GEN_INDEX, 0, 1)).toBe('timed-out');
  });

  test('a writer commit releases a parked waiter on the notify word', async () => {
    restoreGlobals();
    const { control } = fresh();
    // A worker parks on the notify word; `waitAsync` is the non-blocking way
    // to observe the same wake-up from this test thread (blocking here would
    // freeze the suite, which is exactly what the guard above prevents).
    const parked = Atomics.waitAsync(control.i32, HP_NOTIFY_INDEX, 0, 5_000);
    expect(parked.async).toBe(true);

    control.beginWrite(1); // generation → odd
    control.commitWrite(); // publish + Atomics.notify(HP_NOTIFY_INDEX, 3)

    expect(await parked.value).toBe('ok');
    expect(control.generation).toBe(2); // odd → even by the commit
  });
});

describe('generation helpers', () => {
  test('loadGen and storeGen round-trip the seqlock word', () => {
    restoreGlobals();
    const { control } = fresh();
    expect(loadGen(control)).toBe(0);
    storeGen(control, 4);
    expect(loadGen(control)).toBe(4);
    storeGen(control, 5);
    expect(loadGen(control)).toBe(5);
  });

  test('notify is safe with nobody waiting', () => {
    restoreGlobals();
    const { i32 } = fresh();
    expect(notify(i32, HP_NOTIFY_INDEX, 1)).toBe(0);
  });
});
