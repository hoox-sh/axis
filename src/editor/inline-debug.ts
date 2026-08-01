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
 * CodeMirror 6 **inline debug** — end-of-line chips, line highlights, pin
 * gutter, and flash-on-jump from last-run logs / errors / diagnostics.
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
  isPinableAnnotation,
} from '../results/inline-debug';

export type { InlineDebugAnnotation };
export { isPinableAnnotation };

/** Push annotations (or null to clear). */
export const setInlineDebugData = StateEffect.define<InlineDebugAnnotation[] | null>();

/**
 * Pin-able annotations for the dedicated pin gutter (driven by
 * `store.debugPinsEnabled`). Independent of inline debug chips.
 */
export const setDebugPinData = StateEffect.define<InlineDebugAnnotation[] | null>();

/** Flash a 1-based source line (or null to clear). */
export const flashDebugPinLineEffect = StateEffect.define<number | null>();

/**
 * Optional handler for chip / pin-gutter clicks (jump to bar on chart).
 * Wired by editor shell — avoids hard dependency on chart/store here.
 */
export type DebugChipClickDetail = {
  line: number;
  barIndex?: number | null;
  time?: number | null;
  message?: string;
  level?: InlineDebugAnnotation['level'];
};

let debugChipClickHandler: ((detail: DebugChipClickDetail) => void) | null = null;

/** Last mounted editor view — used by {@link flashDebugPinLine} without a view arg. */
let registeredDebugEditorView: EditorView | null = null;

/** Flash clear timer (module-level so re-flash resets cleanly). */
let flashClearTimer: ReturnType<typeof setTimeout> | null = null;

const FLASH_MS = 700;

/** Register (or clear with null) the chart jump handler for pin-able chips/gutter. */
export function setDebugChipClickHandler(
  handler: ((detail: DebugChipClickDetail) => void) | null,
) {
  debugChipClickHandler = handler;
}

/** Remember the active Pine editor view for flash-on-jump from panels. */
export function registerDebugEditorView(view: EditorView | null) {
  registeredDebugEditorView = view;
}

/** Active registered editor view (if any). */
export function getRegisteredDebugEditorView(): EditorView | null {
  return registeredDebugEditorView;
}

function firePinJump(detail: DebugChipClickDetail) {
  debugChipClickHandler?.(detail);
  // Always flash the source line when jumping from editor chrome.
  flashDebugPinLine(detail.line);
}

class InlineDebugWidget extends WidgetType {
  constructor(
    readonly level: InlineDebugAnnotation['level'],
    readonly text: string,
    readonly title: string,
    readonly line: number,
    readonly barIndex?: number | null,
    readonly time?: number | null,
    readonly message?: string,
  ) {
    super();
  }

  get pinable() {
    return isPinableAnnotation(this);
  }

  eq(other: InlineDebugWidget) {
    return (
      other.level === this.level &&
      other.text === this.text &&
      other.title === this.title &&
      other.line === this.line &&
      other.barIndex === this.barIndex &&
      other.time === this.time &&
      other.message === this.message
    );
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-inline-debug cm-inline-debug-${this.level}${
      this.pinable ? ' cm-inline-debug-pinable' : ''
    }`;
    span.textContent = this.text;
    span.title = this.pinable
      ? `${this.title} · click to pin bar on chart`
      : this.title;
    if (this.pinable) {
      span.setAttribute('role', 'button');
      span.tabIndex = 0;
      if (this.barIndex != null) span.dataset.barIndex = String(this.barIndex);
      if (this.time != null) span.dataset.time = String(this.time);
      span.dataset.line = String(this.line);
      const fire = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        firePinJump({
          line: this.line,
          barIndex: this.barIndex,
          time: this.time,
          message: this.message,
          level: this.level,
        });
      };
      span.addEventListener('mousedown', fire);
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') fire(e);
      });
    }
    return span;
  }

  /** Let pin-able chips receive click; others stay decoration-only. */
  ignoreEvent(event: Event) {
    if (!this.pinable) return true;
    const t = event.type;
    return t !== 'mousedown' && t !== 'click' && t !== 'keydown';
  }
}

/** Level marker for inline-debug gutter (non-pin lines / severity). */
class InlineDebugGutterMarker extends GutterMarker {
  constructor(
    readonly level: InlineDebugAnnotation['level'],
    readonly title: string,
    readonly line: number,
    readonly barIndex?: number | null,
    readonly time?: number | null,
    readonly message?: string,
  ) {
    super();
  }

  get pinable() {
    return isPinableAnnotation(this);
  }

  eq(other: InlineDebugGutterMarker) {
    return (
      other.level === this.level &&
      other.title === this.title &&
      other.line === this.line &&
      other.barIndex === this.barIndex &&
      other.time === this.time &&
      other.message === this.message
    );
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-inline-debug-gutter cm-inline-debug-gutter-${this.level}${
      this.pinable ? ' cm-inline-debug-gutter-pinable' : ''
    }`;
    el.title = this.pinable
      ? `${this.title} · click to jump to bar`
      : this.title;
    el.textContent =
      this.level === 'error' ? '!' : this.level === 'warning' ? '!' : '·';
    if (this.pinable) {
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.dataset.line = String(this.line);
      if (this.barIndex != null) el.dataset.barIndex = String(this.barIndex);
      if (this.time != null) el.dataset.time = String(this.time);
      const fire = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        firePinJump({
          line: this.line,
          barIndex: this.barIndex,
          time: this.time,
          message: this.message,
          level: this.level,
        });
      };
      el.addEventListener('mousedown', fire);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') fire(e);
      });
    }
    return el;
  }
}

