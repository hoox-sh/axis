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
 * Run window axis — `bar_index` must resolve against the window that produced
 * it, never against the live (sliding) chart array.
 */
import { describe, expect, it } from 'bun:test';
import {
  axisStamp,
  barIndexForTime,
  looksLikeBarIndex,
  timeForBarIndex,
  windowAxisFromBars,
  windowAxisFromMeta,
} from '../src/results/window-axis';
import { normalizeStrategyEvents, signalBarIndex } from '../src/results/events';
import { resolveDebugPinTarget, pinsFromLastRun } from '../src/results/debug-pins';
import { normalizeScriptDrawings } from '../src/chart/pyne-drawings';
import type { Bar } from '../src/store/types';

const START = 1_700_000_000;

function bars(n: number, start = START, step = 60): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * step,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
  }));
}

describe('windowAxisFromBars', () => {
  it('anchors the first bar and derives the median span', () => {
    const axis = windowAxisFromBars(bars(10));
    expect(axis).toEqual({ t0: START, span: 60, count: 10, uniform: true });
  });

  it('flags a gappy window as non-uniform so indices are never guessed', () => {
    const list = bars(10);
    // Drop one bar (a session gap): index → time is no longer reconstructable.
    list.splice(5, 1);
    const axis = windowAxisFromBars(list);
    expect(axis?.uniform).toBe(false);
    expect(axis?.span).toBe(60);
    expect(axis?.count).toBe(9);
    // Index 0 is still exact; any other index is refused, not approximated.
    expect(timeForBarIndex(axis, 0)).toBe(START);
    expect(timeForBarIndex(axis, 4)).toBeNull();
  });

  it('ignores a single gap when deriving the span', () => {
    const list = bars(10);
    list.splice(5, 1);
    const axis = windowAxisFromBars(list);
    expect(axis?.span).toBe(60);
    expect(axis?.count).toBe(9);
  });

  it('returns null for an unusable window', () => {
    expect(windowAxisFromBars([])).toBeNull();
    expect(windowAxisFromBars(null)).toBeNull();
    expect(windowAxisFromBars([{ time: 0 }])).toBeNull();
    // Milliseconds clock is not a bar-time anchor.
    expect(windowAxisFromBars([{ time: START * 1000 }])).toBeNull();
  });
});

describe('axis stamp roundtrip', () => {
  it('stamps and reads back', () => {
    const axis = windowAxisFromBars(bars(5));
    const meta = { transport: 'ws', ...axisStamp(axis) };
    expect(windowAxisFromMeta(meta)).toEqual(axis);
  });

  it('rejects a partial or garbage stamp', () => {
    expect(windowAxisFromMeta({})).toBeNull();
    expect(windowAxisFromMeta({ windowT0: 1 })).toBeNull();
    expect(windowAxisFromMeta(null)).toBeNull();
  });
});

describe('index ↔ time', () => {
  const axis = windowAxisFromBars(bars(10));

  it('maps a window index to an absolute bar time', () => {
    expect(timeForBarIndex(axis, 0)).toBe(START);
    expect(timeForBarIndex(axis, 3)).toBe(START + 180);
    expect(timeForBarIndex(axis, 10)).toBeNull();
    expect(timeForBarIndex(axis, -1)).toBeNull();
  });

  it('maps a time back to a window index', () => {
    expect(barIndexForTime(axis, START + 180)).toBe(3);
    expect(barIndexForTime(axis, START - 60)).toBeNull();
    expect(barIndexForTime(axis, START + 600)).toBeNull();
  });

  it('only treats small in-window integers as indices', () => {
    expect(looksLikeBarIndex(7, axis)).toBe(true);
    expect(looksLikeBarIndex(10, axis)).toBe(false);
    expect(looksLikeBarIndex(START, axis)).toBe(false);
    expect(looksLikeBarIndex(1.5, axis)).toBe(false);
    expect(looksLikeBarIndex(7, null)).toBe(false);
  });
});

