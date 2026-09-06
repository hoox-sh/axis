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
 * Shortcut identity + chord types shared by the keyboard hub, registry,
 * palette rendering, and the Settings → Keyboard recorder.
 */

/** Stable ids for every bindable shortcut in the app. */
export type ShortcutId =
  | 'app.open-palette'
  | 'app.save'
  | 'app.run'
  | 'app.toggle-editor'
  | 'app.open-settings'
  | 'app.open-palette-alt'
  | 'app.show-shortcuts'
  | 'app.escape'
  | 'editor.toggle-comment'
  | 'editor.duplicate-line'
  | 'editor.delete-line'
  | 'editor.move-line-up'
  | 'editor.move-line-down'
  | 'editor.goto-line'
  | 'editor.toggle-ruler'
  | 'editor.toggle-inline-debug'
  | 'editor.toggle-profiler'
  | 'chart.zoom-in'
  | 'chart.zoom-out'
  | 'chart.reset-zoom'
  | 'chart.pan-left'
  | 'chart.pan-right'
  | 'chart.pan-left-big'
  | 'chart.pan-right-big'
  | 'chart.step-prev'
  | 'chart.step-next'
  | 'chart.tool-crosshair'
  | 'chart.tool-magnet'
  | 'chart.tool-eraser'
  | 'chart.tool-measure'
  | 'chart.tool-trend'
  | 'chart.tool-fib'
  | 'chart.tool-rect'
  | 'chart.tool-text'
  | 'chart.tool-hline'
  | 'chart.tool-brush'
  | 'chart.delete-selected'
  | 'chart.cancel-draft'
  | 'chart.layout-1'
  | 'chart.layout-2h'
  | 'chart.layout-2v'
  | 'chart.layout-4'
  | 'panel.focus-editor'
  | 'panel.focus-chart'
  | 'palette.insert-snippet'
  | 'palette.find-across'
  | 'palette.recent'
  | 'palette.theme-cycle'
  | 'palette.snapshot'
  | 'palette.compact-panels'
  | 'palette.reset-shortcuts';

/** Parsed chord: `mod` is the abstract platform modifier (⌘ on mac, Ctrl elsewhere). */
export type Chord = {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
};

/** A bindable shortcut definition. `chord` is the default binding (e.g. `Mod-Shift-K`). */
export interface ShortcutDef {
  id: ShortcutId;
  chord: string;
  description: string;
  scope: 'app' | 'editor' | 'chart' | 'palette';
}

/** User overrides: `null` clears a binding, a string replaces it. */
export interface ShortcutOverrides {
  [id: string]: string | null;
}

/** Shape of the persisted `shortcuts` slice in the app store. */
export interface ShortcutRegistryShape {
  defaults: readonly ShortcutDef[];
  overrides: ShortcutOverrides;
}