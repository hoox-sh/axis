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
 * Pine Script™ color helpers for the editor: scan document for color
 * literals / `color.*` forms, resolve to RGBA, and convert between formats.
 *
 * Named hex values match pyne `builtins/color.py` `_NAMED_COLORS`.
 *
 * @module editor/pine-colors
 */

/** Pine named colors (CSS / TV classic names). Keys are bare leaf names. */
export const PINE_NAMED_COLORS: Readonly<Record<string, string>> = {
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  black: '#000000',
  white: '#FFFFFF',
  gray: '#808080',
  grey: '#808080',
  orange: '#FFA500',
  purple: '#800080',
  yellow: '#FFFF00',
  aqua: '#00FFFF',
  fuchsia: '#FF00FF',
  lime: '#00FF00',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  silver: '#C0C0C0',
  teal: '#008080',
};

export type PineColorKind = 'hex' | 'named' | 'rgb' | 'new' | 'rgba';

/** One color occurrence in source. */
export type PineColorHit = {
  /** Absolute start offset in the document */
  from: number;
  /** Absolute end offset (exclusive) */
  to: number;
  /** 1-based line */
  line: number;
  /** Exact source text of the hit */
  text: string;
  kind: PineColorKind;
  r: number;
  g: number;
  b: number;
  /**
   * Pine transparency 0–100 (0 = opaque, 100 = fully transparent).
   * Matches `color.new` / `color.rgb` 4th arg.
   */
  transp: number;
};

/** Normalized RGBA (channels 0–255). */
export type RgbaColor = { r: number; g: number; b: number; a: number };

/** clamp channel */
function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampTransp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Alpha 0–255 from Pine transp 0–100. */
export function transpToAlpha(transp: number): number {
  return clampByte(255 * (1 - clampTransp(transp) / 100));
}

/** Pine transp 0–100 from alpha 0–255. */
export function alphaToTransp(alpha: number): number {
  return clampTransp(100 * (1 - clampByte(alpha) / 255));
}

export function rgbaFromChannels(
  r: number,
  g: number,
  b: number,
  a = 255,
): RgbaColor {
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clampByte(a) };
}

