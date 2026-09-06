/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import {
  listenForPwaInstallPrompt,
  pwaInstallAvailable,
  promptPwaInstall,
  dismissPwaInstallPrompt,
  _resetPwaInstallPromptForTests,
  type BeforeInstallPromptEvent,
} from '../src/pwa/install-prompt';

function fireBeforeInstallPrompt(): { prompt: ReturnType<typeof mock> } {
  const prompt = mock(async () => {});
  const ev = {
    type: 'beforeinstallprompt',
    preventDefault() {},
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  } as unknown as BeforeInstallPromptEvent;
  globalThis.window.dispatchEvent(ev);
  return { prompt };
}

describe('pwa install prompt', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    _resetPwaInstallPromptForTests();
    const listeners: Record<string, Array<(e: Event) => void>> = {};
    // @ts-expect-error test stub
    globalThis.window = {
      addEventListener(type: string, fn: (e: Event) => void) {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener(type: string, fn: (e: Event) => void) {
        listeners[type] = (listeners[type] ?? []).filter((x) => x !== fn);
      },
      dispatchEvent(ev: Event) {
        for (const fn of listeners[ev.type] ?? []) fn(ev);
        return true;
      },
    };
  });

  afterEach(() => {
    _resetPwaInstallPromptForTests();
    // @ts-expect-error restore
    globalThis.window = originalWindow;
  });

  it('stays hidden until beforeinstallprompt fires', () => {
    listenForPwaInstallPrompt();
    expect(pwaInstallAvailable()).toBe(false);
    fireBeforeInstallPrompt();
    expect(pwaInstallAvailable()).toBe(true);
  });

  it('promptPwaInstall consumes the event and hides the chip', async () => {
    listenForPwaInstallPrompt();
    const { prompt } = fireBeforeInstallPrompt();
    expect(await promptPwaInstall()).toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(pwaInstallAvailable()).toBe(false);
  });

  it('dismiss hides without calling prompt and does not nag again', () => {
    listenForPwaInstallPrompt();
    fireBeforeInstallPrompt();
    dismissPwaInstallPrompt();
    expect(pwaInstallAvailable()).toBe(false);
    fireBeforeInstallPrompt();
    expect(pwaInstallAvailable()).toBe(false);
  });
});
