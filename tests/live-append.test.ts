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

beforeEach(() => {
  appended = [];
  setDataCalls = [];
  setStore('bars', []);
  setStore('rollingWindowBars', 10_000);
  manager = {
    appendBar: (b: Bar) => appended.push(b),
    getPane: () => undefined,
    getAllPanes: () => [],
  };
  setManager(manager as never);
});

afterEach(() => {
  setManager(undefined);
});

describe('appendLiveBar', () => {
  it('paints a new bar with the incremental path', () => {
    const verdict = appendLiveBar(bar(60));
    expect(verdict).toBe('appended');
    expect(appended).toHaveLength(1);
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
