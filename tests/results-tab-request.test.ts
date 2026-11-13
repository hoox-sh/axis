// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Results overlay is code-split, so its listeners do not exist at the
 * moment a run finishes. `apply-strategy` opens the panel and dispatches
 * `axis-results-tab` synchronously; the relay has to record that request and
 * replay it when the overlay finally mounts, or the Strategy tab silently
 * fails to appear.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import {
  installResultsTabRelay,
  isResultsTab,
  onResultsTabRequest,
  resetResultsTabRelay,
  takePendingResultsTab,
  type ResultsTabId,
} from '../src/ui/results/tab-request';

const cleanups: (() => void)[] = [];

/** Minimal `window` stand-in: the relay only needs an event target. */
function fakeWindow(): EventTarget {
  const bus = new EventTarget();
  (globalThis as { window?: unknown }).window = bus;
  cleanups.push(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  return bus;
}

const dispatchTab = (bus: EventTarget, tab: unknown) =>
  bus.dispatchEvent(new CustomEvent('axis-results-tab', { detail: { tab } }));

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  resetResultsTabRelay();
});

describe('isResultsTab', () => {
  it('accepts the six subpage ids', () => {
    for (const id of ['events', 'strategy', 'plots', 'metrics', 'raw', 'saved'] as const) {
      expect(isResultsTab(id)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isResultsTab('bogus')).toBe(false);
    expect(isResultsTab(undefined)).toBe(false);
    expect(isResultsTab(7)).toBe(false);
  });
});

describe('results tab relay', () => {
  it('records a request that arrives before the overlay mounts', () => {
    const bus = fakeWindow();
    installResultsTabRelay();

    dispatchTab(bus, 'strategy');

    // Nothing is mounted yet — the request has to survive.
    expect(takePendingResultsTab()).toBe('strategy');
  });

  it('clears the request once consumed, so it cannot replay later', () => {
    const bus = fakeWindow();
    installResultsTabRelay();
    dispatchTab(bus, 'plots');

    expect(takePendingResultsTab()).toBe('plots');
    expect(takePendingResultsTab()).toBeNull();
  });

  it('notifies a mounted overlay', () => {
    const bus = fakeWindow();
    installResultsTabRelay();
    const seen: ResultsTabId[] = [];
    const off = onResultsTabRequest((t) => seen.push(t));
    cleanups.push(off);

    dispatchTab(bus, 'saved');

    expect(seen).toEqual(['saved']);
  });

  it('ignores unknown tab ids', () => {
    const bus = fakeWindow();
    installResultsTabRelay();
    const seen: ResultsTabId[] = [];
    cleanups.push(onResultsTabRequest((t) => seen.push(t)));

    dispatchTab(bus, 'nope');
    dispatchTab(bus, undefined);

    expect(seen).toEqual([]);
    expect(takePendingResultsTab()).toBeNull();
  });

  it('stops recording after the relay is disposed', () => {
    const bus = fakeWindow();
    const off = installResultsTabRelay();
    off();

    dispatchTab(bus, 'metrics');

    expect(takePendingResultsTab()).toBeNull();
  });
});
