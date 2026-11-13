// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pending subpage request for the Results overlay.
 *
 * The overlay is code-split: it mounts only once `store.resultsPanel.open`
 * flips, so its own listeners do not exist at the moment a run finishes.
 * `apply-strategy` used to open the panel and dispatch `axis-results-tab`
 * synchronously, which a lazily-mounted listener would miss — the Strategy
 * tab then silently failed to appear.
 *
 * This module is loaded at boot, records the request, and replays it to
 * whoever mounts later. It is deliberately tiny so it can live in the eager
 * chunk without dragging the overlay back in.
 *
 * @module ui/results/tab-request
 */

/** The Results subpages. Mirrors `ResultsModal`'s tab ids. */
export type ResultsTabId = 'events' | 'strategy' | 'plots' | 'metrics' | 'raw' | 'saved';

const TAB_IDS: readonly ResultsTabId[] = ['events', 'strategy', 'plots', 'metrics', 'raw', 'saved'];

/** Narrow an unknown value to a {@link ResultsTabId}. */
export function isResultsTab(v: unknown): v is ResultsTabId {
  return typeof v === 'string' && (TAB_IDS as readonly string[]).includes(v);
}

/** The tab most recently requested by anything, if it has not been consumed. */
let pending: ResultsTabId | null = null;

const listeners = new Set<(tab: ResultsTabId) => void>();

/**
 * Listen for `axis-results-tab` for the whole app lifetime.
 *
 * Call once at boot. Returns a disposer (the app never needs it, but tests do).
 */
export function installResultsTabRelay(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onTab = (ev: Event) => {
    const tab = (ev as CustomEvent<{ tab?: unknown }>).detail?.tab;
    if (!isResultsTab(tab)) return;
    pending = tab;
    for (const fn of listeners) fn(tab);
  };
  window.addEventListener('axis-results-tab', onTab);
  return () => window.removeEventListener('axis-results-tab', onTab);
}

/**
 * Subscribe to tab requests. The overlay uses this instead of its own window
 * listener so requests survive being unmounted.
 */
export function onResultsTabRequest(fn: (tab: ResultsTabId) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Consume the pending tab request, if any. Cleared so it cannot replay later. */
export function takePendingResultsTab(): ResultsTabId | null {
  const tab = pending;
  pending = null;
  return tab;
}

/** Test seam: forget any pending request and drop all subscribers. */
export function resetResultsTabRelay(): void {
  pending = null;
  listeners.clear();
}
