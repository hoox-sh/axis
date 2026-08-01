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
 * CodeMirror 6 **column ruler** — vertical guide at a recommended character
 * column (default 80). Positions via `defaultCharacterWidth` / `coordsAtPos`
 * so the line tracks the monospace column, not a fixed pixel guess.
 *
 * Mount with {@link columnRulerExtension}; toggle visibility via `enabled`
 * (re-read on every view update) or {@link refreshColumnRuler} after external
 * flag changes that do not produce a CM transaction.
 *
 * @module editor/column-ruler
 */

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  StateEffect,
  type Extension,
} from '@codemirror/state';

/** Recommended line length (characters) for the default guide. */
export const DEFAULT_RULER_COLUMN = 80;

/** Subtle void-indigo dashed stroke used by the guide. */
export const RULER_STROKE = 'rgba(147,159,255,0.25)';

export type ColumnRulerOptions = {
  /** Character column for the guide (1-based semantics: after N chars). Default 80. */
  column?: number;
  /**
   * When provided, called on each sync; return false to hide the ruler.
   * Defaults to always enabled.
   */
  enabled?: () => boolean;
};

/**
 * Normalize a column option to a positive integer.
 * Non-finite / missing values fall back to {@link DEFAULT_RULER_COLUMN}.
 */
export function normalizeRulerColumn(column: number | null | undefined): number {
  if (column == null || !Number.isFinite(column)) return DEFAULT_RULER_COLUMN;
  const n = Math.floor(Number(column));
  if (n < 1) return 1;
  return n;
}

/**
 * Horizontal offset (px) from the text content left edge to the ruler at
 * `column`, given the editor's default character width.
 */
export function rulerOffsetFromContent(charWidth: number, column: number): number {
  const col = normalizeRulerColumn(column);
  const w = Number.isFinite(charWidth) && charWidth > 0 ? charWidth : 0;
  return w * col;
}

/**
 * Document-local left (relative to `scrollDOM` content coordinates) for a
 * vertical guide at `column`. Uses `coordsAtPos` on a visible line start when
 * available, else falls back to `contentDOM` offset + character width.
 *
 * Returns `null` when the view is not measurable yet.
 */
export function measureRulerLeft(view: EditorView, column: number): number | null {
  const col = normalizeRulerColumn(column);
  const charW = view.defaultCharacterWidth;
  const offset = rulerOffsetFromContent(charW, col);
  if (!(offset >= 0) || !Number.isFinite(offset)) return null;

  const scroller = view.scrollDOM;
  // Prefer coordsAtPos so content padding / gutters are accounted for accurately.
  try {
    const from = view.viewport.from;
    const lineStart = view.state.doc.lineAt(from).from;
    const coords = view.coordsAtPos(lineStart);
    if (coords) {
      const scrollRect = scroller.getBoundingClientRect();
      // Convert viewport X → scroll-content coordinates (scrolls with text).
      return coords.left - scrollRect.left + scroller.scrollLeft + offset;
    }
  } catch {
    /* unmounted / empty */
  }

  // Fallback: contentDOM offsetLeft is relative to offsetParent (often scroller).
  const contentLeft = view.contentDOM.offsetLeft;
  if (!Number.isFinite(contentLeft)) return null;
  return contentLeft + offset;
}

/** Force the ruler plugin to re-read `enabled` / remeasure (no doc change). */
export const refreshColumnRulerEffect = StateEffect.define<null>();

/** Dispatch a no-op effect so the ViewPlugin re-syncs (e.g. store toggle). */
export function refreshColumnRuler(view: EditorView): void {
  view.dispatch({ effects: refreshColumnRulerEffect.of(null) });
}

const columnRulerTheme = EditorView.baseTheme({
  '.cm-column-ruler': {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: '0',
    borderLeft: `1px dashed ${RULER_STROKE}`,
    pointerEvents: 'none',
    zIndex: '1',
  },
});

class ColumnRulerPlugin {
  readonly dom: HTMLDivElement;
  readonly column: number;
  readonly enabled: (() => boolean) | undefined;

  constructor(
    readonly view: EditorView,
    opts: ColumnRulerOptions,
  ) {
    this.column = normalizeRulerColumn(opts.column ?? DEFAULT_RULER_COLUMN);
    this.enabled = opts.enabled;
    this.dom = document.createElement('div');
    this.dom.className = 'cm-column-ruler';
    this.dom.setAttribute('aria-hidden', 'true');
    this.dom.dataset.column = String(this.column);
    // Absolute child of scroller scrolls with document content.
    view.scrollDOM.appendChild(this.dom);
    this.sync();
  }

  update(update: ViewUpdate) {
    const forced = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(refreshColumnRulerEffect)),
    );
    if (
      forced ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.docChanged ||
      update.selectionSet
    ) {
      this.sync();
    } else {
      // Still re-check enabled on any update (cheap).
      this.syncVisibility();
    }
  }

  private isOn(): boolean {
    try {
      return this.enabled ? !!this.enabled() : true;
    } catch {
      return true;
    }
  }

  private syncVisibility() {
    this.dom.style.display = this.isOn() ? '' : 'none';
  }

  sync() {
    if (!this.isOn()) {
      this.dom.style.display = 'none';
      return;
    }
    this.dom.style.display = '';
    const left = measureRulerLeft(this.view, this.column);
    if (left == null || !Number.isFinite(left)) {
      this.dom.style.display = 'none';
      return;
    }
    this.dom.style.left = `${left}px`;
    // Span the full scroll height so the guide covers long docs.
    const h = Math.max(
      this.view.scrollDOM.scrollHeight,
      this.view.contentDOM.offsetHeight,
      this.view.scrollDOM.clientHeight,
    );
    this.dom.style.height = `${h}px`;
    this.dom.style.top = '0';
    this.dom.style.bottom = 'auto';
  }

  destroy() {
    this.dom.remove();
  }
}

/**
 * Column-ruler extension factory. Safe to mount always; hide via
 * `opts.enabled` or leave default (visible at column 80).
 */
export function columnRulerExtension(opts: ColumnRulerOptions = {}): Extension {
  const column = normalizeRulerColumn(opts.column ?? DEFAULT_RULER_COLUMN);
  const enabled = opts.enabled;
  return [
    columnRulerTheme,
    ViewPlugin.define(
      (view) => new ColumnRulerPlugin(view, { column, enabled }),
    ),
  ];
}
