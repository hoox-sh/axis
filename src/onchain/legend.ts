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
 * Pure legend rows for attached on-chain series.
 *
 * Skips hidden rows, blank ids, and non-objects. The value is the last
 * finite point, otherwise `lastTvl`. The list is not capped here.
 *
 * @module onchain/legend
 */

export type OnchainLegendEntry = {
  id: string;
  label: string;
  color: string;
  value: number | null;
};

type LegendSource = {
  id?: string;
  label?: string;
  color?: string;
  visible?: boolean;
  lastTvl?: number | null;
  points?: readonly { value?: number }[] | null;
};

function trimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lastFinitePoint(points: LegendSource['points']): number | null {
  if (!Array.isArray(points)) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    const value = points[i]?.value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function legendValue(row: LegendSource): number | null {
  const fromPoints = lastFinitePoint(row.points);
  if (fromPoints != null) return fromPoints;
  const lastTvl = row.lastTvl;
  if (typeof lastTvl === 'number' && Number.isFinite(lastTvl)) return lastTvl;
  return null;
}

/** Visible series, in source order. Null, empty, and blank ids yield nothing. */
export function onchainLegendEntries(
  series: readonly LegendSource[] | null | undefined,
): OnchainLegendEntry[] {
  if (!Array.isArray(series) || series.length === 0) return [];
  const out: OnchainLegendEntry[] = [];
  for (const row of series) {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) continue;
    if (row.visible === false) continue;
    const id = trimmedText(row.id);
    if (!id) continue;
    const label = trimmedText(row.label) || id;
    out.push({ id, label, color: trimmedText(row.color), value: legendValue(row) });
  }
  return out;
}
