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
 * @module ui/shortcuts/actions
 *
 * App-level shortcut side effects, registered once at module load. Importing
 * this module (directly, or via Hub.tsx) wires the eight `app.*` bindings to
 * their real actions. Editor/chart bindings are registered by their own
 * modules (editor keymap, chart host).
 */

import { store, setEditorOpen, setEditorMode, isPanelOpen } from '../../store';
import { registerShortcut } from './runtime';
import { togglePalette } from './palette-bridge';
import {
  zoomChartBy,
  panChartBy,
  resetChartZoom,
  toggleCrosshair,
  toggleMagnet,
  deleteSelectedDrawing,
  selectDrawingTool,
  applyChartGrid,
} from '../../chart/keymap-actions';

/** Fire a window CustomEvent defensively (test DOM may lack CustomEvent). */
function emit(name: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(name));
  } catch {
    /* test DOM without CustomEvent */
  }
}

// --- App ---

// Mod-K — open / close the command palette (global, works from any focus).
registerShortcut('app.open-palette', () => togglePalette());

// Mod-Shift-P — palette alt chord, same toggle.
registerShortcut('app.open-palette-alt', () => togglePalette());

// Mod-S — save the active script to the library (tabbed-editor listens).
registerShortcut('app.save', () => {
  setEditorOpen(true);
  emit('axis-editor-save-library');
});

// Mod-Enter — run the active script (tabbed-editor listens).
registerShortcut('app.run', () => {
  setEditorOpen(true);
  emit('axis-editor-run');
});

// Mod-\ — toggle the docked editor (popout mode re-docks first).
registerShortcut('app.toggle-editor', () => {
  if (store.editor.mode === 'popout') {
    setEditorMode('docked');
    setEditorOpen(true);
    return;
  }
  setEditorOpen(!isPanelOpen('editor'));
});

// Mod-, — open Settings (app shell listens for the event).
registerShortcut('app.open-settings', () => emit('axis-open-settings'));

// Shift-? — open the Shortcuts modal (ShortcutsModal listens).
registerShortcut('app.show-shortcuts', () => emit('axis-shortcuts-open'));

// Esc — close topmost modal. The dialog-skip guard in runtime.ts keeps this
// from firing while a modal / the palette is open (they handle their own Esc);
// when nothing is open we forward for chart-only exit and cancel any drawing
// draft (the DrawingLayer listens for axis-drawing-cancel-draft).
registerShortcut('app.escape', () => {
  emit('axis-escape');
  emit('axis-drawing-cancel-draft');
});

// --- Chart ---

// Zoom / pan / step (I/O/0, arrows, ,/. — chart-only, no-op without a chart).
registerShortcut('chart.zoom-in', () => zoomChartBy(+0.2));
registerShortcut('chart.zoom-out', () => zoomChartBy(-0.2));
registerShortcut('chart.reset-zoom', () => resetChartZoom());
registerShortcut('chart.pan-left', () => panChartBy(-1));
registerShortcut('chart.pan-right', () => panChartBy(+1));
registerShortcut('chart.pan-left-big', () => panChartBy(-10));
registerShortcut('chart.pan-right-big', () => panChartBy(+10));
registerShortcut('chart.step-prev', () => panChartBy(-50));
registerShortcut('chart.step-next', () => panChartBy(+50));

// Tool letters (Q/W/E/M/L/F/R/T/H/X).
registerShortcut('chart.tool-crosshair', () => toggleCrosshair());
registerShortcut('chart.tool-magnet', () => toggleMagnet());
registerShortcut('chart.tool-eraser', () => selectDrawingTool('eraser'));
registerShortcut('chart.tool-measure', () => selectDrawingTool('measure'));
registerShortcut('chart.tool-trend', () => selectDrawingTool('trend'));
registerShortcut('chart.tool-fib', () => selectDrawingTool('fib'));
registerShortcut('chart.tool-rect', () => selectDrawingTool('rect'));
registerShortcut('chart.tool-text', () => selectDrawingTool('text'));
registerShortcut('chart.tool-hline', () => selectDrawingTool('hline'));
registerShortcut('chart.tool-brush', () => selectDrawingTool('brush'));

// Delete / cancel draft. Esc normally matches app.escape first (registry
// order); this binding is the fallback when app.escape is overridden away.
registerShortcut('chart.delete-selected', () => deleteSelectedDrawing());
registerShortcut('chart.cancel-draft', () => emit('axis-drawing-cancel-draft'));

// Grid layouts (Alt-1..4).
registerShortcut('chart.layout-1', () => applyChartGrid('1'));
registerShortcut('chart.layout-2h', () => applyChartGrid('2h'));
registerShortcut('chart.layout-2v', () => applyChartGrid('2v'));
registerShortcut('chart.layout-4', () => applyChartGrid('4'));