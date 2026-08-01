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
 * CodeMirror 6 **inline debug** — end-of-line chips + line highlights from
 * last-run logs / errors / diagnostics.
 *
 * @module editor/inline-debug
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  gutter,
  GutterMarker,
} from '@codemirror/view';
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  type Extension,
  type Transaction,
  type Text,
} from '@codemirror/state';
import {
  type InlineDebugAnnotation,
  collapseAnnotationsByLine,
} from '../results/inline-debug';

export type { InlineDebugAnnotation };

/** Push annotations (or null to clear). */
export const setInlineDebugData = StateEffect.define<InlineDebugAnnotation[] | null>();

class InlineDebugWidget extends WidgetType {
  constructor(
    readonly level: InlineDebugAnnotation['level'],
    readonly text: string,
    readonly title: string,
  ) {
    super();
  }

  eq(other: InlineDebugWidget) {
    return (
      other.level === this.level &&
      other.text === this.text &&
      other.title === this.title
    );
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-inline-debug cm-inline-debug-${this.level}`;
    span.textContent = this.text;
    span.title = this.title;
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

class InlineDebugGutterMarker extends GutterMarker {
  constructor(
    readonly level: InlineDebugAnnotation['level'],
    readonly title: string,
  ) {
    super();
  }

  eq(other: InlineDebugGutterMarker) {
    return other.level === this.level && other.title === this.title;
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-inline-debug-gutter cm-inline-debug-gutter-${this.level}`;
    el.title = this.title;
    el.textContent =
      this.level === 'error' ? '!' : this.level === 'warning' ? '!' : '·';
    return el;
  }
}

interface InlineDebugState {
  anns: InlineDebugAnnotation[];
  decorations: DecorationSet;
}

const emptyState: InlineDebugState = {
  anns: [],
  decorations: Decoration.none,
};

function buildDecorations(anns: InlineDebugAnnotation[], doc: Text): DecorationSet {
  if (!anns.length) return Decoration.none;
  const collapsed = collapseAnnotationsByLine(anns);
  const builder = new RangeSetBuilder<import('@codemirror/view').Decoration>();
  for (const a of collapsed) {
    if (a.line < 1 || a.line > doc.lines) continue;
    const line = doc.line(a.line);
    const short =
      a.message.length > 48 ? `${a.message.slice(0, 46)}…` : a.message;
    const title = [
      `Line ${a.line}`,
      a.level,
      a.barIndex != null ? `bar ${a.barIndex}` : null,
      a.message,
    ]
      .filter(Boolean)
      .join(' · ');
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: `cm-inline-debug-line cm-inline-debug-line-${a.level}`,
      }),
    );
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new InlineDebugWidget(a.level, ` ${short}`, title),
        side: 1,
      }),
    );
  }
  return builder.finish();
}

export const inlineDebugStateField = StateField.define<InlineDebugState>({
  create() {
    return emptyState;
  },
  update(value: InlineDebugState, tr: Transaction): InlineDebugState {
    let anns = value.anns;
    let changed = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setInlineDebugData)) {
        anns = e.value ?? [];
        changed = true;
      }
    }
    if (!changed) return value;
    if (!anns.length) return emptyState;
    return {
      anns,
      decorations: buildDecorations(anns, tr.state.doc),
    };
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decorations),
});

function inlineDebugGutterMarkers(view: EditorView) {
  const st = view.state.field(inlineDebugStateField, false);
  const builder = new RangeSetBuilder<GutterMarker>();
  if (!st?.anns.length) return builder.finish();
  const collapsed = collapseAnnotationsByLine(st.anns);
  for (const a of collapsed) {
    if (a.line < 1 || a.line > view.state.doc.lines) continue;
    const line = view.state.doc.line(a.line);
    const title = `Line ${a.line} · ${a.level} · ${a.message}`;
    builder.add(line.from, line.from, new InlineDebugGutterMarker(a.level, title));
  }
  return builder.finish();
}

const inlineDebugGutterExt = gutter({
  class: 'cm-inline-debug-gutter-col',
  markers: (view) => inlineDebugGutterMarkers(view),
});

export const inlineDebugTheme = EditorView.baseTheme({
  '.cm-inline-debug': {
    fontSize: '10px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    marginLeft: '8px',
    padding: '0 5px',
    borderRadius: '2px',
    opacity: '0.92',
    verticalAlign: 'middle',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  '.cm-inline-debug-info': {
    color: '#8b8e9c',
    backgroundColor: 'rgba(139, 142, 156, 0.12)',
  },
  '.cm-inline-debug-debug': {
    color: '#939fff',
    backgroundColor: 'rgba(147, 159, 255, 0.12)',
  },
  '.cm-inline-debug-warning': {
    color: '#e8a03a',
    backgroundColor: 'rgba(232, 160, 58, 0.14)',
  },
  '.cm-inline-debug-error': {
    color: '#e85d4c',
    backgroundColor: 'rgba(232, 93, 76, 0.16)',
  },
  '.cm-inline-debug-line-error': {
    backgroundColor: 'rgba(232, 93, 76, 0.08)',
  },
  '.cm-inline-debug-line-warning': {
    backgroundColor: 'rgba(232, 160, 58, 0.07)',
  },
  '.cm-inline-debug-line-info': {
    backgroundColor: 'rgba(139, 142, 156, 0.05)',
  },
  '.cm-inline-debug-line-debug': {
    backgroundColor: 'rgba(147, 159, 255, 0.06)',
  },
  '.cm-inline-debug-gutter-col': {
    width: '14px',
    minWidth: '14px',
  },
  '.cm-inline-debug-gutter': {
    fontSize: '10px',
    lineHeight: '1',
    textAlign: 'center',
    width: '100%',
    opacity: '0.9',
  },
  '.cm-inline-debug-gutter-error': { color: '#e85d4c', fontWeight: '700' },
  '.cm-inline-debug-gutter-warning': { color: '#e8a03a' },
  '.cm-inline-debug-gutter-info': { color: '#8b8e9c' },
  '.cm-inline-debug-gutter-debug': { color: '#939fff' },
});

/** Mount always; drive with {@link applyInlineDebug}. */
export function inlineDebugExtension(): Extension {
  return [inlineDebugStateField, inlineDebugGutterExt, inlineDebugTheme];
}

/** Apply or clear inline debug annotations on a view. */
export function applyInlineDebug(
  view: EditorView,
  anns: InlineDebugAnnotation[] | null,
) {
  view.dispatch({
    effects: setInlineDebugData.of(anns && anns.length ? anns : null),
  });
}
