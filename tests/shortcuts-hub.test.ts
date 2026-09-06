/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ShortcutHub dispatch core: chord matching, override reactivity, the
 * dialog / editable-target skip guard, and the app-level bindings registered
 * by actions.ts (palette toggle, save/run/settings/escape CustomEvents).
 * Uses the shared AXIS DOM stub (see tests/setup.ts) — no jsdom dependency.
 * The component's `onMount` wiring is a thin `window.addEventListener`
 * wrapper around {@link dispatchShortcut}, which is what these tests exercise.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  buildDispatchTable,
  dispatchShortcut,
  registerShortcut,
} from '../src/ui/shortcuts/Hub';
import { isPaletteOpen, closePalette } from '../src/ui/shortcuts/palette-bridge';
import { resetShortcuts, setShortcutOverride, isPanelOpen, store, setDrawingTool } from '../src/store';

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

/** Listener-based window stub that records dispatched CustomEvents. */
function installWindowEventStub() {
  const originalWindow = globalThis.window;
  const listeners: Record<string, Array<(e: Event) => void>> = {};
  const fired: string[] = [];
  // @ts-expect-error test stub
  globalThis.window = {
    addEventListener(type: string, fn: (e: Event) => void) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: (e: Event) => void) {
      listeners[type] = (listeners[type] ?? []).filter((x) => x !== fn);
    },
    dispatchEvent(ev: Event) {
      fired.push(ev.type);
      for (const fn of listeners[ev.type] ?? []) fn(ev);
      return true;
    },
  };
  return {
    fired,
    restore() {
      // @ts-expect-error restore
      globalThis.window = originalWindow;
    },
  };
}

describe('ShortcutHub dispatch', () => {
  const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    resetShortcuts();
    closePalette();
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

  it('does nothing for a chord with no registered action', () => {
    // editor.toggle-comment (Mod-/) is in the table but its action lives in
    // the editor keymap (subtask 05) — not registered in this test env.
    let calls = 0;
    const consumed = dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: '/', ctrlKey: true }));
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

  it('skips app.escape when a modal dialog is open', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.escape', () => {
      calls++;
    }));
    const origQuery = document.querySelector.bind(document);
    document.querySelector = ((sel: string) =>
      sel.includes('axis-command-palette') ? ({} as Element) : origQuery(sel)) as typeof document.querySelector;
    try {
      const consumed = dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'Escape' }));
      expect(calls).toBe(0);
      expect(consumed).toBe(false);
    } finally {
      document.querySelector = origQuery;
    }
  });

  it('skips app.escape when focus is in an editable input', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.escape', () => {
      calls++;
    }));
    const input = new FakeHTMLElement();
    input.tagName = 'INPUT';
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: 'Escape', target: input }),
    );
    expect(calls).toBe(0);
    expect(consumed).toBe(false);
  });

  it('fires app.open-palette even when a dialog is open (global open chord)', () => {
    let calls = 0;
    cleanups.push(registerShortcut('app.open-palette', () => {
      calls++;
    }));
    const origQuery = document.querySelector.bind(document);
    document.querySelector = ((sel: string) =>
      sel.includes('axis-command-palette') ? ({} as Element) : origQuery(sel)) as typeof document.querySelector;
    try {
      const consumed = dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'k', ctrlKey: true }));
      expect(calls).toBe(1);
      expect(consumed).toBe(true);
    } finally {
      document.querySelector = origQuery;
    }
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

describe('app-level bindings (actions.ts)', () => {
  const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
  let win: ReturnType<typeof installWindowEventStub>;

  beforeEach(() => {
    resetShortcuts();
    closePalette();
    (globalThis as { HTMLElement: unknown }).HTMLElement = FakeHTMLElement;
    win = installWindowEventStub();
  });

  afterEach(() => {
    win.restore();
    if (originalHTMLElement === undefined) {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    } else {
      (globalThis as { HTMLElement: unknown }).HTMLElement = originalHTMLElement;
    }
  });

  it('Mod-K toggles the palette open signal', () => {
    expect(isPaletteOpen()).toBe(false);
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'k', ctrlKey: true }));
    expect(isPaletteOpen()).toBe(true);
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'k', ctrlKey: true }));
    expect(isPaletteOpen()).toBe(false);
  });

  it('Mod-Shift-P toggles the palette open signal', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'P', ctrlKey: true, shiftKey: true }));
    expect(isPaletteOpen()).toBe(true);
  });

  it('Mod-S fires axis-editor-save-library', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 's', ctrlKey: true }));
    expect(win.fired).toContain('axis-editor-save-library');
  });

  it('Mod-Enter fires axis-editor-run', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'Enter', ctrlKey: true }));
    expect(win.fired).toContain('axis-editor-run');
  });

  it('Mod-, fires axis-open-settings', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: ',', ctrlKey: true }));
    expect(win.fired).toContain('axis-open-settings');
  });

  it('Shift-? fires axis-shortcuts-open', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: '?', shiftKey: true }));
    expect(win.fired).toContain('axis-shortcuts-open');
  });

  it('Esc fires axis-escape when nothing is open', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'Escape' }));
    expect(win.fired).toContain('axis-escape');
  });

  it('Esc does not fire axis-escape while the palette is open (no double-fire)', () => {
    const origQuery = document.querySelector.bind(document);
    document.querySelector = ((sel: string) =>
      sel.includes('axis-command-palette') ? ({} as Element) : origQuery(sel)) as typeof document.querySelector;
    try {
      dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'Escape' }));
      expect(win.fired).not.toContain('axis-escape');
    } finally {
      document.querySelector = origQuery;
    }
  });

  it('Mod-\\ toggles the editor panel', () => {
    const before = isPanelOpen('editor');
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: '\\', ctrlKey: true }));
    expect(isPanelOpen('editor')).toBe(!before);
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: '\\', ctrlKey: true }));
    expect(isPanelOpen('editor')).toBe(before);
  });
});

describe('chart-level bindings (actions.ts)', () => {
  const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
  let win: ReturnType<typeof installWindowEventStub>;

  beforeEach(() => {
    resetShortcuts();
    closePalette();
    setDrawingTool('cursor');
    (globalThis as { HTMLElement: unknown }).HTMLElement = FakeHTMLElement;
    win = installWindowEventStub();
  });

  afterEach(() => {
    win.restore();
    if (originalHTMLElement === undefined) {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    } else {
      (globalThis as { HTMLElement: unknown }).HTMLElement = originalHTMLElement;
    }
  });

  it('E dispatches setDrawingTool(eraser)', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'e' }));
    expect(store.drawingTool).toBe('eraser');
  });

  it('Alt-1 dispatches setChartGridMode(1)', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: '1', altKey: true }));
    expect(store.chartLayout.mode).toBe('1');
  });

  it('single-letter chart chord does NOT dispatch inside an input', () => {
    const input = new FakeHTMLElement();
    input.tagName = 'INPUT';
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: 'e', target: input }),
    );
    expect(consumed).toBe(false);
    expect(store.drawingTool).toBe('cursor');
  });

  it('Esc fires axis-drawing-cancel-draft (chart draft cancel)', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 'Escape' }));
    expect(win.fired).toContain('axis-drawing-cancel-draft');
    expect(win.fired).toContain('axis-escape');
  });
});