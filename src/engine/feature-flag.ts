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
 * AXB1-HP engine feature flag.
 *
 * HP engine enable/disable and SAB mode flags. When disabled, the calculator
 * profile is always used as fallback.
 *
 * @module engine/feature-flag
 */

/** Key for the HP engine feature flag in store/config. */
export const HP_ENGINE_FLAG_KEY = 'axis.engine.hp.disabled';

/** Key for the SAB mode flag. */
export const SAB_MODE_FLAG_KEY = 'axis.engine.hp.sab';

/** Whether the HP engine is disabled. */
export function isHpEngineDisabled(): boolean {
  try {
    const val =
      typeof store !== 'undefined' && store.engine
        ? String(store.engine.flags?.hpDisabled ?? '').trim()
        : '';
    return val === '1' || val === 'true';
  } catch {
    return false;
  }
}

/** Whether the HP engine is enabled. */
export function isHpEngineEnabled(): boolean {
  return !isHpEngineDisabled();
}

/** SAB mode: 'on', 'off', or 'auto'. */
export function sabMode(): 'on' | 'off' | 'auto' {
  try {
    const val =
      typeof store !== 'undefined' && store.engine
        ? String(store.engine.flags?.sabMode ?? 'auto').trim()
        : 'auto';
    if (val === 'on' || val === 'off') return val as 'on' | 'off';
    return 'auto';
  } catch {
    return 'auto';
  }
}
