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
 * Default shortcut bindings + resolution helpers.
 *
 * The palette's `shortcut?` hint, the Shortcuts modal, and the Settings →
 * Keyboard recorder all read from this table. Overrides live in the app store
 * (`shortcuts` slice) and are passed in as {@link ShortcutOverrides}.
 */

import { formatChord, normalizeChord, type Platform } from './keys';
import type { ShortcutDef, ShortcutId, ShortcutOverrides } from './types';

/** Default bindings — the single source of truth for the shortcut surface. */
export const DEFAULT_BINDINGS: readonly ShortcutDef[] = [
  // --- App ---
  { id: 'app.open-palette', chord: 'Mod-K', description: 'Open command palette', scope: 'app' },
  { id: 'app.save', chord: 'Mod-S', description: 'Save active script to library', scope: 'app' },
  { id: 'app.run', chord: 'Mod-Enter', description: 'Run script', scope: 'app' },
  { id: 'app.toggle-editor', chord: 'Mod-\\', description: 'Toggle editor', scope: 'app' },
  { id: 'app.open-settings', chord: 'Mod-,', description: 'Open settings', scope: 'app' },
  { id: 'app.open-palette-alt', chord: 'Mod-Shift-P', description: 'Open command palette (alt)', scope: 'app' },
  { id: 'app.show-shortcuts', chord: 'Shift-?', description: 'Show keyboard shortcuts', scope: 'app' },
  { id: 'app.escape', chord: 'Esc', description: 'Close topmost modal / cancel', scope: 'app' },

  // --- Editor ---
  { id: 'editor.toggle-comment', chord: 'Mod-/', description: 'Toggle line comment', scope: 'editor' },
  { id: 'editor.duplicate-line', chord: 'Mod-D', description: 'Duplicate line', scope: 'editor' },
  { id: 'editor.delete-line', chord: 'Mod-Shift-K', description: 'Delete line', scope: 'editor' },
  { id: 'editor.move-line-up', chord: 'Alt-Up', description: 'Move line up', scope: 'editor' },
  { id: 'editor.move-line-down', chord: 'Alt-Down', description: 'Move line down', scope: 'editor' },
  { id: 'editor.goto-line', chord: 'Mod-G', description: 'Go to line', scope: 'editor' },
  { id: 'editor.toggle-ruler', chord: 'Mod-Shift-L', description: 'Toggle column ruler', scope: 'editor' },
  { id: 'editor.toggle-inline-debug', chord: 'Mod-Shift-D', description: 'Toggle inline debug', scope: 'editor' },
  { id: 'editor.toggle-profiler', chord: 'Mod-Shift-B', description: 'Toggle profiler', scope: 'editor' },

  // --- Chart ---
  { id: 'chart.zoom-in', chord: 'I', description: 'Zoom in', scope: 'chart' },
  { id: 'chart.zoom-out', chord: 'O', description: 'Zoom out', scope: 'chart' },
  { id: 'chart.reset-zoom', chord: '0', description: 'Reset zoom', scope: 'chart' },
  { id: 'chart.pan-left', chord: 'ArrowLeft', description: 'Pan left', scope: 'chart' },
  { id: 'chart.pan-right', chord: 'ArrowRight', description: 'Pan right', scope: 'chart' },
  { id: 'chart.pan-left-big', chord: 'Shift-ArrowLeft', description: 'Pan left (large step)', scope: 'chart' },
  { id: 'chart.pan-right-big', chord: 'Shift-ArrowRight', description: 'Pan right (large step)', scope: 'chart' },
  { id: 'chart.step-prev', chord: 'Alt-ArrowLeft', description: 'Previous bar', scope: 'chart' },
  { id: 'chart.step-next', chord: 'Alt-ArrowRight', description: 'Next bar', scope: 'chart' },
  { id: 'chart.tool-crosshair', chord: 'Q', description: 'Crosshair tool', scope: 'chart' },
  { id: 'chart.tool-magnet', chord: 'W', description: 'Magnet tool', scope: 'chart' },
  { id: 'chart.tool-eraser', chord: 'E', description: 'Eraser tool', scope: 'chart' },
  { id: 'chart.tool-measure', chord: 'M', description: 'Measure tool', scope: 'chart' },
  { id: 'chart.tool-trend', chord: 'L', description: 'Trend line tool', scope: 'chart' },
  { id: 'chart.tool-fib', chord: 'F', description: 'Fibonacci tool', scope: 'chart' },
  { id: 'chart.tool-rect', chord: 'R', description: 'Rectangle tool', scope: 'chart' },
  { id: 'chart.tool-text', chord: 'T', description: 'Text tool', scope: 'chart' },
  { id: 'chart.tool-hline', chord: 'H', description: 'Horizontal line tool', scope: 'chart' },
  { id: 'chart.tool-brush', chord: 'X', description: 'Brush tool', scope: 'chart' },
  { id: 'chart.delete-selected', chord: 'Delete', description: 'Delete selected drawing', scope: 'chart' },
  { id: 'chart.cancel-draft', chord: 'Esc', description: 'Cancel drawing draft', scope: 'chart' },
  { id: 'chart.layout-1', chord: 'Alt-1', description: 'Single chart layout', scope: 'chart' },
  { id: 'chart.layout-2h', chord: 'Alt-2', description: 'Two charts (horizontal)', scope: 'chart' },
  { id: 'chart.layout-2v', chord: 'Alt-3', description: 'Two charts (vertical)', scope: 'chart' },
  { id: 'chart.layout-4', chord: 'Alt-4', description: 'Four chart layout', scope: 'chart' },

  // --- Panel focus ---
  { id: 'panel.focus-editor', chord: 'Mod-0', description: 'Focus editor', scope: 'app' },
  { id: 'panel.focus-chart', chord: 'Mod-Alt-0', description: 'Focus chart', scope: 'app' },
];

/** Look up the default chord for a shortcut id. */
export function getDefaultChord(id: ShortcutId): string | undefined {
  return DEFAULT_BINDINGS.find((d) => d.id === id)?.chord;
}

/**
 * Resolve the effective chord for a binding, honoring overrides.
 * Returns `null` when the user cleared the binding (`id → null`).
 */
export function resolveBinding(
  def: ShortcutDef | { id: ShortcutId },
  overrides: ShortcutOverrides,
): string | null {
  const override = overrides[def.id];
  if (override === null) return null;
  if (override !== undefined) return override;
  return 'chord' in def ? def.chord : getDefaultChord(def.id) ?? null;
}

/**
 * Group bindings by normalized chord and return ids that share a chord.
 * Pure — used by the Settings recorder to flag conflicts.
 */
export function detectConflicts(
  bindings: readonly ShortcutDef[],
  overrides: ShortcutOverrides,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const def of bindings) {
    const chord = resolveBinding(def, overrides);
    if (!chord) continue;
    const norm = normalizeChord(chord);
    const list = groups.get(norm) ?? [];
    list.push(def.id);
    groups.set(norm, list);
  }
  const conflicts = new Map<string, string[]>();
  for (const [norm, ids] of groups) {
    if (ids.length > 1) conflicts.set(norm, ids);
  }
  return conflicts;
}

/** Convenience: resolve + format a binding for display (palette hint, modal). */
export function getDisplay(id: ShortcutId, overrides: ShortcutOverrides, platform?: Platform): string {
  const def = DEFAULT_BINDINGS.find((d) => d.id === id);
  if (!def) return '';
  const chord = resolveBinding(def, overrides);
  if (!chord) return '';
  return formatChord(chord, { platform });
}