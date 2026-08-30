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
 * Inline **color chips** in the Pine CodeMirror editor — square swatches
 * (line-height × line-height) before each color literal / `color.*` form.
 *
 * Uses {@link scanPineColors} for hex, named, `color.rgb`, and `color.new`.
 * Click opens a native color picker and selects the range; picking rewrites
 * the source in the original form (hex / named / color.rgb / color.new).
 *
 * @module editor/color-chips
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  formatPickedChipColor,
  scanPineColors,
  toCssRgba,
  toHex6,
  rgbaFromChannels,
  transpToAlpha,
  type PineColorHit,
} from './pine-colors';

/** Widget: square color preview sized to the editor line height. */
class ColorChipWidget extends WidgetType {
  constructor(
    readonly css: string,
    readonly title: string,
    readonly hex6: string,
    readonly hit: PineColorHit,
  ) {
    super();
  }

  eq(other: ColorChipWidget) {
    return (
      other.css === this.css &&
      other.title === this.title &&
      other.hex6 === this.hex6 &&
      other.hit.from === this.hit.from &&
      other.hit.to === this.hit.to &&
      other.hit.kind === this.hit.kind &&
      other.hit.transp === this.hit.transp
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-pine-color-chip';
    wrap.title = `${this.title} · click to pick`;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', `Pick color ${this.title}`);
    wrap.tabIndex = -1;

    const lh = Math.max(10, Math.round(view.defaultLineHeight || 16));
    wrap.style.width = `${lh}px`;
    wrap.style.height = `${lh}px`;

    const fill = document.createElement('span');
    fill.className = 'cm-pine-color-chip-fill';
    fill.style.background = this.css;
    fill.setAttribute('aria-hidden', 'true');
    wrap.appendChild(fill);

    const from = this.hit.from;
    const to = this.hit.to;
    const hit = this.hit;

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'cm-pine-color-chip-picker';
    picker.value = this.hex6.toLowerCase();
    picker.setAttribute('aria-label', `Pick color ${this.title}`);
    picker.addEventListener('click', (e) => {
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true,
      });
    });
    // Apply on close (`change`), not `input` — live input remounts the widget
    // and would dismiss the native picker.
    picker.addEventListener('change', () => {
      const replacement = formatPickedChipColor(hit, picker.value);
      if (!replacement) return;
      const current = view.state.doc.sliceString(from, to);
      if (current !== hit.text && current !== replacement) return;
      view.dispatch({
        changes: { from, to, insert: replacement },
        selection: { anchor: from, head: from + replacement.length },
        scrollIntoView: true,
      });
    });
    wrap.appendChild(picker);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }

  /** Chips are atomic UI; don’t expand selection into the widget. */
  get estimatedHeight() {
    return -1;
  }
}

/**
 * Build widget decorations for every color hit in `doc`.
 * Pure helper for tests — plugin uses the same logic.
 */
export function buildColorChipDecorations(doc: string): DecorationSet {
  const hits = scanPineColors(doc || '');
  if (!hits.length) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  // Decoration must be added in document order
  const ordered = hits.slice().sort((a, b) => a.from - b.from || a.to - b.to);
  for (const hit of ordered) {
    if (hit.from < 0 || hit.to <= hit.from) continue;
    const dec = decorationForHit(hit);
    if (dec) builder.add(hit.from, hit.from, dec);
  }
  return builder.finish();
}

function decorationForHit(hit: PineColorHit) {
  const rgba = rgbaFromChannels(hit.r, hit.g, hit.b, transpToAlpha(hit.transp));
  const css = toCssRgba(rgba);
  const title =
    hit.transp > 0
      ? `${hit.text} · transp ${hit.transp}`
      : hit.text;
  return Decoration.widget({
    widget: new ColorChipWidget(css, title, toHex6(rgba), hit),
    side: -1,
  });
}

/**
 * ViewPlugin: rebuild chips when the document changes.
 * Full-doc scan is fine for typical Pine script sizes.
 */
const colorChipsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildColorChipDecorations(view.state.doc.toString());
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        // Rebuild on any doc change; viewport-only changes keep prior set
        // (widgets are absolute offsets — only doc changes invalidate).
        if (update.docChanged) {
          this.decorations = buildColorChipDecorations(
            update.state.doc.toString(),
          );
        }
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

/** Theme: square chip with checkerboard underlay for translucent colors. */
export const colorChipsTheme = EditorView.baseTheme({
  '.cm-pine-color-chip': {
    position: 'relative',
    display: 'inline-block',
    verticalAlign: 'text-bottom',
    marginRight: '0.3em',
    marginLeft: '0.05em',
    boxSizing: 'border-box',
    borderRadius: '2px',
    border: '1px solid color-mix(in srgb, var(--color-border, #444) 90%, #000)',
    /* Checkerboard so alpha is visible */
    backgroundColor: '#fff',
    backgroundImage:
      'linear-gradient(45deg, #c8c8c8 25%, transparent 25%),' +
      'linear-gradient(-45deg, #c8c8c8 25%, transparent 25%),' +
      'linear-gradient(45deg, transparent 75%, #c8c8c8 75%),' +
      'linear-gradient(-45deg, transparent 75%, #c8c8c8 75%)',
    backgroundSize: '6px 6px',
    backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
    cursor: 'pointer',
    overflow: 'hidden',
    flexShrink: '0',
    /* Fallback when JS line-height not applied yet */
    width: '1lh',
    height: '1lh',
    minWidth: '10px',
    minHeight: '10px',
  },
  '.cm-pine-color-chip-fill': {
    display: 'block',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  '.cm-pine-color-chip-picker': {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    padding: '0',
    margin: '0',
    border: '0',
    opacity: '0',
    cursor: 'pointer',
  },
  '.cm-pine-color-chip:hover': {
    outline: '1px solid var(--color-accent, #939fff)',
    outlineOffset: '1px',
  },
});

/** Full extension set: plugin + theme. */
export function colorChipsExtension(): Extension {
  return [colorChipsPlugin, colorChipsTheme];
}
