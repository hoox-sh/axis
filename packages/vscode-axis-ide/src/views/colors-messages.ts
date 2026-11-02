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
 * Pine color scan + local Colors panel messages.
 * Pure — no vscode. Not part of axis.webview.v1.
 *
 * Named hex values match pyne `builtins/color.py` / editor color tools.
 */

/** Language ids: PYNE contributes `pinescript`; `pine` is also accepted. */
export const PINE_EDITOR_LANGUAGE_IDS = ['pinescript', 'pine'] as const;

/** One color occurrence. `line` and `column` are 1-based. */
export interface ColorHit {
  line: number;
  column: number;
  raw: string;
  /** CSS color when the literal resolves; otherwise the raw source text. */
  swatch: string;
}

/** Host → webview. Local type, not an axis.webview.v1 message. */
export interface ColorsSetMessage {
  type: 'colors.set';
  colors: ColorHit[];
  sourceLabel: string;
}

/** Webview → host. Local type, not an axis.webview.v1 message. */
export interface ColorsRevealMessage {
  type: 'colors.reveal';
  line: number;
}

/** CSS / TradingView classic names used by Pine `color.*`. */
export const NAMED_COLOR_SWATCH: Readonly<Record<string, string>> = {
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  orange: '#FFA500',
  yellow: '#FFFF00',
  purple: '#800080',
  white: '#FFFFFF',
  black: '#000000',
  gray: '#808080',
  silver: '#C0C0C0',
  teal: '#008080',
  lime: '#00FF00',
  aqua: '#00FFFF',
  fuchsia: '#FF00FF',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
};

const NAMED_LEAF = Object.keys(NAMED_COLOR_SWATCH).join('|');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True for PYNE `pinescript` and the extra `pine` id (any case). */
export function isPineEditorLanguage(languageId: unknown): boolean {
  if (typeof languageId !== 'string') return false;
  const id = languageId.toLowerCase();
  return (PINE_EDITOR_LANGUAGE_IDS as readonly string[]).includes(id);
}

/** File name for the Colors header. Empty paths become `Pine script`. */
export function pineSourceLabel(filePath: string): string {
  const name = filePath.trim();
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = (slash >= 0 ? name.slice(slash + 1) : name).trim();
  return base.length > 0 ? base : 'Pine script';
}

export function colorsSetMessage(
  colors: readonly ColorHit[],
  sourceLabel: string,
): ColorsSetMessage {
  const list: ColorHit[] = [];
  for (const hit of colors) {
    list.push({
      line: hit.line,
      column: hit.column,
      raw: hit.raw,
      swatch: hit.swatch,
    });
  }
  return { type: 'colors.set', colors: list, sourceLabel };
}

/** Webview loaded and can accept `colors.set`. Never throws. */
export function isColorsReady(raw: unknown): boolean {
  try {
    return isPlainObject(raw) && raw.type === 'colors.ready';
  } catch {
    return false;
  }
}

/**
 * Parse `{ type: 'colors.reveal', line }` (1-based).
 * Returns null for anything else. Never throws.
 */