export function toHex6(c: RgbaColor | { r: number; g: number; b: number }): string {
  const r = clampByte(c.r);
  const g = clampByte(c.g);
  const b = clampByte(c.b);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
    .toString(16)
    .padStart(2, '0')}`.toUpperCase();
}

export function toHex8(c: RgbaColor): string {
  return `${toHex6(c)}${clampByte(c.a).toString(16).padStart(2, '0')}`.toUpperCase();
}

/** CSS `rgba()` for previews (alpha 0–1). */
export function toCssRgba(c: RgbaColor): string {
  const a = Math.round((clampByte(c.a) / 255) * 1000) / 1000;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

export function toPineRgb(c: RgbaColor, withTransp = false): string {
  if (withTransp || c.a < 255) {
    return `color.rgb(${c.r}, ${c.g}, ${c.b}, ${alphaToTransp(c.a)})`;
  }
  return `color.rgb(${c.r}, ${c.g}, ${c.b})`;
}

export function toPineNew(c: RgbaColor, baseHex?: string): string {
  const hex = (baseHex && /^#[0-9A-Fa-f]{6,8}$/.test(baseHex) ? baseHex : toHex6(c)).toUpperCase();
  const t = alphaToTransp(c.a);
  if (t <= 0) return hex.startsWith('#') ? hex.slice(0, 7) : hex;
  return `color.new(${hex.slice(0, 7)}, ${t})`;
}

/** Expand #rgb / #rgba / #rrggbb / #rrggbbaa → RgbaColor. */
export function parseHexColor(raw: string): RgbaColor | null {
  const s = raw.trim();
  const m = s.match(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!m) return null;
  const h = m[1]!;
  if (h.length === 3 || h.length === 4) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    const a = h.length === 4 ? parseInt(h[3]! + h[3]!, 16) : 255;
    return rgbaFromChannels(r, g, b, a);
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return rgbaFromChannels(r, g, b, a);
}

export function parseNamedColor(name: string): RgbaColor | null {
  const leaf = name.replace(/^color\./i, '').toLowerCase().trim();
  const hex = PINE_NAMED_COLORS[leaf];
  if (!hex) return null;
  return parseHexColor(hex);
}

/**
 * Parse free-form color text: hex, `color.red`, `rgb()`, `rgba()`,
 * `color.rgb(...)`, `color.new(...)`.
 */
export function parseColorInput(raw: string): RgbaColor | null {
  const s = raw.trim();
  if (!s) return null;

  const hex = parseHexColor(s);
  if (hex) return hex;

  const named = parseNamedColor(s);
  if (named) return named;

  // rgb()/rgba()
  const mRgba = s.match(
    /^rgba?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*([+-]?\d+(?:\.\d+)?))?\s*\)$/i,
  );
  if (mRgba) {
    const r = Number(mRgba[1]);
    const g = Number(mRgba[2]);
    const b = Number(mRgba[3]);
    let a = 255;
    if (mRgba[4] != null) {
      const v = Number(mRgba[4]);
      a = v <= 1 ? clampByte(v * 255) : clampByte(v);
    }
    return rgbaFromChannels(r, g, b, a);
  }

  // color.rgb(r, g, b[, transp])
  const mRgb = s.match(
    /^color\.rgb\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*([+-]?\d+(?:\.\d+)?))?\s*\)$/i,
  );
  if (mRgb) {
    const r = Number(mRgb[1]);
    const g = Number(mRgb[2]);
    const b = Number(mRgb[3]);
    const transp = mRgb[4] != null ? Number(mRgb[4]) : 0;
    return rgbaFromChannels(r, g, b, transpToAlpha(transp));
  }

  // color.new(base, transp)
  const mNew = s.match(/^color\.new\s*\(\s*(.+?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)$/i);
  if (mNew) {
    const base = parseColorInput(mNew[1]!.trim());
    if (!base) return null;
    const transp = Number(mNew[2]);
    return rgbaFromChannels(base.r, base.g, base.b, transpToAlpha(transp));
  }

  return null;
}

export type ColorFormats = {
  hex6: string;
  hex8: string;
  cssRgb: string;
  cssRgba: string;
  pineRgb: string;
  pineRgbTransp: string;
  pineNew: string;
  named: string | null;
  transp: number;
};

export function colorFormats(c: RgbaColor): ColorFormats {
  const transp = alphaToTransp(c.a);
  const hex6 = toHex6(c);
  // Prefer a named color when opaque and exact match
  let named: string | null = null;
  if (c.a >= 255) {
    for (const [name, hx] of Object.entries(PINE_NAMED_COLORS)) {
      if (hx.toUpperCase() === hex6) {
        named = `color.${name}`;
        break;
      }
    }
  }
  return {
    hex6,
    hex8: toHex8(c),
    cssRgb: `rgb(${c.r}, ${c.g}, ${c.b})`,
    cssRgba: toCssRgba(c),
    pineRgb: toPineRgb({ ...c, a: 255 }, false),
    pineRgbTransp: toPineRgb(c, true),
    pineNew: toPineNew(c, hex6),
    named,
    transp,
  };
}

function lineAt(doc: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < doc.length; i++) {
    if (doc.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** Match balanced call args starting at open paren index (value must be `(`). */
function readCallArgs(source: string, openParen: number): { end: number; inner: string } | null {
  if (source[openParen] !== '(') return null;
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openParen; i < source.length; i++) {
    const c = source[i]!;
    if (inStr) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) {
        return { end: i + 1, inner: source.slice(openParen + 1, i) };
      }
    }
  }
  return null;
}

/**
 * Scan Pine source for color occurrences (hex, named, color.rgb, color.new).
 * Skips `//` line comments and simple `/* *\/` blocks; does not fully parse strings
 * as exclusive (hex inside string literals is still useful to list).
 */
export function scanPineColors(source: string): PineColorHit[] {
  if (!source) return [];
  const hits: PineColorHit[] = [];
  const seenRanges = new Set<string>();

  const push = (hit: PineColorHit) => {
    const key = `${hit.from}:${hit.to}`;
    if (seenRanges.has(key)) return;
    seenRanges.add(key);
    hits.push(hit);
  };

  // Strip comments to a parallel mask? Simpler: walk with comment awareness for named/calls;
  // hex can still match in comments — filter by checking comment state at match index.
  const commentMask = buildCommentMask(source);

  // Hex literals
  const hexRe = /#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(source)) !== null) {
    if (commentMask[m.index]) continue;
    const rgba = parseHexColor(m[0]!);
    if (!rgba) continue;
    push({
      from: m.index,
      to: m.index + m[0]!.length,
      line: lineAt(source, m.index),
      text: m[0]!,
      kind: 'hex',
      r: rgba.r,
      g: rgba.g,
      b: rgba.b,
      transp: alphaToTransp(rgba.a),
    });
  }

  // color.named
  const namedRe = /\bcolor\.(red|green|blue|black|white|gray|grey|orange|purple|yellow|aqua|fuchsia|lime|maroon|navy|olive|silver|teal)\b/gi;
  while ((m = namedRe.exec(source)) !== null) {
    if (commentMask[m.index]) continue;
    // Skip if this is color.new / color.rgb / color.r etc. — named list is exact
    const rgba = parseNamedColor(m[0]!);
    if (!rgba) continue;
    // Avoid double-counting when part of color.new(color.red, …) — still list the named leaf
    push({
      from: m.index,
      to: m.index + m[0]!.length,
      line: lineAt(source, m.index),
      text: m[0]!,
      kind: 'named',
      r: rgba.r,
      g: rgba.g,
      b: rgba.b,
      transp: 0,
    });
  }

  // color.rgb(...) / color.new(...)
  const callRe = /\bcolor\.(rgb|new)\s*\(/gi;
  while ((m = callRe.exec(source)) !== null) {
    if (commentMask[m.index]) continue;
    const open = m.index + m[0]!.length - 1;
    const call = readCallArgs(source, open);
    if (!call) continue;
    const full = source.slice(m.index, call.end);
    const rgba = parseColorInput(full);
    if (!rgba) continue;
    const kind: PineColorKind = m[1]!.toLowerCase() === 'new' ? 'new' : 'rgb';
    push({
      from: m.index,
      to: call.end,
      line: lineAt(source, m.index),
      text: full,
      kind,
      r: rgba.r,
      g: rgba.g,
      b: rgba.b,
      transp: alphaToTransp(rgba.a),
    });
  }

  hits.sort((a, b) => a.from - b.from || a.to - b.to);
  return hits;
}

/** Unique colors for chips (dedupe by rgba + preferred text). */
export function uniqueColorChips(hits: PineColorHit[]): Array<{
  key: string;
  r: number;
  g: number;
  b: number;
  transp: number;
  label: string;
  count: number;
  first: PineColorHit;
}> {
  const map = new Map<
    string,
    {
      key: string;
      r: number;
      g: number;
      b: number;
      transp: number;
      label: string;
      count: number;
      first: PineColorHit;
    }
  >();
  for (const h of hits) {
    const key = `${h.r},${h.g},${h.b},${h.transp}`;
    const cur = map.get(key);
    if (cur) {
      cur.count += 1;
      // Prefer shorter stable labels
      if (h.text.length < cur.label.length) cur.label = h.text;
    } else {
      map.set(key, {
        key,
        r: h.r,
        g: h.g,
        b: h.b,
        transp: h.transp,
        label: h.text,
        count: 1,
        first: h,
      });
    }
  }
  return [...map.values()];
}

/** true at index if inside // or /* comment */
function buildCommentMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let i = 0;
  let line = false;
  let block = false;
  while (i < source.length) {
    if (line) {
      mask[i] = 1;
      if (source[i] === '\n') line = false;
      i += 1;
      continue;
    }
    if (block) {
      mask[i] = 1;
      if (source[i] === '*' && source[i + 1] === '/') {
        mask[i + 1] = 1;
        block = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      mask[i] = 1;
      mask[i + 1] = 1;
      line = true;
      i += 2;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      mask[i] = 1;
      mask[i + 1] = 1;
      block = true;
      i += 2;
      continue;
    }
    i += 1;
  }
  return mask;
}

/** Replace a hit range in `doc` with `replacement`. */
export function replaceColorHit(
  doc: string,
  hit: Pick<PineColorHit, 'from' | 'to'>,
  replacement: string,
): string {
  return doc.slice(0, hit.from) + replacement + doc.slice(hit.to);
}

/** Build replacement string from editor draft (hex + Pine transp). */
export function formatReplacement(
  r: number,
  g: number,
  b: number,
  transp: number,
  style: 'hex' | 'rgb' | 'new' | 'named',
): string {
  const c = rgbaFromChannels(r, g, b, transpToAlpha(transp));
  const fmts = colorFormats(c);
  switch (style) {
    case 'named':
      return fmts.named || fmts.hex6;
    case 'rgb':
      return transp > 0 ? fmts.pineRgbTransp : fmts.pineRgb;
    case 'new':
      return transp > 0 ? fmts.pineNew : fmts.hex6;
    case 'hex':
    default:
      return transp > 0 ? fmts.pineNew : fmts.hex6;
  }
}
