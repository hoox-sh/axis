/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Shortcut keypress feedback contract: `dispatchShortcut` must emit the
 * `axis-shortcut-fired` CustomEvent (id / chord / description) for every key it
 * consumes, and never for default-prevented, cleared, or skip-guarded keys.
 * This is the Feedback.tsx UI contract; dispatch-core behavior is covered in
 * shortcuts-hub.test.ts. Uses the shared AXIS DOM stub (tests/setup.ts).
 * See .opencode/context/ui/feedback-surfaces.md for the surface rationale.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { buildDispatchTable, dispatchShortcut } from '../src/ui/shortcuts/Hub';
import { SHORTCUT_FIRED_EVENT } from '../src/ui/shortcuts/Feedback';
import { isPaletteOpen, closePalette } from '../src/ui/shortcuts/palette-bridge';
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

/** Window stub that records every dispatched Event object (not just types). */
function installWindowEventStub() {
  const originalWindow = globalThis.window;
  const listeners: Record<string, Array<(e: Event) => void>> = {};
  const fired: Event[] = [];
  (globalThis as { window: unknown }).window = {
    addEventListener(type: string, fn: (e: Event) => void) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener(type: string, fn: (e: Event) => void) {
      listeners[type] = (listeners[type] ?? []).filter((x) => x !== fn);
    },
    dispatchEvent(ev: Event) {
      fired.push(ev);
      for (const fn of listeners[ev.type] ?? []) fn(ev);
      return true;
    },
  };
  return {
    fired,
    restore() {
      (globalThis as { window: unknown }).window = originalWindow;
    },
  };
}

describe('shortcut feedback event', () => {
  const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
  let env: ReturnType<typeof installWindowEventStub>;

  beforeEach(() => {
    resetShortcuts();
    closePalette();
    (globalThis as { HTMLElement: unknown }).HTMLElement = FakeHTMLElement;
    env = installWindowEventStub();
  });

  afterEach(() => {
    env.restore();
    resetShortcuts();
    closePalette();
    if (originalHTMLElement === undefined) {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    } else {
      (globalThis as { HTMLElement: unknown }).HTMLElement = originalHTMLElement;
    }
  });

  const firedEvents = () => env.fired.map((e) => e as CustomEvent);
  const feedbackEvents = () => firedEvents().filter((e) => e.type === SHORTCUT_FIRED_EVENT);

  it('emits axis-shortcut-fired with id/chord/description for Mod-K (palette)', () => {
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: 'k', ctrlKey: true }),
    );
    expect(consumed).toBe(true);
    expect(isPaletteOpen()).toBe(true);
    const events = feedbackEvents();
    expect(events.length).toBe(1);
    expect(events[0].detail).toEqual({
      id: 'app.open-palette',
      chord: 'Mod-K',
      description: 'Open command palette',
    });
  });

  it('emits alongside the real action side effects (Mod-S save)', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: 's', ctrlKey: true }));
    const types = env.fired.map((e) => e.type);
    expect(types).toContain('axis-editor-save-library');
    expect(types).toContain(SHORTCUT_FIRED_EVENT);
  });

  it('emits for Shift-? (shortcuts help)', () => {
    dispatchShortcut(buildDispatchTable(), makeKeyEvent({ key: '?', shiftKey: true }));
    const types = env.fired.map((e) => e.type);
    expect(types).toContain('axis-shortcuts-open');
    expect(types).toContain(SHORTCUT_FIRED_EVENT);
  });

  it('does not emit when the event was already handled (defaultPrevented)', () => {
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: 'k', ctrlKey: true, defaultPrevented: true }),
    );
    expect(consumed).toBe(false);
    expect(feedbackEvents().length).toBe(0);
  });

  it('does not emit when the binding was cleared by an override', () => {
    setShortcutOverride('app.open-settings', null);
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: ',', ctrlKey: true }),
    );
    expect(consumed).toBe(false);
    expect(feedbackEvents().length).toBe(0);
  });

  it('does not emit when the skip guard suppresses a chart chord in an input', () => {
    const input = new FakeHTMLElement();
    input.tagName = 'INPUT';
    const consumed = dispatchShortcut(
      buildDispatchTable(),
      makeKeyEvent({ key: 'q', target: input }),
    );
    expect(consumed).toBe(false);
    expect(feedbackEvents().length).toBe(0);
  });
});
