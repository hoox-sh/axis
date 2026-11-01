/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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

  it('wires a focusin guard when document exists, removed on dispose', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const prev = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = {
      activeElement: null,
      addEventListener: (type: string) => {
        added.push(type);
      },
      removeEventListener: (type: string) => {
        removed.push(type);
      },
    };
    try {
      const root = makeRoot([{ tag: 'button' }]);
      const dispose = installFocusTrap(root, { autoFocus: false });
      expect(added).toContain('focusin');
      dispose();
      expect(removed).toContain('focusin');
    } finally {
      (globalThis as Record<string, unknown>).document = prev;
    }
  });

  it('focuses returnElement on dispose', () => {
    const focused: string[] = [];
    const ret = {
      focus: () => {
        focused.push('return');
      },
    };
    const prevActive = {
      focus: () => {
        focused.push('prev');
      },
      addEventListener: () => {},
    };
    const prev = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = {
      activeElement: prevActive,
      addEventListener: () => {},
      removeEventListener: () => {},
      contains: () => true,
    };
    try {
      const root = makeRoot([{ tag: 'button' }]);
      const dispose = installFocusTrap(root, {
        autoFocus: false,
        returnElement: ret as unknown as HTMLElement,
      });
      dispose();
      expect(focused).toEqual(['return']);
    } finally {
      (globalThis as Record<string, unknown>).document = prev;
    }
  });

  it('sets aria-hidden on siblings while trapped and restores on dispose', () => {
    type AttrEl = {
      parentElement: AttrEl | null;
      children: AttrEl[];
      getAttribute: (k: string) => string | null;
      setAttribute: (k: string, v: string) => void;
      removeAttribute: (k: string) => void;
      addEventListener: () => void;
      removeEventListener: () => void;
      focus: () => void;
      contains: () => boolean;
      querySelectorAll: () => unknown[];
      hasAttribute: () => boolean;
      tabIndex: number;
    };
    const makeEl = (): AttrEl => {
      const attrs: Record<string, string> = {};
      return {
        parentElement: null,
        children: [],
        getAttribute: (k) => attrs[k] ?? null,
        setAttribute: (k, v) => {
          attrs[k] = v;
        },
        removeAttribute: (k) => {
          delete attrs[k];
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        focus: () => {},
        contains: () => true,
        querySelectorAll: () => [],
        hasAttribute: () => false,
        tabIndex: -1,
      };
    };
    const html = makeEl();
    const body = makeEl();
    const sibling = makeEl();
    const alreadyHidden = makeEl();
    alreadyHidden.setAttribute('aria-hidden', 'true');
    const previouslyFalse = makeEl();
    previouslyFalse.setAttribute('aria-hidden', 'false');
    const root = makeEl();
    html.children = [body];
    body.parentElement = html;
    body.children = [sibling, alreadyHidden, previouslyFalse, root];
    sibling.parentElement = body;
    alreadyHidden.parentElement = body;
    previouslyFalse.parentElement = body;
    root.parentElement = body;

    const prev = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = {
      body,
      documentElement: html,
      activeElement: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      contains: () => true,
    };
    try {
      const dispose = installFocusTrap(root as unknown as HTMLElement, { autoFocus: false });
      expect(sibling.getAttribute('aria-hidden')).toBe('true');
      expect(alreadyHidden.getAttribute('aria-hidden')).toBe('true');
      expect(previouslyFalse.getAttribute('aria-hidden')).toBe('true');
      dispose();
      expect(sibling.getAttribute('aria-hidden')).toBe(null);
      expect(alreadyHidden.getAttribute('aria-hidden')).toBe('true');
      expect(previouslyFalse.getAttribute('aria-hidden')).toBe('false');
    } finally {
      (globalThis as Record<string, unknown>).document = prev;
    }
  });
});

