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
 * Resolve Pine/engine color forms to CSS color strings for Lightweight
 * Charts and SVG paint.
 *
 * Engines send `plot_meta.color` (and per-bar bgcolor/barcolor samples) in
 * Pine forms — `color.red`, `color.new(color.blue, 90)`, `color.rgb(…)` —
 * which are not valid CSS. Passing them through verbatim makes LWC ignore
 * the color (series keeps defaults) and SVG sanitizers fall back to axis
 * indigo. Resolve before apply/sanitize; `null` means "use palette".
 *
 * Pine transparency is 0–100 (0 = opaque). `color.from_gradient` cannot be
 * evaluated without value context → `null` (palette fallback).
 *
 * @module results/pine-color
 */

import { parseColorInput } from '../editor/pine-colors';

function toCss(hex: { r: number; g: number; b: number; a: number }): string {
  const r = Math.max(0, Math.min(255, Math.round(hex.r)));
  const g = Math.max(0, Math.min(255, Math.round(hex.g)));
  const b = Math.max(0, Math.min(255, Math.round(hex.b)));
  const a = Math.max(0, Math.min(255, Math.round(hex.a)));
  if (a >= 255) {
    const h = (n: number): string => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  const alpha = Math.round((a / 255) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Resolve a Pine color (`color.red`, `color.new(…)`, `color.rgb(…)`), hex,
 * or CSS color function to a CSS string. Returns `null` for na/empty,
 * unknown tokens, unevaluatable forms (`color.from_gradient`), and CSS
 * injection vectors.
 */
export function resolvePineColor(value: unknown): string | null {
  if (value == null || typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > 128) return null;
  const lower = s.toLowerCase();
  if (lower === 'na' || lower === 'none' || lower === 'null') return null;
  // Fully transparent rgba() → inactive. Anchored: rgb() has no alpha and
  // must never match (opaque black is a real color); Pine transp belongs to
  // color.new()/color.rgb() and is handled by the parser below.
  if (/^rgba\(\s*[^)]*,\s*0(\.0+)?\s*\)$/i.test(s)) return null;
  if (/^#[0-9a-f]{6}00$/i.test(s)) return null;
  // CSS injection vectors never resolve (callers fall back to palette)
  if (
    lower.includes('url(') ||
    lower.includes('expression') ||
    lower.includes('javascript:') ||
    lower.includes('vbscript:') ||
    lower.includes('data:') ||
    lower.includes('-moz-binding') ||
    lower.includes('@import') ||
    lower.includes('behavior') ||
    lower.includes('\\') ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char rejection
    /[\u0000-\u001F\u007F\u2028\u2029]/.test(s)
  ) {
    return null;
  }

  // Valid rgb()/rgba() CSS passes through unchanged (engine already
  // resolved these; re-quantizing alpha through bytes would corrupt it).
  // Strict single balanced call, no trailing junk.
  if (
    /^rgba?\(\s*[\d.%+\-eE\s,/]+\s*\)$/i.test(s) &&
    (s.match(/\(/g) ?? []).length === 1 &&
    (s.match(/\)/g) ?? []).length === 1
  ) {
    return s;
  }

  // Valid #hex passes through unchanged (author/engine form preserved).
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;

  // Pine forms via the shared strict parser
  // (anchored full-match regexes; also covers `color.new` / `color.rgb`).
  try {
    const parsed = parseColorInput(s);
    if (parsed) return toCss(parsed);
  } catch {
    return null;
  }

  // hsl()/hsla() passthrough — strict single balanced call
  if (
    /^hsla?\(\s*[\d.%+\-eE\s,/deg]+\s*\)$/i.test(s) &&
    (s.match(/\(/g) ?? []).length === 1 &&
    (s.match(/\)/g) ?? []).length === 1
  ) {
    return s;
  }

  // Bare CSS color names (letters only) — canvas/LWC accept them
  if (/^[a-z]{1,32}$/i.test(s)) return s;

  return null;
}
