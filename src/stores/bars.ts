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
 * Narrow **bar plane** — canonical OHLCV state separated from the giant app
 * store so chart/data paths can subscribe to exactly the slice they need.
 *
 * `store.bars` remains the durable source of truth for engine evaluation and
 * legacy components during migration. All *new* UI/chart reads should prefer
 * this plane.
 *
 * ## Granularity
 * - `bars`   – full visible window. Subscribers rerun on full replace / slide.
 * - `tip`    – the forming/newest bar. Updates independently on every live tick.
 * - `length` – number of bars. Updates only when the window grows or slides.
 * - `gen`    – full-reload generation. Bumped by `loadBars` and window slides.
 *
 * @module stores/bars
 */

import { batch, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Bar } from '../store/types';

export interface BarPlaneState {
  bars: Bar[];
  tip: Bar | null;
  length: number;
  gen: number;
  symbol: string;
  interval: string;
  exchange: string;
}

const DEFAULTS: BarPlaneState = {
  bars: [],
  tip: null,
  length: 0,
  gen: 0,
  symbol: '',
  interval: '',
  exchange: '',
};

function buildPlane() {
  const [state, setState] = createStore<BarPlaneState>(DEFAULTS);

  function setFull(
    bars: readonly Bar[],
    meta?: { symbol?: string; interval?: string; exchange?: string; bumpGen?: boolean },
  ) {
    const trimmed = trimWindow(bars);
    const tip = lastBar(trimmed);
    batch(() => {
      setState('bars', trimmed);
      // Clone the tip so it is never the exact same object as the tail element
      // in the bars array. Solid stores can proxy-link shared object references
      // in unexpected ways, and this plane must stay isolated from the app store.
      setState('tip', tip ? { ...tip } : null);
      setState('length', trimmed.length);
      setState('gen', (g) => (meta?.bumpGen !== false ? g + 1 : g));
      if (meta?.symbol != null) setState('symbol', meta.symbol);
      if (meta?.interval != null) setState('interval', meta.interval);
      if (meta?.exchange != null) setState('exchange', meta.exchange);
    });
  }

  function updateTip(bar: Bar) {
    batch(() => {
      setState('tip', bar);
      // The visible window is unchanged; length and gen stay identical.
      // Some consumers key off bars[n-1], so mirror into the store only.
    });
  }

  function append(bar: Bar, index: number) {
    batch(() => {
      setState('bars', index, bar);
      if (index > 0) {
        setState('bars', index - 1, 'closed', true);
      }
      setState('tip', { ...bar });
      setState('length', index + 1);
      // gen stays the same — only a full load or slide bumps it.
    });
  }

  return { state, setState, setFull, updateTip, append };
}

const plane = createRoot(buildPlane);

/** Public read-only access to the bar plane. */
export const barPlane = plane.state;

/** Replace the visible window and bump generation (load / slide). */
export function setBarPlaneFull(
  bars: readonly Bar[],
  meta?: { symbol?: string; interval?: string; exchange?: string; bumpGen?: boolean },
): void {
  plane.setFull(bars, meta);
}

/**
 * Append a single bar to the visible window without copying the entire array.
 * Mirrors the in-place index append path of `store.bars`. The previous tip is
 * marked `closed: true` so the plane stays consistent with the canonical store.
 */
export function setBarPlaneAppend(bar: Bar, index: number): void {
  plane.append(bar, index);
}

/** Notify the plane that only the forming tip changed (live update). */
export function setBarPlaneTip(bar: Bar): void {
  plane.updateTip(bar);
}

function trimWindow(bars: readonly Bar[]): readonly Bar[] {
  // Defensive copy so callers cannot mutate the canonical window through the
  // returned reference. The store already hands out frozen-ish data; keep it.
  if (Array.isArray(bars)) return bars.slice();
  return [];
}

function lastBar(bars: readonly Bar[]): Bar | null {
  return bars.length > 0 ? bars[bars.length - 1] : null;
}
