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
 * Imperative **CodeMirror 6** host for Pine Script.
 *
 * Mounts language (`pyneScript`), void theme, LSP completions/hover, search,
 * and Mod-Enter → {@link Props.onRun}. Exposes `getDoc` / `setDoc` via
 * optional `editorRef` for parent panels and the cross-window bridge.
 *
 * @module editor/PyneEditor
 */

import { Component, createEffect, onMount, onCleanup } from 'solid-js';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching } from '@codemirror/language';
import { pyneScript } from './pyne-language';
import { voidEditorExtensions } from './cm-void';
import { pyneLspExtensions } from './pyne-lsp';
import {
  applyProfilerProfile,
  profilerGutterExtension,
} from './profiler-gutter';
import type { RunProfile } from '../results/profiler';
import {
  applyInlineDebug,
  applyDebugPins,
  inlineDebugExtension,
  registerDebugEditorView,
  type InlineDebugAnnotation,
} from './inline-debug';
import {
  applyDiagnostics,
  diagnosticsExtension,
  jumpToDiagnostic,
  type EditorDiagnostic,
} from './diagnostics';
import {
  columnRulerExtension,
  refreshColumnRuler,
} from './column-ruler';
import { formatPineSource } from './pine-format';

/** Cursor position reported by {@link PyneEditorRef.getCursor}. */
export type PyneEditorCursor = { line: number; col: number; offset: number };

/**
 * Imperative handle for parent panels (tabbed editor, bridge, problems jump).
 * Methods beyond `getDoc` are assigned on mount by {@link PyneEditor}.
 */
export type PyneEditorRef = {
  getDoc: () => string;
  setDoc?: (doc: string) => void;
  /** Move selection to 1-based line and scroll it into view. */
  scrollToLine?: (line: number) => void;
  /** Alias of {@link PyneEditorRef.scrollToLine}. */
  focusLine?: (line: number) => void;
  /** Current selection head as 1-based line / column + absolute offset. */
  getCursor?: () => PyneEditorCursor;
  /** Select + scroll to a diagnostic range (underlines / badge jump). */
  jumpToDiagnostic?: (diag: EditorDiagnostic) => boolean;
  /** Select absolute [from, to) range and scroll into view (color tools, etc.). */
  selectRange?: (from: number, to: number) => boolean;
  /** Format document (indent / whitespace). Returns true when changed. */
  formatDoc?: () => boolean;
  /** Load external library content into active tab (set by TabbedEditor). */
  loadLibraryDoc?: (doc: string, name?: string, libraryId?: string) => void;
  /**
   * Open one or more library scripts as editor tabs (set by TabbedEditor).
   * Used by multi-file drag-drop import.
   */
  loadLibraryDocs?: (
    docs: Array<{ content: string; name?: string; libraryId?: string }>,
  ) => void;
  /**
   * True when the active tab has unsaved edits or is not bound to the library.
   * Set by {@link TabbedEditor}.
   */
  isUnsaved?: () => boolean;
  /**
   * Persist the active tab to the script library when unsaved, then return
   * the current document. Used by Run paths so scripts are saved before run.
   * `ok: false` when empty or library write failed (caller should not run).
   */
  ensureSavedForRun?: () => Promise<{ ok: boolean; doc: string }>;
};

interface Props {
  initialDoc?: string;
  onDocChange?: (doc: string) => void;
  /**
   * Cursor / selection head moved — 1-based line & column, plus absolute offset.
   * Fires on selection changes (arrows, click, typing).
   */
  onCursorChange?: (pos: PyneEditorCursor) => void;
  onRun?: () => void;
  height?: string;
  editorRef?: PyneEditorRef;
  /**
   * Optional run profile for Profiler-mode gutter (% / ms per line).
   * Parent wires store → this prop; cleared with `null`.
   */
  profilerProfile?: RunProfile | null;
  /**
   * When `false`, clears profiler markers even if `profilerProfile` is set.
   * Default: enabled whenever a profile is provided (extension always mounted).
   */
  profilerEnabled?: boolean;
  /** Inline debug annotations (logs/errors on source lines). */
  inlineDebug?: InlineDebugAnnotation[] | null;
  /** When false, clears inline debug even if annotations provided. */
  inlineDebugEnabled?: boolean;
  /**
   * Pin gutter annotations (lines with bar_index/time). Independent of
   * {@link inlineDebugEnabled}; parent gates on `store.debugPinsEnabled`.
   */
  debugPins?: InlineDebugAnnotation[] | null;
  /** When false, clears pin gutter even if `debugPins` provided. */
  debugPinsEnabled?: boolean;
  /** Optional Alt-P handler (toggle chart debug pins). */
  onToggleDebugPins?: () => void;
  /**
   * Run-error / diagnostic underlines + gutter (always shown when provided).
   * Parent typically computes via {@link diagnosticsFromLastRun}.
   */
  diagnostics?: EditorDiagnostic[] | null;
  /**
   * 80-column recommended line-length ruler. Extension always mounted;
   * when false, the guide is hidden. Default true.
   */
  rulerEnabled?: boolean;
  /**
   * Soft line wrap. Reconfigured via Compartment when toggled.
   * Default true (matches previous always-on wrap).
   */
  wrapEnabled?: boolean;
}

