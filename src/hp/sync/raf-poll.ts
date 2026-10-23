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
 * Main-thread generation poll (HP PR 4, §8.2).
 *
 * The Window thread never blocks on the shared state: it loads the
 * generation once per animation frame and repaints only when the generation
 * is **even** and newer than the last one it painted. An odd generation means
 * a write is in flight — that frame is skipped and the previous picture stays
 * up (no tearing, no flash).
 *
 * The scheduler is injectable so tests drive frames by hand; with no
 * `requestAnimationFrame` (SSR / Bun) it falls back to a 16 ms timer.
 *
 * @module hp/sync/raf-poll
 */

import type { HpControlBlock } from '../memory/control-block';

export type RafFn = (callback: (timeMs: number) => void) => number;
export type CancelRafFn = (handle: number) => void;

export type SubscribeGenerationOpts = {
  raf?: RafFn;
  cancelRaf?: CancelRafFn;
  /** Also repaint when the worker posts an explicit generation poke. */
  poke?: (onPoke: (generation: number) => void) => () => void;
};

function defaultRaf(): { raf: RafFn; cancelRaf: CancelRafFn } {
  const g = globalThis as { requestAnimationFrame?: RafFn; cancelAnimationFrame?: CancelRafFn };
  if (
    typeof g.requestAnimationFrame === 'function' &&
    typeof g.cancelAnimationFrame === 'function'
  ) {
    return { raf: g.requestAnimationFrame.bind(g), cancelRaf: g.cancelAnimationFrame.bind(g) };
  }
  const timers = globalThis as {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  };
  return {
    raf: (cb) => timers.setTimeout(() => cb(Date.now()), 16) as unknown as number,
    cancelRaf: (h) => timers.clearTimeout(h as unknown),
  };
}

/**
 * Poll `control.generation` every frame and call `onEvenGen` for each new
 * completed generation. Returns the disposer (cancel the frame + poke).
 */
export function subscribeGeneration(
  control: HpControlBlock,
  onEvenGen: (generation: number) => void,
  opts: SubscribeGenerationOpts = {},
): () => void {
  const defaults = defaultRaf();
  const raf = opts.raf ?? defaults.raf;
  const cancelRaf = opts.cancelRaf ?? defaults.cancelRaf;
  let stopped = false;
  let handle = 0;
  let last = -1;

  const paint = (generation: number): void => {
    if (stopped) return;
    if (generation & 1) return; // write in flight — keep the previous frame
    if (generation === last) return;
    last = generation;
    onEvenGen(generation);
  };

  const tick = (): void => {
    if (stopped) return;
    paint(control.generation);
    handle = raf(tick);
  };

  handle = raf(tick);
  const stopPoke = opts.poke ? opts.poke(paint) : null;

  return () => {
    if (stopped) return;
    stopped = true;
    cancelRaf(handle);
    stopPoke?.();
  };
}
