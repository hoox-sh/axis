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
 * Leading-edge rate guard: "has this already fired inside the window?".
 *
 * Extracted from the `lastTrigger` / `Date.now()` copies in
 * `update/update-manager.ts`, `ui/boot-errors.ts`, and `ui/error-share.ts`.
 *
 * **Leading edge only.** The first call is always allowed; a repeat of the
 * same `key` inside `ms` is rejected. There is no trailing-edge timer — this
 * is a *drop* guard, not a debounce. If you need "run after the caller goes
 * quiet", use a real debounce.
 *
 * State is per-`Throttle` instance, so tests stay isolated; call
 * {@link Throttle.reset} between cases rather than reaching for internals.
 *
 * @module utils/throttle
 */

export interface Throttle {
  /**
   * @param key Identity of the thing being guarded. Repeat calls with the same
   *   key inside the window are rejected. Pass a constant to get a plain
   *   "once per window" guard.
   * @param ms Window length. Defaults to the value given to {@link createThrottle}.
   * @returns `true` when allowed (and the window is now stamped for `key`).
   */
  allow(key?: string, ms?: number): boolean;
  /** @internal test helper — clear all recorded windows. */
  reset(): void;
}

/**
 * @param defaultMs Default window length; override per call via `allow(key, ms)`.
 */
export function createThrottle(defaultMs: number): Throttle {
  const last = new Map<string, number>();

  return {
    allow(key = '', ms = defaultMs): boolean {
      const now = Date.now();
      const prev = last.get(key);
      if (prev !== undefined && now - prev < ms) return false;
      last.set(key, now);
      return true;
    },
    reset(): void {
      last.clear();
    },
  };
}