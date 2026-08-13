// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Screen-reader status announcer (polite / assertive live regions).
 * High-frequency tick streams must not use this — load/run/error only.
 *
 * @module ui/sr-announce
 */

type Politeness = 'polite' | 'assertive';

let politeEl: HTMLElement | null = null;
let assertiveEl: HTMLElement | null = null;

function ensureRegion(kind: Politeness): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (kind === 'polite' && politeEl?.isConnected) return politeEl;
  if (kind === 'assertive' && assertiveEl?.isConnected) return assertiveEl;

  const el = document.createElement('div');
  el.id = kind === 'polite' ? 'axis-sr-polite' : 'axis-sr-assertive';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', kind);
  el.setAttribute('aria-atomic', 'true');
  el.className = 'sr-only';
  document.body.appendChild(el);
  if (kind === 'polite') politeEl = el;
  else assertiveEl = el;
  return el;
}

/** Announce a short status message to assistive tech. */
export function announce(message: string, politeness: Politeness = 'polite'): void {
  const text = String(message || '').trim();
  if (!text) return;
  const el = ensureRegion(politeness);
  if (!el) return;
  // Clear then set so repeated identical messages still fire
  el.textContent = '';
  try {
    // Force a reflow so AT re-reads the same string
    void el.offsetWidth;
  } catch {
    /* ignore */
  }
  el.textContent = text;
}

/** Assertive variant for errors / hard failures. */
export function announceError(message: string): void {
  announce(message, 'assertive');
}
