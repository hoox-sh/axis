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
 * AXB1-Light WS engine feature flag.
 *
 * Stream engine enable/disable flag. When disabled, the calculator profile
 * is always used as fallback.
 *
 * @module engine/feature-flag
 */

/** Key for the stream engine feature flag in store/config. */
export const STREAM_ENGINE_FLAG_KEY = 'axis.engine.stream.disabled';

/** Whether the stream engine is disabled. */
export function isStreamEngineDisabled(): boolean {
  try {
    const val =
      typeof store !== 'undefined' && store.engine
        ? String(store.engine.flags?.streamDisabled ?? '').trim()
        : '';
    return val === '1' || val === 'true';
  } catch {
    return false; // safe default: engine not disabled = calculator fallback
  }
}

/** Whether the stream engine is enabled. */
export function isStreamEngineEnabled(): boolean {
  return !isStreamEngineDisabled();
}
