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
 * Chord parsing, formatting, and event matching for the keyboard hub.
 *
 * Chords are written as dash-separated tokens, e.g. `Mod-Shift-K`, `Alt-Up`,
 * `Shift-?`, `Mod-/`. `Mod` is the abstract platform modifier: it expands to
 * `meta` on macOS and `ctrl` elsewhere. This module is framework-free so it
 * can be unit-tested without a DOM.
 */

import type { Chord } from './types';

export type Platform = 'mac' | 'win' | 'linux';

/** Detect the current platform defensively (no `navigator` in some test envs). */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux';
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  const raw = ua.userAgentData?.platform ?? navigator.platform ?? '';
  if (/mac/i.test(raw)) return 'mac';
  if (/win/i.test(raw)) return 'win';
  return 'linux';
}

/** Named-key aliases so `Esc`/`Up`/`Del` etc. normalize to stable DOM key names. */
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  space: ' ',
  enter: 'Enter',
  tab: 'Tab',
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
};

/** Normalize a key token from a chord string to a stable DOM key name. */
function normalizeKeyToken(token: string): string {
  const lower = token.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (lower.length === 1) return lower;
  return token;
}

/**
 * Parse a chord string into a {@link Chord}. `Mod` expands to `meta` on mac,
 * `ctrl` otherwise. Throws on empty chords or unknown modifier tokens; unknown
 * key names are kept (lowercased) so future CM-style names still parse.
 */
export function parseChord(s: string, platform?: Platform): Chord {
  const p = platform ?? detectPlatform();
  const tokens = s
    .split('-')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) throw new Error(`Invalid chord: ${s} — empty chord`);

  const chord: Chord = { key: '', mod: false, shift: false, alt: false, ctrl: false, meta: false };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const lower = t.toLowerCase();
    const isLast = i === tokens.length - 1;
    if (lower === 'mod') {
      chord.mod = true;
      if (p === 'mac') chord.meta = true;
      else chord.ctrl = true;
    } else if (lower === 'ctrl' || lower === 'control') {
      chord.ctrl = true;
    } else if (lower === 'meta' || lower === 'cmd') {
      chord.meta = true;
    } else if (lower === 'alt' || lower === 'option') {
      chord.alt = true;
    } else if (lower === 'shift') {
      chord.shift = true;
    } else if (isLast) {
      chord.key = normalizeKeyToken(t);
    } else {
      throw new Error(`Invalid chord: ${s} — unknown modifier '${t}'`);
    }
  }
  if (!chord.key) throw new Error(`Invalid chord: ${s} — missing key`);
  return chord;
}

/** Display key: single chars uppercase, named keys as-is. */
function displayKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Format a chord for display. macOS uses `⌘⇧⌥⌃` glyphs; win/linux use
 * `Ctrl+Shift+Alt+…`. This is the single source of truth for the palette's
 * `shortcut?` hint and the Shortcuts modal.
 */
export function formatChord(c: Chord | string, opts?: { platform?: Platform }): string {
  const chord = typeof c === 'string' ? parseChord(c, opts?.platform) : c;
  const p = opts?.platform ?? detectPlatform();
  const key = displayKey(chord.key);
  if (p === 'mac') {
    const parts: string[] = [];
    if (chord.meta) parts.push('⌘');
    if (chord.shift) parts.push('⇧');
    if (chord.alt) parts.push('⌥');
    if (chord.ctrl) parts.push('⌃');
    return parts.join('') + key;
  }
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.meta) parts.push('Meta');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  return parts.length ? parts.join('+') + '+' + key : key;
}

/** Map a `KeyboardEvent.code` to a stable key name (used when `event.key` is unreliable). */
const CODE_TO_KEY: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Space: ' ',
  Slash: '/',
  Period: '.',
  Comma: ',',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Quote: "'",
  Semicolon: ';',
  Backquote: '`',
  IntlBackslash: '\\',
};

function codeToKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return CODE_TO_KEY[code] ?? code.toLowerCase();
}

/** Normalize an event's key, falling back to `code` when `key` is missing/dead. */
export function normalizeEventKey(key: string | undefined, code: string | undefined): string {
  if (key && key !== 'Dead') {
    if (key.length === 1) return key.toLowerCase();
    return key;
  }
  if (code) return codeToKey(code);
  return '';
}

/**
 * Match a `KeyboardEvent` against a chord. Modifiers must match exactly
 * (a `Mod-Shift-K` binding does not fire on `Mod-K`). When `event.key` is
 * missing or a dead key, falls back to `event.code` via {@link CODE_TO_KEY}.
 */
export function matchEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & {
    code?: string;
  },
  chord: Chord | string,
): boolean {
  const c = typeof chord === 'string' ? parseChord(chord) : chord;
  if (event.ctrlKey !== c.ctrl) return false;
  if (event.metaKey !== c.meta) return false;
  if (event.shiftKey !== c.shift) return false;
  if (event.altKey !== c.alt) return false;
  const key = normalizeEventKey(event.key, event.code);
  return key === c.key;
}

/**
 * Canonical, platform-independent chord string used for override equality
 * checks and conflict detection. `mod-shift-k` → `Mod-Shift-K`.
 */
export function normalizeChord(s: string): string {
  const tokens = s
    .split('-')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) throw new Error(`Invalid chord: ${s} — empty chord`);
  const mods: string[] = [];
  let key = '';
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower === 'mod') mods.push('Mod');
    else if (lower === 'ctrl' || lower === 'control') mods.push('Ctrl');
    else if (lower === 'meta' || lower === 'cmd') mods.push('Meta');
    else if (lower === 'alt' || lower === 'option') mods.push('Alt');
    else if (lower === 'shift') mods.push('Shift');
    else key = displayKey(normalizeKeyToken(t));
  }
  if (!key) throw new Error(`Invalid chord: ${s} — missing key`);
  const order = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
  const sorted = [...mods].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...sorted, key].join('-');
}