export function parseColorsReveal(raw: unknown): ColorsRevealMessage | null {
  try {
    if (!isPlainObject(raw) || raw.type !== 'colors.reveal') return null;
    const line = raw.line;
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return null;
    return { type: 'colors.reveal', line };
  } catch {
    return null;
  }
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampTransp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Pine transparency 0–100 (0 = opaque) → CSS `rgb` / `rgba`. */
function cssFromChannels(r: number, g: number, b: number, transp: number): string {
  const rr = clampByte(r);
  const gg = clampByte(g);
  const bb = clampByte(b);
  const t = clampTransp(transp);
  if (t <= 0) return `rgb(${rr}, ${gg}, ${bb})`;
  const alpha = ((100 - t) * 10) / 1000;
  const text = alpha.toFixed(3).replace(/\.?0+$/, '');
  return `rgba(${rr}, ${gg}, ${bb}, ${text})`;
}

function channelsFromHex(token: string): { r: number; g: number; b: number } {
  const h = token.slice(1);
  if (h.length === 3) {
    return {
      r: parseInt(h[0]! + h[0]!, 16),
      g: parseInt(h[1]! + h[1]!, 16),
      b: parseInt(h[2]! + h[2]!, 16),
    };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function swatchFromRgbInner(inner: string): string | null {
  const m =
    /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*([+-]?\d+(?:\.\d+)?))?\s*$/.exec(
      inner,
    );
  if (!m) return null;
  const transp = m[4] != null ? Number(m[4]) : 0;
  return cssFromChannels(Number(m[1]), Number(m[2]), Number(m[3]), transp);
}

function swatchFromNewInner(inner: string): string | null {
  const re = new RegExp(
    `^\\s*(#[0-9a-fA-F]{8}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|color\\.(${NAMED_LEAF}))\\s*,\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*$`,
    'i',
  );
  const m = re.exec(inner);
  if (!m) return null;
  const base = m[1]!;
  const transp = Number(m[3]);
  if (base[0] === '#') {
    const ch = channelsFromHex(base);
    return cssFromChannels(ch.r, ch.g, ch.b, transp);
  }
  const leaf = base.slice(base.indexOf('.') + 1);
  const hex = NAMED_COLOR_SWATCH[leaf.toLowerCase()] ?? '';
  if (hex.length === 0) return null;
  const named = channelsFromHex(hex);
  return cssFromChannels(named.r, named.g, named.b, transp);
}

function swatchForCall(kind: string, inner: string, raw: string): string {
  const css = kind.toLowerCase() === 'rgb' ? swatchFromRgbInner(inner) : swatchFromNewInner(inner);
  return css ?? raw;
}

/** 1 at indexes inside line comments or block comments. Strings are not comments. */
function buildCommentMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let i = 0;
  let lineComment = false;
  let blockComment = false;
  while (i < source.length) {
    const c = source[i]!;
    if (lineComment) {
      mask[i] = 1;
      if (c === '\n') lineComment = false;
      i += 1;
      continue;
    }
    if (blockComment) {
      mask[i] = 1;
      if (c === '*' && source[i + 1] === '/') {
        mask[i + 1] = 1;
        blockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '\n') break;
        i += 1;
      }
      if (i < source.length && source[i] === quote) i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      lineComment = true;
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      blockComment = true;
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  return mask;
}

function positionAt(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function readCall(source: string, openParen: number): { end: number; inner: string } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < source.length; i += 1) {
    const c = source[i]!;
    if (quote) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(') {
      depth += 1;
      continue;
    }
    if (c === ')') {
      depth -= 1;
      if (depth === 0) return { end: i + 1, inner: source.slice(openParen + 1, i) };
    }
  }
  return null;
}

/**
 * Find hex literals (#rgb, #rrggbb, #rrggbbaa), color.rgb(...), color.new(...),
 * and Pine color.* builtins. Skips line and block comments. Hex inside
 * strings is still listed. Never throws on a string.
 */
export function scanColors(source: string): ColorHit[] {
  if (typeof source !== 'string' || source.length === 0) return [];
  const mask = buildCommentMask(source);
  const hits: ColorHit[] = [];

  const hexRe = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  for (const m of source.matchAll(hexRe)) {
    const index = m.index;
    if (mask[index] === 1) continue;
    const raw = m[0];
    const pos = positionAt(source, index);
    hits.push({ line: pos.line, column: pos.column, raw, swatch: raw });
  }

  const namedRe = new RegExp(`\\bcolor\\.(${NAMED_LEAF})\\b`, 'gi');
  for (const m of source.matchAll(namedRe)) {
    const index = m.index;
    if (mask[index] === 1) continue;
    const raw = m[0];
    const leaf = m[1]!.toLowerCase();
    const pos = positionAt(source, index);
    hits.push({
      line: pos.line,
      column: pos.column,
      raw,
      swatch: NAMED_COLOR_SWATCH[leaf] ?? raw,
    });
  }

  const callRe = /\bcolor\.(rgb|new)\s*\(/gi;
  for (const m of source.matchAll(callRe)) {
    const index = m.index;
    if (mask[index] === 1) continue;
    const open = index + m[0].length - 1;
    const call = readCall(source, open);
    if (!call) continue;
    const raw = source.slice(index, call.end);
    const pos = positionAt(source, index);
    hits.push({
      line: pos.line,
      column: pos.column,
      raw,
      swatch: swatchForCall(m[1]!, call.inner, raw),
    });
  }

  hits.sort((a, b) => a.line - b.line || a.column - b.column);
  return hits;
}
