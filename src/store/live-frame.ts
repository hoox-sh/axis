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
 * One Solid commit per animation frame for live chrome.
 *
 * The bar value is written immediately so callers can read it. Subscribers
 * run when the frame flushes, once, inside {@link batch}.
 *
 * @module store/live-frame
 */

import { batch } from 'solid-js';

type Kick = () => void;

let scheduled = false;
let pending: (() => void) | null = null;
let scheduler: (kick: Kick) => void = defaultScheduler;

function browserFrames(): boolean {
  if (typeof requestAnimationFrame !== 'function') return false;
  if (typeof document === 'undefined') return false;
  return !(document as { __axisStub?: boolean }).__axisStub;
}

function defaultScheduler(kick: Kick): void {
  if (browserFrames()) requestAnimationFrame(kick);
  else kick();
}

/** Tests replace the frame clock. `null` restores the runtime scheduler. */
export function _setLiveFrameSchedulerForTests(next: ((kick: Kick) => void) | null): void {
  scheduler = next ?? defaultScheduler;
  scheduled = false;
  pending = null;
}

/**
 * Run `flush` on the next frame. Later calls before that frame replace the
 * body; they do not schedule a second commit.
 */
export function scheduleLiveFrame(flush: () => void): void {
  pending = flush;
  if (scheduled) return;
  scheduled = true;
  scheduler(() => {
    scheduled = false;
    const fn = pending;
    pending = null;
    if (fn) batch(fn);
  });
}
