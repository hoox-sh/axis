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
 * Pure alert-row tone — safe to unit-test without DOM or store.
 */

/** How long a firing stays on the "recently fired" edge. */
export const RECENT_FIRE_MS = 15 * 60 * 1000;

export type AlertRowTone = 'disabled' | 'fired' | 'armed';

export function alertRowTone(
  alert: { enabled: boolean; lastFiredAt?: number | null },
  now = Date.now(),
): AlertRowTone {
  if (!alert.enabled) return 'disabled';
  const firedAt = alert.lastFiredAt;
  if (typeof firedAt === 'number' && Number.isFinite(firedAt) && firedAt > 0) {
    const age = now - firedAt;
    if (age >= 0 && age <= RECENT_FIRE_MS) return 'fired';
  }
  return 'armed';
}