/** Dedicated pin gutter marker (📍) — only for lines with bar_index/time. */
class DebugPinGutterMarker extends GutterMarker {
  constructor(
    readonly line: number,
    readonly level: InlineDebugAnnotation['level'],
    readonly title: string,
    readonly barIndex?: number | null,
    readonly time?: number | null,
    readonly message?: string,
  ) {
    super();
  }

  eq(other: DebugPinGutterMarker) {
    return (
      other.line === this.line &&
      other.level === this.level &&
      other.title === this.title &&
      other.barIndex === this.barIndex &&
      other.time === this.time &&
      other.message === this.message
    );
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-debug-pin-gutter cm-debug-pin-gutter-${this.level}`;
    el.title = `${this.title} · click to jump to bar`;
    el.textContent = '📍';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.dataset.line = String(this.line);
    if (this.barIndex != null) el.dataset.barIndex = String(this.barIndex);
    if (this.time != null) el.dataset.time = String(this.time);
    const fire = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      firePinJump({
        line: this.line,
        barIndex: this.barIndex,
        time: this.time,
        message: this.message,
        level: this.level,
      });
    };
    el.addEventListener('mousedown', fire);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') fire(e);
    });
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
      a.time != null ? `t=${a.time}` : null,
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
        widget: new InlineDebugWidget(
          a.level,
          ` ${short}`,
          title,
          a.line,
          a.barIndex,
          a.time,
          a.message,
        ),
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

interface DebugPinState {
  anns: InlineDebugAnnotation[];
}

const emptyPinState: DebugPinState = { anns: [] };

export const debugPinStateField = StateField.define<DebugPinState>({
  create() {
    return emptyPinState;
  },
  update(value: DebugPinState, tr: Transaction): DebugPinState {
    let anns = value.anns;
    let changed = false;
    for (const e of tr.effects) {
      if (e.is(setDebugPinData)) {
        anns = e.value ?? [];
        changed = true;
      }
    }
    if (!changed) return value;
    return anns.length ? { anns } : emptyPinState;
  },
  provide: (f) =>
    EditorView.editorAttributes.from(f, (s) =>
      s.anns.some(isPinableAnnotation) ? { class: 'cm-debug-pins-active' } : {},
    ),
});

interface FlashState {
  line: number | null;
  decorations: DecorationSet;
}

const emptyFlash: FlashState = { line: null, decorations: Decoration.none };

function buildFlashDecorations(lineNo: number | null, doc: Text): DecorationSet {
  if (lineNo == null || lineNo < 1 || lineNo > doc.lines) return Decoration.none;
  const line = doc.line(lineNo);
  return Decoration.set([
    Decoration.line({ class: 'cm-debug-pin-flash' }).range(line.from),
  ]);
}

export const debugPinFlashField = StateField.define<FlashState>({
  create() {
    return emptyFlash;
  },
  update(value: FlashState, tr: Transaction): FlashState {
    let line = value.line;
    let fromEffect = false;
    for (const e of tr.effects) {
      if (e.is(flashDebugPinLineEffect)) {
        line = e.value;
        fromEffect = true;
      }
    }
    if (fromEffect) {
      return {
        line,
        decorations: buildFlashDecorations(line, tr.state.doc),
      };
    }
    if (tr.docChanged && line != null) {
      return {
        line,
        decorations: buildFlashDecorations(line, tr.state.doc),
      };
    }
    return value;
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
      new InlineDebugGutterMarker(
        a.level,
        title,
        a.line,
        a.barIndex,
        a.time,
        a.message,
      ),
    );
  }
  return builder.finish();
}

function debugPinGutterMarkers(view: EditorView) {
  const st = view.state.field(debugPinStateField, false);
  const builder = new RangeSetBuilder<GutterMarker>();
  if (!st?.anns.length) return builder.finish();
  const collapsed = collapseAnnotationsByLine(st.anns).filter(isPinableAnnotation);
  for (const a of collapsed) {
    if (a.line < 1 || a.line > view.state.doc.lines) continue;
    const line = view.state.doc.line(a.line);
    const title = [
      `Pin L${a.line}`,
      a.barIndex != null ? `bar ${a.barIndex}` : null,
      a.time != null ? `t=${a.time}` : null,
      a.message,
    ]
      .filter(Boolean)
      .join(' · ');
    builder.add(
      line.from,
      line.from,
      new DebugPinGutterMarker(
        a.line,
        a.level,
        title,
        a.barIndex,
        a.time,
        a.message,
      ),
    );
  }
  return builder.finish();
}

const inlineDebugGutterExt = gutter({
  class: 'cm-inline-debug-gutter-col',
  markers: (view) => inlineDebugGutterMarkers(view),
});

const debugPinGutterExt = gutter({
  class: 'cm-debug-pin-gutter-col',
  markers: (view) => debugPinGutterMarkers(view),
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
  '.cm-inline-debug-pinable': {
    pointerEvents: 'auto',
    cursor: 'pointer',
    textDecoration: 'underline dotted',
    textUnderlineOffset: '2px',
  },
  '.cm-inline-debug-pinable:hover': {
    opacity: '1',
    filter: 'brightness(1.15)',
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
  '.cm-inline-debug-gutter-pinable': {
    cursor: 'pointer',
  },
  '.cm-inline-debug-gutter-pinable:hover': {
    filter: 'brightness(1.25)',
  },
  '.cm-inline-debug-gutter-error': { color: '#e85d4c', fontWeight: '700' },
  '.cm-inline-debug-gutter-warning': { color: '#e8a03a' },
  '.cm-inline-debug-gutter-info': { color: '#8b8e9c' },
  '.cm-inline-debug-gutter-debug': { color: '#939fff' },
  /* Dedicated pin gutter — hidden until pin data is applied */
  '.cm-debug-pin-gutter-col': {
    display: 'none',
    width: '16px',
    minWidth: '16px',
  },
  '&.cm-debug-pins-active .cm-debug-pin-gutter-col': {
    display: 'flex',
  },
  '.cm-debug-pin-gutter': {
    fontSize: '10px',
    lineHeight: '1',
    textAlign: 'center',
    width: '100%',
    cursor: 'pointer',
    opacity: '0.95',
    userSelect: 'none',
  },
  '.cm-debug-pin-gutter:hover': {
    filter: 'brightness(1.2)',
    opacity: '1',
  },
  '.cm-debug-pin-gutter-error': { filter: 'hue-rotate(-20deg)' },
  '.cm-debug-pin-gutter-warning': { filter: 'hue-rotate(20deg)' },
  /* Flash highlight on jump (also defined in index.css for keyframes) */
  '.cm-debug-pin-flash': {
    animation: 'cm-debug-pin-flash-kf 0.7s ease-out',
    backgroundColor: 'rgba(147, 159, 255, 0.28)',
  },
});

/** Mount always; drive with {@link applyInlineDebug} / {@link applyDebugPins}. */
export function inlineDebugExtension(): Extension {
  return [
    inlineDebugStateField,
    debugPinStateField,
    debugPinFlashField,
    inlineDebugGutterExt,
    debugPinGutterExt,
    inlineDebugTheme,
  ];
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

/**
 * Apply or clear pin gutter markers (lines with bar_index / time).
 * Independent of {@link applyInlineDebug}.
 */
export function applyDebugPins(
  view: EditorView,
  anns: InlineDebugAnnotation[] | null,
) {
  const pinable =
    anns && anns.length ? anns.filter(isPinableAnnotation) : null;
  view.dispatch({
    effects: setDebugPinData.of(pinable && pinable.length ? pinable : null),
  });
}

/**
 * Briefly highlight a 1-based source line (`cm-debug-pin-flash`).
 * Uses the given view, or the last {@link registerDebugEditorView} mount.
 */
export function flashDebugPinLine(line: number, view?: EditorView | null) {
  const v = view ?? registeredDebugEditorView;
  if (!v || !Number.isFinite(line) || line < 1) return;
  const lineNo = Math.trunc(line);
  if (lineNo > v.state.doc.lines) return;
  // Scroll the line into view + flash
  try {
    const pos = v.state.doc.line(lineNo).from;
    v.dispatch({
      effects: [
        flashDebugPinLineEffect.of(lineNo),
        EditorView.scrollIntoView(pos, { y: 'center' }),
      ],
    });
  } catch {
    v.dispatch({ effects: flashDebugPinLineEffect.of(lineNo) });
  }
  if (flashClearTimer != null) clearTimeout(flashClearTimer);
  flashClearTimer = setTimeout(() => {
    flashClearTimer = null;
    // Only clear if this view is still alive and still flashing this line
    if (v.dom.isConnected) {
      const cur = v.state.field(debugPinFlashField, false);
      if (cur?.line === lineNo) {
        v.dispatch({ effects: flashDebugPinLineEffect.of(null) });
      }
    }
  }, FLASH_MS);
}
