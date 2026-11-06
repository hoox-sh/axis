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
 * Adds a candle-progress bar and the close wall time; the countdown tints
 * amber under a minute and red under ten seconds.
 *
 * FloatableShell id `time` (`floatOnly` — no layout docks).
 */

import { type Component, Show, createMemo } from 'solid-js';
import { useNow } from './clock';
import { store, isPanelOpen } from '../store';
import { barPlane } from '../stores/bars';
import { FloatableShell } from './panels/FloatableShell';
import {
  barCloseAtMs,
  barCloseRemainingMs,
  barProgress,
  formatClockLocal,
  formatClockUtc,
  formatCountdown,
} from './extras/timebadge';

function clockTime(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return formatClockUtc(d);
}

/** Float-only time panel (candle countdown + clocks). */
export const TimePanel: Component = () : JSX.Element => {
  const now = useNow();

  const barOpenMs = createMemo(() => {
    const last = barPlane.tip ?? barPlane.bars[barPlane.length - 1];
    if (!last || !Number.isFinite(last.time)) return NaN;
    return last.time * 1000;
  });

  /** Remaining ms to the current bar close; NaN while no bars are loaded. */
  const remaining = () => barCloseRemainingMs(barOpenMs(), store.interval, now());
  const progress = () => barProgress(barOpenMs(), store.interval, now());
  const pct = () => {
    const p = progress();
    return Number.isFinite(p) ? Math.round(p * 100) : 0;
  };
  const closeAt = () => barCloseAtMs(barOpenMs(), store.interval);
  const countdownTone = () => {
    const ms = remaining();
    if (!Number.isFinite(ms)) return '';
    if (ms <= 10_000) return 'is-imminent';
    if (ms <= 60_000) return 'is-soon';
    return '';
  };
  const dateLabel = () =>
    new Date(now()).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  return (
    <Show when={isPanelOpen('time')}>
      <FloatableShell id="time" testId="axis-time" floatOnly>
        <div class="ax-time" title={dateLabel()}>
          <div class="ax-time-row">
            <span class="ax-time-label">{store.interval || '—'} close</span>
            <span
              class={`ax-time-countdown ${countdownTone()}`.trim()}
              data-testid="axis-time-countdown"
            >
              {formatCountdown(remaining())}
            </span>
            <span class="ax-time-pct">{pct()}%</span>
          </div>
          <div
            class="ax-time-progress"
            classList={{
              'is-soon': countdownTone() === 'is-soon',
              'is-imminent': countdownTone() === 'is-imminent',
            }}
            role="progressbar"
            aria-label="Candle progress"
            aria-valuenow={pct()}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span class="ax-time-progress-fill" style={{ width: `${pct()}%` }} />
          </div>
          <div class="ax-time-clocks" data-testid="axis-time-clocks">
            <span class="tabular-nums">{formatClockLocal(new Date(now()))}</span>
            <span class="ax-time-dim">UTC {formatClockUtc(new Date(now()))}</span>
            <span class="ax-time-close">→ {clockTime(closeAt())} UTC</span>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
