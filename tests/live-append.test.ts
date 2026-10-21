/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live append — the store verdict and the chart paint.
 *
 * `store.appendBar` decides what changed (nothing / tip / new bar / window
 * slide); the paint layer has to mirror that decision. The verdict is
 * returned so the caller can skip the side effects of a **rejected** bar —
 * a stale tick must not move the price card, fire an alert, or overwrite a
 * dataset bar.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { setStore, store } from '../src/store';
import { setManager } from '../src/chart/manager-access';
import { appendLiveBar } from '../src/chart/live-append';
import type { Bar } from '../src/store/types';

function bar(t: number, close = 100, extra: Partial<Bar> = {}): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1, ...extra };
}

let appended: Bar[] = [];
let setDataCalls: unknown[][] = [];
let manager: unknown;

const DEFAULT_WINDOW = 10_000;

beforeEach(() => {
  appended = [];
  setDataCalls = [];
  setStore('bars', []);
  setStore('rollingWindowBars', DEFAULT_WINDOW);
  manager = {
    appendBar: (b: Bar) => appended.push(b),
    getPane: () => undefined,
    getAllPanes: () => [],
  };
  setManager(manager as never);
});

// The store is shared across the test files in one process: a leaked rolling
// window would slice the bars of every later test.
afterEach(() => {
  setManager(undefined);
  setStore('bars', []);
  setStore('rollingWindowBars', DEFAULT_WINDOW);
});

describe('appendLiveBar', () => {
  it('paints a new bar through the full-window path (not incremental)', () => {
    // A genuinely new bar adds a new time slot. `series.update` can only
    // overwrite the last bar in place, so new bars are painted like a window
    // slide (setData) instead of the incremental manager.appendBar path.
    const verdict = appendLiveBar(bar(60));
    expect(verdict).toBe('appended');
    expect(appended).toHaveLength(0); // manager.appendBar is not used for new bars
    expect(store.bars).toHaveLength(1);
  });

  it('keeps the incremental path for a forming-tick update', () => {
    appendLiveBar(bar(60));
    appended = [];
    // Same time as the tip → forming candle updated in place.
    const verdict = appendLiveBar(bar(60, 101));
    expect(verdict).toBe('updated');
    expect(appended).toHaveLength(1); // manager.appendBar / series.update
    expect(store.bars).toHaveLength(1);
  });

  it('reports "ignored" for a late tick and paints nothing', () => {
    appendLiveBar(bar(120));
    appended = [];
    const verdict = appendLiveBar(bar(60));
    expect(verdict).toBe('ignored');
    expect(appended).toHaveLength(0);
    expect(store.bars).toHaveLength(1);
    expect(store.bars[0]!.time).toBe(120);
  });

  it('does not reopen a closed candle', () => {
    appendLiveBar(bar(60, 100, { closed: true }));
    appended = [];
    const verdict = appendLiveBar(bar(60, 101, { closed: false }));
    expect(verdict).toBe('ignored');
    expect(appended).toHaveLength(0);
    expect(store.bars[0]!.close).toBe(100);
  });

  it('reports a window slide so the caller can do a full repaint', () => {
    setStore('rollingWindowBars', 3);
    for (let i = 0; i < 3; i++) appendLiveBar(bar(60 + i * 60));
    appended = [];
    const verdict = appendLiveBar(bar(60 + 3 * 60));
    expect(verdict).toBe('slid');
    // The incremental path is not used for a slide — the head moved.
    expect(appended).toHaveLength(0);
    expect(store.bars).toHaveLength(3);
    expect(store.bars[0]!.time).toBe(120);
  });
});
