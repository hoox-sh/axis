/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Focus trap pure behavior — uses minimal doubles (test document stub has no querySelectorAll).
 */

import { describe, expect, it } from 'bun:test';
import { listFocusable, installFocusTrap } from '../src/ui/focus-trap';

function makeRoot(children: Array<{ tag: string; disabled?: boolean }>) {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const kids: Array<Record<string, unknown>> = [];
  for (const c of children) {
    kids.push({
      tagName: c.tag.toUpperCase(),
      disabled: !!c.disabled,
      closest: () => null,
      focus: () => {},
      addEventListener: () => {},
    });
  }
  const root = {
    querySelectorAll: (sel: string) => {
      // Super-light: return all non-disabled button/input children
      if (!sel.includes('button') && !sel.includes('input')) return [];
      return kids.filter((k) => !k.disabled);
    },
    addEventListener: (type: string, fn: (...a: unknown[]) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (...a: unknown[]) => void) => {
      listeners.get(type)?.delete(fn);
    },
    focus: () => {},
    hasAttribute: () => false,
    tabIndex: -1,
    contains: () => true,
    _listeners: listeners,
  };
  return root as unknown as HTMLElement;
}

describe('listFocusable', () => {
  it('returns empty when querySelectorAll missing', () => {
    expect(listFocusable({} as HTMLElement)).toEqual([]);
  });

  it('collects focusable children from a double', () => {
    const root = makeRoot([
      { tag: 'button' },
      { tag: 'input' },
      { tag: 'button', disabled: true },
    ]);
    const list = listFocusable(root);
    expect(list).toHaveLength(2);
  });
});

describe('installFocusTrap', () => {
  it('disposes without throw', () => {
    const root = makeRoot([{ tag: 'button' }]);
    const dispose = installFocusTrap(root, { autoFocus: false });
    expect(typeof dispose).toBe('function');
    dispose();
  });

  it('no-ops on invalid root', () => {
    const dispose = installFocusTrap(null as unknown as HTMLElement);
    dispose();
  });
});