/** Soft-wrap extension set for the wrap compartment (empty = no wrap). */
export function lineWrapExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : [];
}

/** Solid wrapper around a single CodeMirror EditorView instance. */
export const PyneEditor: Component<Props> = (props) => {
  let containerRef!: HTMLDivElement;
  let view: EditorView | undefined;
  /** Compartment so wrap can toggle without rebuilding the whole state. */
  const wrapCompartment = new Compartment();

  const getDoc = () => view?.state.doc.toString() ?? '';

  /** Replace buffer; no-op when content is unchanged (avoids dirty thrash / cursor jump). */
  const setDoc = (doc: string) => {
    if (!view) return;
    const next = typeof doc === 'string' ? doc : String(doc ?? '');
    if (view.state.doc.toString() === next) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
  };

  /** 1-based line → selection + scrollIntoView (clamped to document). */
  const scrollToLine = (line: number) => {
    if (!view) return;
    const doc = view.state.doc;
    if (doc.lines < 1) return;
    const n = Number(line);
    if (!Number.isFinite(n)) return;
    const target = Math.max(1, Math.min(Math.trunc(n), doc.lines));
    const lineObj = doc.line(target);
    view.dispatch({
      selection: EditorSelection.cursor(lineObj.from),
      effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
    });
    view.focus();
  };

  const getCursor = (): PyneEditorCursor => {
    if (!view) return { line: 1, col: 1, offset: 0 };
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return {
      line: line.number,
      col: head - line.from + 1,
      offset: head,
    };
  };

  /** Select [from, to) in document offsets and center it. */
  const selectRange = (from: number, to: number): boolean => {
    if (!view) return false;
    const len = view.state.doc.length;
    const a = Math.max(0, Math.min(Math.trunc(from), len));
    const b = Math.max(a, Math.min(Math.trunc(to), len));
    view.dispatch({
      selection: EditorSelection.range(a, b),
      effects: EditorView.scrollIntoView(a, { y: 'center' }),
    });
    view.focus();
    return true;
  };

  /**
   * Format full document; preserves cursor position by document-offset ratio
   * when the buffer length changes (safer than clamping a raw offset).
   */
  const formatDoc = (): boolean => {
    if (!view) return false;
    try {
      const prev = view.state.doc.toString();
      const next = formatPineSource(prev);
      if (next === prev) return false;
      const head = view.state.selection.main.head;
      const mapped =
        prev.length > 0
          ? Math.min(Math.round((head / prev.length) * next.length), next.length)
          : 0;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: EditorSelection.cursor(mapped),
      });
      view.focus();
      return true;
    } catch {
      return false;
    }
  };

  const syncProfiler = () => {
    if (!view) return;
    const enabled = props.profilerEnabled !== false;
    const profile = enabled ? (props.profilerProfile ?? null) : null;
    applyProfilerProfile(view, profile);
  };

  const syncInlineDebug = () => {
    if (!view) return;
    const enabled = props.inlineDebugEnabled !== false;
    const anns = enabled ? (props.inlineDebug ?? null) : null;
    applyInlineDebug(view, anns && anns.length ? anns : null);
  };

  const syncDebugPins = () => {
    if (!view) return;
    const enabled = props.debugPinsEnabled === true;
    const anns = enabled ? (props.debugPins ?? null) : null;
    applyDebugPins(view, anns && anns.length ? anns : null);
  };

  const syncDiagnostics = () => {
    if (!view) return;
    const diags = props.diagnostics ?? null;
    applyDiagnostics(view, diags && diags.length ? diags : null);
  };

  const syncRuler = () => {
    if (!view) return;
    // Force plugin re-read of enabled() after Solid prop changes.
    refreshColumnRuler(view);
  };

  const syncWrap = () => {
    if (!view) return;
    const enabled = props.wrapEnabled !== false;
    view.dispatch({
      effects: wrapCompartment.reconfigure(lineWrapExtension(enabled)),
    });
    view.requestMeasure();
  };

  onMount(() => {
    const runKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          props.onRun?.();
          return true;
        },
      },
      {
        key: 'Shift-Alt-f',
        run: () => {
          formatDoc();
          return true;
        },
      },
      {
        key: 'Mod-Shift-f',
        run: () => {
          formatDoc();
          return true;
        },
      },
      {
        key: 'Alt-p',
        run: () => {
          if (!props.onToggleDebugPins) return false;
          props.onToggleDebugPins();
          return true;
        },
      },
    ]);

    const wrapOn = props.wrapEnabled !== false;

    const state = EditorState.create({
      doc: props.initialDoc ?? '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        wrapCompartment.of(lineWrapExtension(wrapOn)),
        bracketMatching(),
        highlightSelectionMatches(),
        // Pine LSP-lite: typing completion + hover docs (from pyne builtin metadata)
        ...pyneLspExtensions(),
        // Profiler gutter: always mounted; driven by setProfilerData effects
        profilerGutterExtension(),
        // Inline debug chips / pin gutter / flash (driven by apply*)
        inlineDebugExtension(),
        // Run-error underlines + gutter + hover (driven by applyDiagnostics)
        diagnosticsExtension(),
        // 80-col recommended line-length guide (toggle via rulerEnabled prop)
        columnRulerExtension({
          enabled: () => props.rulerEnabled !== false,
        }),
        runKeymap,
        keymap.of([...defaultKeymap, indentWithTab, ...searchKeymap]),
        pyneScript,
        ...voidEditorExtensions,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) props.onDocChange?.(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            props.onCursorChange?.({
              line: line.number,
              col: head - line.from + 1,
              offset: head,
            });
          }
        }),
      ],
    });

    view = new EditorView({ state, parent: containerRef });
    registerDebugEditorView(view);
    if (props.editorRef) {
      props.editorRef.getDoc = getDoc;
      props.editorRef.setDoc = setDoc;
      props.editorRef.scrollToLine = scrollToLine;
      props.editorRef.focusLine = scrollToLine;
      props.editorRef.getCursor = getCursor;
      props.editorRef.selectRange = selectRange;
      props.editorRef.formatDoc = formatDoc;
      props.editorRef.jumpToDiagnostic = (diag: EditorDiagnostic) => {
        if (!view) return false;
        return jumpToDiagnostic(view, diag);
      };
    }
    // Initial measure so wrapped lines + full-height host size correctly
    queueMicrotask(() => {
      view?.requestMeasure();
      syncProfiler();
      syncInlineDebug();
      syncDebugPins();
      syncDiagnostics();
      syncRuler();
      // Seed cursor stats (line 1, col 1) for the status strip
      if (view && props.onCursorChange) {
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        props.onCursorChange({
          line: line.number,
          col: head - line.from + 1,
          offset: head,
        });
      }
    });

    // Command palette → Jump to Line (`axis-editor-goto-line` detail.line)
    const onGotoLine = (ev: Event) => {
      const detail = (ev as CustomEvent<{ line?: number }>).detail;
      const line = detail?.line;
      if (line == null) return;
      scrollToLine(line);
    };
    window.addEventListener('axis-editor-goto-line', onGotoLine);

    // Re-measure when the float/dock shell resizes (portal host changes geometry)
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        view?.requestMeasure();
      });
      ro.observe(containerRef);
    }
    onCleanup(() => {
      window.removeEventListener('axis-editor-goto-line', onGotoLine);
      ro?.disconnect();
      if (view) registerDebugEditorView(null);
      view?.destroy();
      view = undefined;
    });
  });

  createEffect(() => {
    // Track profiler props; push into CM when they change after mount.
    void props.profilerProfile;
    void props.profilerEnabled;
    syncProfiler();
  });

  createEffect(() => {
    void props.inlineDebug;
    void props.inlineDebugEnabled;
    syncInlineDebug();
  });

  createEffect(() => {
    void props.debugPins;
    void props.debugPinsEnabled;
    syncDebugPins();
  });

  createEffect(() => {
    void props.diagnostics;
    syncDiagnostics();
  });

  createEffect(() => {
    void props.rulerEnabled;
    syncRuler();
  });

  createEffect(() => {
    void props.wrapEnabled;
    syncWrap();
  });

  return (
    <div
      ref={containerRef!}
      class="axis-pyne-editor overflow-hidden bg-bg-panel"
      data-testid="axis-pyne-editor"
      style={
        props.height
          ? { height: props.height, position: 'relative' }
          : undefined
      }
    />
  );
};
