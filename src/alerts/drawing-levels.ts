// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extract horizontal price levels from a user drawing for `drawing_touch`.
 *
 * The alerts engine matches last price / bar envelope against discrete
 * levels (not a full diagonal hit-test). Anchors become levels; fib
 * retracements expand to the standard ratios.
 *
 * @module alerts/drawing-levels
 */

/** Minimal drawing shape — avoids importing the chart drawing union. */
export type DrawingLike = {
  id?: string;
  kind?: string;
  price?: unknown;
  p1?: { price?: unknown };
  p2?: { price?: unknown };
  p3?: { price?: unknown };
  points?: Array<{ price?: unknown }>;
  text?: string;
  meta?: {
    text?: string;
    fibLevels?: number[];
    [key: string]: unknown;
  };
};

/** Default Fibonacci retracement ratios (matches chart `FIB_LEVELS`). */
export const DRAWING_FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

function pushFinite(out: number[], raw: unknown): void {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    out.push(raw);
    return;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
}

function uniqueSorted(levels: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of levels) {
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Unique finite price levels implied by a drawing.
 * Vertical-only kinds (`vline`) yield no levels.
 */
export function pricesFromDrawing(drawing: DrawingLike | null | undefined): number[] {
  if (!drawing || typeof drawing !== 'object') return [];
  const kind = String(drawing.kind || '');
  if (kind === 'vline') return [];

  const raw: number[] = [];
  pushFinite(raw, drawing.price);
  pushFinite(raw, drawing.p1?.price);
  pushFinite(raw, drawing.p2?.price);
  pushFinite(raw, drawing.p3?.price);
  if (Array.isArray(drawing.points)) {
    for (const p of drawing.points) pushFinite(raw, p?.price);
  }

  if (kind === 'fib' || kind === 'fibext' || kind === 'fibchannel' || kind === 'fibWedge') {
    const a = typeof drawing.p1?.price === 'number' ? drawing.p1.price : null;
    const b = typeof drawing.p2?.price === 'number' ? drawing.p2.price : null;
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
      const ratios =
        Array.isArray(drawing.meta?.fibLevels) && drawing.meta.fibLevels.length
          ? drawing.meta.fibLevels.filter((r) => typeof r === 'number' && Number.isFinite(r))
          : [...DRAWING_FIB_RATIOS];
      const span = b - a;
      for (const r of ratios) raw.push(a + span * r);
    }
  }

  return uniqueSorted(raw);
}

/**
 * Map of drawing id → price levels for live `drawing_touch` evaluation.
 * Drawings without an id or without prices are omitted.
 */
export function drawingPricesById(
  drawings: readonly DrawingLike[] | null | undefined,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!Array.isArray(drawings)) return out;
  for (const d of drawings) {
    const id = typeof d?.id === 'string' ? d.id : '';
    if (!id) continue;
    const levels = pricesFromDrawing(d);
    if (levels.length) out[id] = levels;
  }
  return out;
}

/** Short picker label: kind + primary price (or text). */
export function drawingAlertLabel(drawing: DrawingLike): string {
  const kind = String(drawing.kind || 'drawing');
  const text = (drawing.text || drawing.meta?.text || '').trim();
  const levels = pricesFromDrawing(drawing);
  const first = levels[0];
  const last = levels[levels.length - 1];
  let priceBit = '';
  if (levels.length === 1 && first != null) {
    priceBit = first.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } else if (levels.length > 1 && first != null && last != null) {
    priceBit = `${first.toLocaleString(undefined, { maximumFractionDigits: 4 })}–${last.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }
  if (text) return `${kind} · ${text.slice(0, 28)}${priceBit ? ` @ ${priceBit}` : ''}`;
  if (priceBit) return `${kind} · ${priceBit}`;
  return kind;
}
