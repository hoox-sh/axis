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
 * Atomics helpers with the one hard rule of the HP plane (HP PR 4, §8):
 * **`Atomics.wait` is worker-only.**
 *
 * The browser throws `TypeError: Blocking wait is not allowed on the main
 * thread` — and even where a runtime allows it (Bun, Node) it would freeze
 * paint. `waitInWorker` refuses up front so a mistake surfaces in a unit test
 * instead of as a stuck tab.
 *
 * Main-thread code uses `Atomics.load` inside a `requestAnimationFrame` loop
 * (`hp/sync/raf-poll`), or an optional `Atomics.waitAsync` fast path — never
 * a blocking wait.
 *
 * @module hp/sync/atomics
 */

import type { HpControlBlock } from '../memory/control-block';
import { HP_GEN_INDEX } from '../memory/control-block';
import { isMainThread } from './is-main-thread';

export type WaitResult = 'ok' | 'not-equal' | 'timed-out';

/**
 * Blocking wait, **workers only**. Throws when called on the Window thread.
 *
 * @param i32 shared Int32 view
 * @param index word index to watch
 * @param value current expected value — returns `'not-equal'` if it moved
 * @param timeoutMs `0` = try once without blocking
 */
export function waitInWorker(
  i32: Int32Array,
  index: number,
  value: number,
  timeoutMs = 0,
): WaitResult {
  if (isMainThread()) {
    throw new Error('Atomics.wait is illegal on the Window thread — use rAF polling');
  }
  return Atomics.wait(i32, index, value, timeoutMs) as WaitResult;
}

/** Wake workers parked on `index` (safe on any thread — it never blocks). */
export function notify(i32: Int32Array, index: number, count = 1): number {
  return Atomics.notify(i32, index, count);
}

/** Generation load (even = complete, odd = write in flight). */
export function loadGen(control: HpControlBlock): number {
  return control.generation;
}

/**
 * Raw generation store. The normal transitions are `control.beginWrite`
 * (odd, open) and `control.commitWrite` (even, publish); this exists for
 * tests that need to force a specific generation.
 */
export function storeGen(control: HpControlBlock, generation: number): void {
  Atomics.store(control.i32, HP_GEN_INDEX, generation | 0);
}
