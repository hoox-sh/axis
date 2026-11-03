// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MVP user drawings — trendline commit normalize + append into *.axis.json.
 * Script/engine drawings stay on chart.full / chart.drawing.apply (paint deferred).
 */

import type { AxisChartDocV1 } from './chart-document';

/** Only tool shipped in Task 18 MVP. */
export const DRAWING_TOOL_TRENDLINE = 'trendline' as const;

export type DrawingToolId = typeof DRAWING_TOOL_TRENDLINE | string;

export interface ChartDrawingPoint {
  time: number;
  price: number;
}

/** Persisted user drawing shape (webview `drawing.commit` payload). */
export interface CommittedTrendlineDrawing {
  id: string;
  tool: typeof DRAWING_TOOL_TRENDLINE;
  points: [ChartDrawingPoint, ChartDrawingPoint];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Normalize one `{ time, price }` point (also accepts t/p aliases). */
export function normalizeDrawingPoint(raw: unknown): ChartDrawingPoint | null {
  try {
    if (!isPlainObject(raw)) return null;
    const time = finiteNumber(raw.time) ?? finiteNumber(raw.t);
    const price = finiteNumber(raw.price) ?? finiteNumber(raw.p);
    if (time === null || price === null) return null;
    return { time, price };
  } catch {
    return null;
  }
}

/**
 * Normalize a `drawing.commit` payload into a trendline entity.
 * Rejects non-objects, wrong tool, missing id, or fewer than 2 valid points.
 */
export function normalizeCommittedDrawing(raw: unknown): CommittedTrendlineDrawing | null {
  try {
    if (!isPlainObject(raw)) return null;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) return null;
    const tool = typeof raw.tool === 'string' ? raw.tool.trim() : '';
    if (tool !== DRAWING_TOOL_TRENDLINE) return null;
    if (!Array.isArray(raw.points) || raw.points.length < 2) return null;
    const a = normalizeDrawingPoint(raw.points[0]);
    const b = normalizeDrawingPoint(raw.points[1]);
    if (!a || !b) return null;
    return { id, tool: DRAWING_TOOL_TRENDLINE, points: [a, b] };
  } catch {
    return null;
  }
}

/**
 * True when a chart.full/init `drawings` batch is user-tool shaped
 * (empty array or every entry has a string `tool`). Script batches lack `tool`.
 */
export function isUserDrawingBatch(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  if (raw.length === 0) return true;
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.tool !== 'string') return false;
  }
  return true;
}

/** Keep only valid MVP trendlines from a drawings array. */
export function normalizeUserDrawings(raw: unknown): CommittedTrendlineDrawing[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: CommittedTrendlineDrawing[] = [];
    for (const entry of raw) {
      const d = normalizeCommittedDrawing(entry);
      if (d) out.push(d);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Append a committed drawing (replace same id). Returns a new doc object.
 * Does not mark dirty — callers use AxisChartDocument.update.
 */
export function appendDrawingToDoc(
  doc: AxisChartDocV1,
  drawing: CommittedTrendlineDrawing,
): AxisChartDocV1 {
  const prev = Array.isArray(doc.drawings) ? doc.drawings : [];
  const next: unknown[] = [];
  for (const entry of prev) {
    if (isPlainObject(entry) && entry.id === drawing.id) continue;
    next.push(entry);
  }
  next.push({
    id: drawing.id,
    tool: drawing.tool,
    points: [
      { time: drawing.points[0].time, price: drawing.points[0].price },
      { time: drawing.points[1].time, price: drawing.points[1].price },
    ],
  });
  return { ...doc, drawings: next };
}
