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
 * Shared hardening helpers for drawing tool handlers and the paint layer.
 *
 * @module chart/drawings/tools/safe
 */

import type { Point } from '../../drawing-types';

/** Max user-facing label length (SVG text / meta). */
export const DRAWING_TEXT_MAX = 200;

/** Cap freehand / polyline anchors to avoid unbounded SVG path growth. */
export const DRAWING_POINTS_MAX = 2_000;

/** True when time and price are finite numbers. */
export function isFinitePoint(p: unknown): p is Point {
  if (!p || typeof p !== 'object') return false;
  const o = p as { time?: unknown; price?: unknown };
  return Number.isFinite(o.time) && Number.isFinite(o.price);
}

/** Filter + clamp a point list for create/paint. */
export function sanitizePoints(points: Point[] | null | undefined, max = DRAWING_POINTS_MAX): Point[] {
  if (!Array.isArray(points) || !points.length) return [];
  const out: Point[] = [];
  for (const p of points) {
    if (!isFinitePoint(p)) continue;
    out.push({ time: Number(p.time), price: Number(p.price) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Strip control chars and cap length for SVG labels / prompts.
 * Does not interpret HTML (labels use textContent).
 */
export function sanitizeDrawingText(raw: unknown, max = DRAWING_TEXT_MAX): string {
  let s = raw == null ? '' : String(raw);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Safe color for stroke / fill attributes.
 * Rejects CSS injection vectors (`url(`, `expression`, schemes, control chars,
 * multi-statement trailing junk). Full-string match only for allowed forms.
 */
export function sanitizeStrokeColor(raw: unknown, fallback = '#939fff'): string {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 64) return fallback;
  // Newlines / control chars enable multi-statement CSS injection in style attrs.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\u2028\u2029]/.test(s)) return fallback;

  const lower = s.toLowerCase();
  if (
    lower.includes('url(') ||
    lower.includes('expression') ||
    lower.includes('javascript:') ||
    lower.includes('vbscript:') ||
    lower.includes('data:') ||
    lower.includes('-moz-binding') ||
    lower.includes('@import') ||
    lower.includes('behavior') ||
    lower.includes('\\')
  ) {
    return fallback;
  }

  // #rgb, #rgba, #rrggbb, #rrggbbaa
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;

  // rgb/rgba/hsl/hsla — full match, modern or comma syntax, no trailing junk
  if (
    /^(rgb|rgba|hsl|hsla)\(\s*[\d.%+\-eE\s,/deg]+\s*\)$/i.test(s) &&
    (s.match(/\(/g) ?? []).length === 1 &&
    (s.match(/\)/g) ?? []).length === 1
  ) {
    return s;
  }

  // CSS named colors (letters only)
  if (/^[a-z]{1,32}$/i.test(s)) return s;

  // Restricted functional forms (balanced single call, no nested injection)
  if (/^color-mix\(\s*in\s+[a-z0-9%.\s,+#-]{1,48}\)$/i.test(s)) return s;
  if (/^var\(--[a-zA-Z0-9_-]{1,40}\)$/.test(s)) return s;

  return fallback;
}

/** Finite number or fallback. */
export function finiteOr(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Prompt helper with length cap; works without `window` (tests / SSR).
 */
export function safePrompt(message: string, fallback: string): string {
  let raw = fallback;
  try {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      const v = window.prompt(message, fallback);
      if (v != null) raw = v;
    }
  } catch {
    /* ignore prompt failures */
  }
  return sanitizeDrawingText(raw) || sanitizeDrawingText(fallback) || 'Note';
}

/** Clamp opacity 0–1. */
export function clampOpacity(n: unknown, fallback = 0.15): number {
  const v = finiteOr(n, fallback);
  return Math.max(0, Math.min(1, v));
}

/** Clamp stroke width to a sane paint range. */
export function clampStrokeWidth(n: unknown, fallback = 1.5): number {
  const v = finiteOr(n, fallback);
  return Math.max(0.5, Math.min(32, v));
}
