/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Close guard: predicate registry, master switch, and beforeunload prompt
 * (listener injected — no real window needed).
 */

import './setup';
import { describe, expect, it, beforeEach, mock } from 'bun:test';
import {
  _resetCloseGuardForTests,
  closeGuardPredicateIds,
  getCloseGuardMessage,
  installCloseGuard,
  isCloseGuardEnabled,
  registerCloseGuardPredicate,
  setCloseGuardEnabled,
  setCloseGuardMessage,
  shouldConfirmClose,
  uninstallCloseGuard,
  unregisterCloseGuardPredicate,
} from '../src/pwa/close-guard';

function fakeTarget() {
  const listeners = new Map<string, Set<(e: never) => void>>();
  return {
    listeners,
    addEventListener: mock((type: string, fn: (e: never) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: mock((type: string, fn: (e: never) => void) => {
      listeners.get(type)?.delete(fn);
    }),
    fire(type: string, event: never) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

beforeEach(() => {
  _resetCloseGuardForTests();
});

describe('predicate registry', () => {
  it('confirms only when a predicate reports dirty work', () => {
    expect(shouldConfirmClose()).toBe(false);
    const unregister = registerCloseGuardPredicate('editor-tabs', () => false);
    expect(shouldConfirmClose()).toBe(false);
    unregister();
    registerCloseGuardPredicate('editor-tabs', () => true);
    expect(shouldConfirmClose()).toBe(true);
    expect(closeGuardPredicateIds()).toEqual(['editor-tabs']);
    unregisterCloseGuardPredicate('editor-tabs');
    expect(shouldConfirmClose()).toBe(false);
  });

  it('a throwing predicate never blocks unload', () => {
    registerCloseGuardPredicate('broken', () => {
      throw new Error('boom');
    });
    expect(shouldConfirmClose()).toBe(false);
  });

  it('master switch suppresses the prompt', () => {
    registerCloseGuardPredicate('editor-tabs', () => true);
    expect(isCloseGuardEnabled()).toBe(true);
    setCloseGuardEnabled(false);
    expect(shouldConfirmClose()).toBe(false);
    setCloseGuardEnabled(true);
    expect(shouldConfirmClose()).toBe(true);
  });
});

describe('message', () => {
  it('defaults and can be overridden', () => {
    expect(getCloseGuardMessage()).toContain('unsaved');
    setCloseGuardMessage('  ');
    expect(getCloseGuardMessage()).toContain('unsaved');
    setCloseGuardMessage('Custom prompt');
    expect(getCloseGuardMessage()).toBe('Custom prompt');
  });
});

describe('installCloseGuard', () => {
  it('prompts on beforeunload while dirty, silent when clean', () => {
    const target = fakeTarget();
    // @ts-expect-error test stub
    installCloseGuard(target);
    let dirty = false;
    registerCloseGuardPredicate('editor-tabs', () => dirty);

    let prevented = false;
    const clean = { preventDefault: () => { prevented = true; } };
    target.fire('beforeunload', clean as never);
    expect(prevented).toBe(false);

    dirty = true;
    let returnValue: unknown;
    const dirtyEvent = {
      preventDefault: () => { prevented = true; },
      set returnValue(v: unknown) {
        returnValue = v;
      },
      get returnValue() {
        return returnValue;
      },
    };
    target.fire('beforeunload', dirtyEvent as never);
    expect(prevented).toBe(true);
    expect(returnValue).toContain('unsaved');
    uninstallCloseGuard();
  });

  it('is idempotent and uninstalls cleanly', () => {
    const target = fakeTarget();
    // @ts-expect-error test stub
    const uninstallA = installCloseGuard(target);
    // @ts-expect-error test stub
    const uninstallB = installCloseGuard(target);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    expect(uninstallA).toBe(uninstallB);
    uninstallA();
    expect(target.listeners.get('beforeunload')?.size ?? 0).toBe(0);
  });

  it('no-ops without a target', () => {
    expect(installCloseGuard(null)()).toBeUndefined();
  });
});