describe('strategy events after a window slide', () => {
  // Engine evaluated bars 0..9; the chart has since dropped 2 head bars.
  const engineWindow = bars(10);
  const axis = windowAxisFromBars(engineWindow);
  const liveBars = engineWindow.slice(2);

  it('resolves a bare bar_index through the run axis, not the live array', () => {
    const ev = { kind: 'entry', id: 'L', direction: 'long', qty: 1, bar_index: 4 };
    // Legacy (no axis) would land on live index 4 = engine bar 6.
    expect(signalBarIndex(ev as never, liveBars)).toBe(4);
    // With the run axis, index 4 is engine bar 4 → live index 2.
    expect(signalBarIndex(ev as never, liveBars, axis)).toBe(2);
  });

  it('drops an index whose bar already left the window', () => {
    const ev = { kind: 'entry', id: 'L', direction: 'long', qty: 1, bar_index: 0 };
    expect(signalBarIndex(ev as never, liveBars, axis)).toBeNull();
  });

  it('fills at the bar the run axis points at', () => {
    const normalized = normalizeStrategyEvents(
      [{ kind: 'entry', id: 'L', direction: 'long', qty: 1, bar_index: 4 }],
      { bars: liveBars, includeOrders: false, fillMode: 'close', axis },
    );
    expect(normalized[0]?.time).toBe(engineWindow[4]!.time);
    expect(normalized[0]?.price).toBe(engineWindow[4]!.close);
    // `bar_index` is the fill bar's position in the current array (display);
    // `time` is the durable anchor.
    expect(normalized[0]?.bar_index).toBe(2);
  });
});

describe('debug pins after a window slide', () => {
  const engineWindow = bars(10);
  const axis = windowAxisFromBars(engineWindow);
  const liveBars = engineWindow.slice(2);

  it('pins a bare bar_index at the bar the run evaluated', () => {
    const { time, barIndex } = resolveDebugPinTarget({ time: null, barIndex: 4 }, liveBars, axis);
    expect(time).toBe(engineWindow[4]!.time);
    expect(barIndex).toBe(2); // position in the live series
  });

  it('keeps the true time but clamps the index to the nearest live bar', () => {
    const { time, barIndex } = resolveDebugPinTarget({ time: null, barIndex: 0 }, liveBars, axis);
    // The absolute time is still correct (the pin knows when it happened)…
    expect(time).toBe(engineWindow[0]!.time);
    // …and the index is the nearest bar on screen, never index 0 reinterpreted
    // as a position in the new window (which would be a different bar).
    expect(barIndex).toBe(0);
    expect(liveBars[barIndex!]!.time).toBe(engineWindow[2]!.time);
  });

  it('derives the axis from the last-run payload', () => {
    const pins = pinsFromLastRun(
      { meta: axisStamp(axis), logs: [{ level: 'info', message: 'hi', bar_index: 4 }] },
      { bars: liveBars },
    );
    expect(pins[0]?.time).toBe(engineWindow[4]!.time);
  });
});

describe('Pine drawings with xloc.bar_index', () => {
  const engineWindow = bars(10);
  const axis = windowAxisFromBars(engineWindow);
  const lastBar = engineWindow[engineWindow.length - 1]!.time;

  it('converts window-relative anchors to absolute times', () => {
    const out = normalizeScriptDrawings(
      [{ type: 'line', x1: 2, y1: 101, x2: 7, y2: 104, color: '#fff' }],
      lastBar,
      axis,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.t1).toBe(engineWindow[2]!.time);
    expect(out[0]?.t2).toBe(engineWindow[7]!.time);
  });

  it('leaves real timestamps alone', () => {
    const out = normalizeScriptDrawings(
      [{ type: 'line', t1: engineWindow[2]!.time, p1: 101, t2: engineWindow[7]!.time, p2: 104 }],
      lastBar,
      axis,
    );
    expect(out[0]?.t1).toBe(engineWindow[2]!.time);
    expect(out[0]?.t2).toBe(engineWindow[7]!.time);
  });

  it('keeps legacy index anchors when no axis is stamped', () => {
    const out = normalizeScriptDrawings(
      [{ type: 'line', x1: 2, y1: 101, x2: 7, y2: 104 }],
      lastBar,
      null,
    );
    expect(out[0]?.t1).toBe(2);
    expect(out[0]?.t2).toBe(7);
  });
});
