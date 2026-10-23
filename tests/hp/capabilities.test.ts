/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  isolationProbe,
  rememberHpRung,
  selectHpRung,
  type IsolationHost,
} from '../../src/hp/capabilities';
import { HP_RUNG_SESSION_KEY, resetHpFlags } from '../../src/hp/feature-flag';

afterEach(() => {
  resetHpFlags();
});

function host(partial: IsolationHost): IsolationHost {
  return partial;
}

describe('isolationProbe', () => {
  test('SAB is false unless the document is isolated', () => {
    const sab = function FakeSharedArrayBuffer() {};
    const closed = isolationProbe(host({ SharedArrayBuffer: sab, crossOriginIsolated: false }));
    expect(closed.isolated).toBe(false);
    expect(closed.sab).toBe(false);
    const open = isolationProbe(host({ SharedArrayBuffer: sab, crossOriginIsolated: true }));
    expect(open.isolated).toBe(true);
    expect(open.sab).toBe(true);
  });

  test('waitAsync / offscreen / webgpu / webgl2 are capability bits', () => {
    const p = isolationProbe(
      host({
        Atomics: { waitAsync: () => {} },
        OffscreenCanvas: function FakeOffscreenCanvas() {},
        navigator: { gpu: {} },
        document: {
          createElement: () => ({ getContext: (name: string) => (name === 'webgl2' ? {} : null) }),
        },
      }),
    );
    expect(p.waitAsync).toBe(true);
    expect(p.offscreen).toBe(true);
    expect(p.webgpu).toBe(true);
    expect(p.webgl2).toBe(true);
  });

  test('missing GPU surfaces stay false', () => {
    const p = isolationProbe(host({}));
    expect(p.webgpu).toBe(false);
    expect(p.webgl2).toBe(false);
    expect(p.offscreen).toBe(false);
    expect(p.waitAsync).toBe(false);
  });
});

describe('selectHpRung', () => {
  const isolatedSab = isolationProbe(
    host({ SharedArrayBuffer: function FakeSharedArrayBuffer() {}, crossOriginIsolated: true }),
  );

  test('kill switch and opt-in default to HP-0', () => {
    expect(selectHpRung(isolatedSab, { enabled: true, disabled: true })).toBe(0);
    expect(selectHpRung(isolatedSab, { enabled: false, disabled: false })).toBe(0);
  });

  test('enabled + SAB + no GPU is HP-2; no SAB is HP-1', () => {
    expect(
      selectHpRung(isolatedSab, { enabled: true, disabled: false, gpu: 'off', sab: 'auto' }),
    ).toBe(2);
    const copy = isolationProbe(host({ SharedArrayBuffer: function FakeSharedArrayBuffer() {} }));
    expect(selectHpRung(copy, { enabled: true, disabled: false, gpu: 'off', sab: 'auto' })).toBe(1);
  });

  test('sab=off forces transferable even when isolated', () => {
    expect(
      selectHpRung(isolatedSab, { enabled: true, disabled: false, gpu: 'off', sab: 'off' }),
    ).toBe(1);
  });

  test('auto GPU prefers WebGPU then WebGL2', () => {
    const gpu = isolationProbe(
      host({
        navigator: { gpu: {} },
        document: { createElement: () => ({ getContext: () => ({}) }) },
      }),
    );
    expect(selectHpRung(gpu, { enabled: true, disabled: false, gpu: 'auto' })).toBe(4);
    const gl = isolationProbe(
      host({
        document: { createElement: () => ({ getContext: (n: string) => (n === 'webgl2' ? {} : null) }) },
      }),
    );
    expect(selectHpRung(gl, { enabled: true, disabled: false, gpu: 'auto' })).toBe(3);
  });

  test('session rung only clamps downward', () => {
    expect(
      selectHpRung(isolatedSab, {
        enabled: true,
        disabled: false,
        gpu: 'off',
        storedRung: 1,
      }),
    ).toBe(1);
    expect(
      selectHpRung(isolatedSab, {
        enabled: true,
        disabled: false,
        gpu: 'off',
        storedRung: 4,
      }),
    ).toBe(2);
  });

  test('rememberHpRung writes the session cap', () => {
    const bag = new Map<string, string>();
    const fake = {
      getItem: (k: string) => bag.get(k) ?? null,
      setItem: (k: string, v: string) => {
        bag.set(k, v);
      },
      removeItem: (k: string) => {
        bag.delete(k);
      },
    };
    (globalThis as { sessionStorage?: typeof fake }).sessionStorage = fake;
    try {
      rememberHpRung(1);
      expect(fake.getItem(HP_RUNG_SESSION_KEY)).toBe('1');
    } finally {
      delete (globalThis as { sessionStorage?: typeof fake }).sessionStorage;
    }
  });
});
