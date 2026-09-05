/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Modest PWA install affordance. Captures `beforeinstallprompt` once and
 * surfaces it until the user accepts, dismisses Chrome's prompt, or hides
 * the chip this session. Never re-prompts after a dismiss.
 *
 * @module pwa/install-prompt
 */

import { createSignal } from 'solid-js';

/** Chromium `beforeinstallprompt` event (not in lib.dom yet). */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const [available, setAvailable] = createSignal(false);

let deferred: BeforeInstallPromptEvent | null = null;
let dismissedThisSession = false;
let listening = false;

/** True when Chrome has offered an install prompt we have not used or dismissed. */
export function pwaInstallAvailable(): boolean {
  return available();
}

function onBeforeInstallPrompt(e: Event): void {
  e.preventDefault();
  if (dismissedThisSession) return;
  deferred = e as BeforeInstallPromptEvent;
  setAvailable(true);
}

function onAppInstalled(): void {
  deferred = null;
  setAvailable(false);
}

/** Listen once per page. Safe to call from product boot. */
export function listenForPwaInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  if (listening) return;
  listening = true;
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
}

/** Trigger the captured Chromium install prompt. */
export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    deferred = null;
    setAvailable(false);
    if (outcome === 'dismissed') dismissedThisSession = true;
    return outcome;
  } catch {
    deferred = null;
    setAvailable(false);
    return 'unavailable';
  }
}

/** Hide the chip for this session without calling `prompt()`. */
export function dismissPwaInstallPrompt(): void {
  dismissedThisSession = true;
  deferred = null;
  setAvailable(false);
}

/** Test helper. */
export function _resetPwaInstallPromptForTests(): void {
  deferred = null;
  dismissedThisSession = false;
  listening = false;
  setAvailable(false);
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', onAppInstalled);
  }
}
