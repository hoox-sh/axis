/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ShortcutHub dispatch core: chord matching, override reactivity, and the
 * dialog / editable-target skip guard. Uses the shared AXIS DOM stub (see
 * tests/setup.ts) — no jsdom dependency. The component's `onMount` wiring is
 * a thin `window.addEventListener` wrapper around {@link dispatchShortcut},
 * which is what these tests exercise.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  buildDispatchTable,
  dispatchShortcut,
  registerShortcut,
} from '../src/ui/shortcuts/Hub';
import { resetShortcuts, setShortcutOverride } from '../src/store';

/** Minimal HTMLElement so `target instanceof HTMLElement` works in the stub env. */
class FakeHTMLElement {
  tagName = 'DIV';
  isContentEditable = false;
  closest() {
    return null;
  }
}

function makeKeyEvent(init: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  defaultPrevented?: boolean;
}) {
  const ev = {
    type: 'keydown',
    key: init.key,
    ctrlKey: !!init.ctrlKey,
    metaKey: !!init.metaKey,
    shiftKey: !!init.shiftKey,
    altKey: !!init.altKey,
    target: init.target ?? null,
    defaultPrevented: !!init.defaultPrevented,
    preventDefault() {
      ev.defaultPrevented = true;
    },
    stopPropagation() {},
  };
  return ev as unknown as KeyboardEvent;
}

describe('ShortcutHub dispatch', () => {
  const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    resetShortcuts();
    (globalThis as { HTMLElement: unknown }).HTMLElement = FakeHTMLElement;
    cleanups.length = 0;
  });

  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
    if (originalHTMLElement === undefined) {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    } else {
      (globalThis as { HTMLElement: unknown }).HTMLElement = originalHTMLElement;
    }
  });

  it('invokes a registered action once for a matching chord', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.run', () => {
      calls++;
    }));
    const consumed = dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'Enter', ctrlKey: true }));
    expect(calls).toBe(1);
    expect(consumed).toBe(true);
  });

  it('does nothing for an unregistered chord', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.run', () => {
      calls++;
    }));
    const consumed = dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'k', ctrlKey: true }));
    expect(calls).toBe(0);
    expect(consumed).toBe(false);
  });

  it('honors overrides: new chord fires, old chord does not', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.run', () => {
      calls++;
    }));
    setShortcutOverride('app.run', 'Mod-Shift-Enter');
    const table = buildDispatchTable();
    dispatchShortcut(table, makeKeyEvent({ key: 'Enter', ctrlKey: true }));
    expect(calls).toBe(0);
    dispatchShortcut(table, makeKeyEvent({ key: 'Enter', ctrlKey: true, shiftKey: true }));
    expect(calls).toBe(1);
  });

  it('skips dispatch when a modal dialog is open', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.open-palette', () => {
      calls++;
    }));
    const origQuery = document.querySelector.bind(document);
    document.querySelector = ((sel: string) =>
      sel.includes('axis-command-palette') ? ({} as Element) : origQuery(sel)) as typeof document.querySelector;
    try {
      const consumed = dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'k', ctrlKey: true }));
      expect(calls).toBe(0);
      expect(consumed).toBe(false);
    } finally {
      document.querySelector = origQuery;
    }
  });

  it('skips dispatch when focus is in an editable input', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.open-palette', () => {
      calls++;
    }));
    const input = new FakeHTMLElement();
    input.tagName = 'INPUT';
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: 'k', ctrlKey: true, target: input }),
    );
    expect(calls).toBe(0);
    expect(consumed).toBe(false);
  });

  it('calls preventDefault when the binding matches', () => {
    cleanups.push(registerShortcut('app.run', () => {}));
    const ev = makeKeyEvent({ key: 'Enter', ctrlKey: true });
    dispatchShortcut(buildDispatchTable(), ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not fire when the user cleared the binding', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.run', () => {
      calls++;
    }));
    setShortcutOverride('app.run', null);
    const consumed = dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'Enter', ctrlKey: true }));
    expect(calls).toBe(0);
    expect(consumed).toBe(false);
  });

  it('does not fire when the event was already handled', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.run', () => {
      calls++;
    }));
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: 'Enter', ctrlKey: true, defaultPrevented: true }),
    );
    expect(calls).toBe(0);
    expect(consumed).toBe(false);
  });
});