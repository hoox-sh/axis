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
 * Chord-recording hook shared by the Shortcuts modal and the Settings →
 * Keyboard panel. While `recording` is true it captures the *next* keydown
 * on `window` (capture phase), converts it to a canonical chord string, and
 * calls `onRecord`. It never listens outside an active recording session, so
 * regular typing is never swallowed.
 *
 * @module ui/shortcuts/use-record-chord
 */

import { createSignal, onCleanup } from 'solid-js';
import { detectPlatform, normalizeEventKey } from './keys';

/**
 * Convert a real KeyboardEvent into a canonical chord string the registry
 * understands. The platform primary modifier is recorded as `Mod` (⌘ on mac,
 * Ctrl elsewhere) so overrides stay platform-abstract like DEFAULT_BINDINGS.
 */
export function chordFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const p = detectPlatform();
  const mods: string[] = [];
  if (e.metaKey) mods.push(p === 'mac' ? 'Mod' : 'Meta');
  if (e.ctrlKey) mods.push(p === 'mac' ? 'Ctrl' : 'Mod');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = normalizeEventKey(e.key, e.code);
  if (!key) return '';
  // Canonical display casing: single chars uppercase (Mod-K), named keys as-is.
  const display = key.length === 1 ? key.toUpperCase() : key;
  return [...mods, display].join('-');
}

export interface RecordChordApi {
  /** True while waiting for the next keydown. */
  recording: () => boolean;
  /** Begin listening for the next keydown (capture phase). */
  start: () => void;
  /** Cancel an active recording session. */
  stop: () => void;
}

/**
 * Record the next keydown as a chord. `onRecord` receives the canonical
 * chord string (e.g. `Mod-Shift-K`); it is called after the session ends.
 */
export function useRecordChord(onRecord: (chord: string) => void): RecordChordApi {
  const [recording, setRecording] = createSignal(false);
  let listener: ((e: KeyboardEvent) => void) | null = null;

  const stop = () => {
    if (listener) {
      window.removeEventListener('keydown', listener, true);
      listener = null;
    }
    try {
      document.body?.removeAttribute?.('data-axis-recording-chord');
    } catch {
      /* non-DOM test environments */
    }
    setRecording(false);
  };

  const start = () => {
    stop();
    setRecording(true);
    listener = (e: KeyboardEvent) => {
      const chord = chordFromEvent(e);
      if (!chord) return; // no usable key (e.g. modifier-only event)
      e.preventDefault();
      // Capture-phase + immediate stop: no other Escape consumer (studio page
      // close, chart draft cancel, editor overlays) may steal the recorded key.
      e.stopImmediatePropagation?.();
      e.stopPropagation();
      stop();
      onRecord(chord);
    };
    window.addEventListener('keydown', listener, true);
    // Cross-layer guard: studio page close / chart handlers check this before
    // acting on Escape while a recording session is open.
    try {
      document.body?.setAttribute?.('data-axis-recording-chord', '1');
    } catch {
      /* non-DOM test environments */
    }
  };

  onCleanup(stop);

  return { recording, start, stop };
}