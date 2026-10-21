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
 * Window-thread detection (HP PR 4, §8).
 *
 * Read from `globalThis` on every call so a test can stub `Window` / `self`
 * and prove the `Atomics.wait` guard fires. A worker (dedicated, service, or
 * Bun/Node) has no `Window` constructor and returns `false`.
 *
 * @module hp/sync/is-main-thread
 */

type WindowCtor = new () => object;

/** True only on the Window / Solid thread. */
export function isMainThread(): boolean {
  try {
    const g = globalThis as { Window?: unknown; self?: unknown };
    const W = g.Window;
    if (typeof W !== 'function') return false;
    const selfRef = g.self;
    if (selfRef == null) return false;
    return selfRef instanceof (W as WindowCtor);
  } catch {
    return false;
  }
}
