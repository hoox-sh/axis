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
 * Time panel — float-only compact clock: big countdown to the
 * current-interval candle close, local + UTC wall clock below.
 *
 * FloatableShell id `time` (`floatOnly` — no layout docks).
 */

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { FloatableShell } from './panels/FloatableShell';
import {
  barCloseRemainingMs,
  formatClockLocal,
  formatClockUtc,
  formatCountdown,
} from './extras/timebadge';

/** Float-only time panel (candle countdown + clocks). */
export const TimePanel: Component = () => {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => window.clearInterval(id));
  });

  /** Remaining ms to the current bar close; NaN while no bars are loaded. */
  const remaining = () => {
    const bars = store.bars;
    const last = bars.length ? bars[bars.length - 1] : undefined;
    if (!last || !Number.isFinite(last.time)) return NaN;
    return barCloseRemainingMs(last.time * 1000, store.interval, now());
  };

  return (
    <Show when={isPanelOpen('time')}>
      <FloatableShell id="time" testId="axis-time" floatOnly>
        <div class="axis-mini-panel">
          <div class="axis-mini-big" data-testid="axis-time-countdown">
            <span class="tabular-nums">{formatCountdown(remaining())}</span>
            <span class="axis-mini-tag">{store.interval} CLOSE</span>
          </div>
          <div class="axis-mini-sub" data-testid="axis-time-clocks">
            <span class="tabular-nums">{formatClockLocal(new Date(now()))}</span>
            <span class="axis-mini-dim">UTC {formatClockUtc(new Date(now()))}</span>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
