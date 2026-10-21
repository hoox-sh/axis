// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The event-listener primitives.
 *
 * The scan found dozens of `onMount(() => target.addEventListener(...))` /
 * `onCleanup(() => target.removeEventListener(...))` pairs — the same four
 * lines, repeated, and easy to get subtly wrong (a missing `capture` flag on
 * one side, a listener that outlives its component).
 *
 * The test exercises the attach/detach contract directly: the Solid wrapper
 * needs a rendered component, and the register/remove pairing is the part
 * that can actually go wrong.
 */

import { describe, expect, it } from 'bun:test';
import { attachEventListener } from '../src/ui/use-event-listener';

/** A counting event target that records the options it was given. */
function fakeTarget() {
  const listeners = new Map<string, Set<(ev: Event) => void>>();
  const options: unknown[] = [];
  return {
    listeners,
    options,
    target: {
      addEventListener(type: string, listener: (ev: Event) => void, opts?: unknown) {
        options.push(opts);
        const set = listeners.get(type) ?? new Set<(ev: Event) => void>();
        listeners.set(type, set);
        set.add(listener);
      },
      removeEventListener(type: string, listener: (ev: Event) => void, opts?: unknown) {
        options.push(opts);
        listeners.get(type)?.delete(listener);
      },
    } as unknown as EventTarget,
  };
}

describe('attachEventListener', () => {
  it('registers the listener', () => {
    const { target, listeners } = fakeTarget();
    attachEventListener(target, 'keydown', () => {});
    expect(listeners.get('keydown')?.size).toBe(1);
  });

  it('removes the listener when the disposer runs', () => {
    const { target, listeners } = fakeTarget();
    const dispose = attachEventListener(target, 'keydown', () => {});
    dispose();
    expect(listeners.get('keydown')?.size).toBe(0);
  });

  it('is safe to dispose twice', () => {
    const { target, listeners } = fakeTarget();
    const dispose = attachEventListener(target, 'keydown', () => {});
    dispose();
    dispose();
    expect(listeners.get('keydown')?.size).toBe(0);
  });

  it('passes the same options to both halves', () => {
    const { target, options } = fakeTarget();
    const dispose = attachEventListener(target, 'pointerdown', () => {}, { capture: true });
    dispose();
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ capture: true });
    expect(options[1]).toEqual({ capture: true });
  });

  it('ignores a missing target', () => {
    const dispose = attachEventListener(null, 'keydown', () => {});
    expect(() => dispose()).not.toThrow();
    const dispose2 = attachEventListener(undefined, 'keydown', () => {});
    expect(() => dispose2()).not.toThrow();
  });
});
