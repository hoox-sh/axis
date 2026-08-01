// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bar replay chrome — play / pause / step / speed strip when a session is active.
 * Owns the wall-clock play timer; pure transitions live in `chart/bar-replay`.
 *
 * @module ui/BarReplayControls
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { store } from '../store';
import { setDataToChart } from '../chart/manager-access';
import {
  REPLAY_SPEEDS,
  REPLAY_TICK_MS,
  getReplayState,
  getVisibleBars,
  isReplayActive,
  pause,
  play,
  setCursor,
  setReplayBarsLength,
  setSpeed,
  startReplaySession,
  step,
  stopReplaySession,
  subscribeReplay,
  tick,
  updateReplaySession,
  type ReplayState,
} from '../chart/bar-replay';
import { stopLive } from '../streams/multiplex';
import { Icons } from './icons';

function applyVisibleToChart(fit = false) {
  const full = store.bars;
  if (!full.length) return;
  const vis = getVisibleBars(full);
  setDataToChart(vis, { fit, clearMarkers: false });
}

function restoreFullChart() {
  if (store.bars.length) {
    setDataToChart(store.bars, { fit: false, clearMarkers: false });
  }
}

/**
 * Start bar replay over currently loaded history.
 * Stops live streaming first so ticks cannot fight the scrubbed series.
 */
export function startBarReplay(): boolean {
  const n = store.bars.length;
  if (n <= 0) return false;
  if (store.live.active) stopLive();
  startReplaySession(n);
  applyVisibleToChart(true);
  return true;
}

/** Exit replay and restore the full OHLCV series on the chart. */
export function exitBarReplay(): void {
  if (!isReplayActive()) return;
  stopReplaySession();
  restoreFullChart();
}

/**
 * Floating strip when replay is active (bottom-center of chart workspace).
 * Hidden when inactive — Topbar / callers use {@link startBarReplay}.
 */
export const BarReplayControls: Component = () => {
  const [state, setState] = createSignal<ReplayState>(getReplayState());
  let timer: ReturnType<typeof setInterval> | undefined;

  const clearTimer = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const armTimer = (playing: boolean) => {
    clearTimer();
    if (!playing) return;
    timer = setInterval(() => {
      updateReplaySession((st, len) => tick(st, len));
    }, REPLAY_TICK_MS);
  };

  onMount(() => {
    const unsub = subscribeReplay((st) => {
      setState(st);
      if (st.active) applyVisibleToChart(false);
      armTimer(st.active && st.playing);
    });
    onCleanup(() => {
      unsub();
      clearTimer();
    });
  });

  // Live streaming wins — exit replay if user (or auto) starts live
  createEffect(() => {
    if (store.live.active && isReplayActive()) {
      exitBarReplay();
      setState(getReplayState());
    }
  });

  // History reload while replaying: re-clamp length + re-paint prefix
  createEffect(() => {
    const gen = store.chartDataGen;
    const n = store.bars.length;
    void gen;
    if (!isReplayActive()) return;
    if (n <= 0) {
      exitBarReplay();
      setState(getReplayState());
      return;
    }
    setReplayBarsLength(n);
    setState(getReplayState());
    applyVisibleToChart(false);
  });

  const onStep = (delta: number) => {
    updateReplaySession((st, len) => {
      const paused = st.playing ? pause(st) : st;
      return step(paused, delta, len);
    });
  };

  const onTogglePlay = () => {
    updateReplaySession((st, len) => (st.playing ? pause(st) : play(st, len)));
  };

  const onSpeed = (speed: number) => {
    updateReplaySession((st) => setSpeed(st, speed));
  };

  const onScrub = (index: number) => {
    updateReplaySession((st, len) => {
      const paused = st.playing ? pause(st) : st;
      return setCursor(paused, index, len);
    });
  };

  const onExit = () => {
    exitBarReplay();
    setState(getReplayState());
  };

  const st = () => state();
  const barsLen = () => store.bars.length;
  const label = () => {
    const n = barsLen();
    if (n <= 0) return '0 / 0';
    return `${st().cursorIndex + 1} / ${n}`;
  };

  return (
    <Show when={st().active}>
      <div
        class="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2 py-1 bg-bg-panel/95 border-2 border-border shadow-[0_4px_20px_rgba(0,0,0,0.4)] pointer-events-auto"
        data-testid="axis-bar-replay-controls"
        role="group"
        aria-label="Bar replay controls"
      >
        <span class="text-[10px] font-mono uppercase tracking-wider text-accent px-1 select-none">
          Replay
        </span>

        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1.5"
          title="Step back one bar"
          aria-label="Step back"
          data-testid="axis-bar-replay-step-back"
          disabled={st().cursorIndex <= 0}
          onClick={() => onStep(-1)}
        >
          ‹
        </button>

        <button
          type="button"
          class={`sc-btn px-1.5 ${st().playing ? 'border-accent text-accent' : ''}`}
          title={st().playing ? 'Pause' : 'Play'}
          aria-label={st().playing ? 'Pause' : 'Play'}
          data-testid="axis-bar-replay-play"
          onClick={onTogglePlay}
        >
          {st().playing ? (
            <span class="font-mono text-[11px] leading-none px-0.5">❚❚</span>
          ) : (
            <Icons.play />
          )}
        </button>

        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1.5"
          title="Step forward one bar"
          aria-label="Step forward"
          data-testid="axis-bar-replay-step-fwd"
          disabled={barsLen() > 0 && st().cursorIndex >= barsLen() - 1}
          onClick={() => onStep(1)}
        >
          ›
        </button>

        <span class="sc-sep" aria-hidden="true" />

        <label class="sc-label text-[10px]" for="axis-bar-replay-speed">
          Speed
        </label>
        <select
          id="axis-bar-replay-speed"
          class="sc-input min-w-[3.5em] text-[11px]"
          data-testid="axis-bar-replay-speed"
          value={String(st().speed)}
          title="Bars advanced per tick"
          onChange={(e) => onSpeed(Number(e.currentTarget.value))}
        >
          <For each={[...REPLAY_SPEEDS]}>
            {(sp) => <option value={String(sp)}>{sp}×</option>}
          </For>
        </select>

        <input
          type="range"
          class="w-[7em] accent-[var(--color-accent, #6cf)]"
          min={0}
          max={Math.max(0, barsLen() - 1)}
          step={1}
          value={st().cursorIndex}
          title="Scrub bar position"
          data-testid="axis-bar-replay-scrub"
          aria-label="Bar position"
          onInput={(e) => onScrub(Number(e.currentTarget.value))}
        />

        <span
          class="font-mono text-[10px] text-text-dim tabular-nums min-w-[4.5em] text-right"
          data-testid="axis-bar-replay-pos"
        >
          {label()}
        </span>

        <span class="sc-sep" aria-hidden="true" />

        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1.5"
          title="Exit bar replay"
          aria-label="Exit replay"
          data-testid="axis-bar-replay-exit"
          onClick={onExit}
        >
          <Icons.x />
          Exit
        </button>
      </div>
    </Show>
  );
};
