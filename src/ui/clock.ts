// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared 1 Hz wall-clock for status chrome (E18).
 *
 * ConnectionHud, McpHud, TimePanel, and CurrentPriceCard each ran their own
 * `setInterval(1000)`. One module-level signal + one interval serves all
 * subscribers; the interval stops when the last subscriber unmounts.
 *
 * @module ui/clock
 */

import { createSignal, onCleanup } from 'solid-js';

const [now, setNow] = createSignal(Date.now());

let timer: number | undefined;
let subscribers = 0;

function ensureTimer(): void {
  if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
  if (timer === undefined) {
    timer = window.setInterval(() => setNow(Date.now()), 1000);
  }
  subscribers += 1;
}

function releaseTimer(): void {
  subscribers -= 1;
  if (subscribers <= 0) {
    subscribers = 0;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }
}

/**
 * Reactive current time in ms, refreshed every second while mounted.
 * Must be called inside a component (registers an `onCleanup`).
 */
export function useNow(): () => number {
  ensureTimer();
  onCleanup(releaseTimer);
  return now;
}
