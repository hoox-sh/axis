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
 * Mounts language (`pineScript`), void theme, LSP completions/hover, search,
 * and Mod-Enter → {@link Props.onRun}. Exposes `getDoc` / `setDoc` via
 * optional `editorRef` for parent panels and the cross-window bridge.
 *
 * @module editor/PineEditor
 */

import { Component, createEffect, onMount, onCleanup } from 'solid-js';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching } from '@codemirror/language';
import { pineScript } from './pine-language';
import { voidEditorExtensions } from './cm-void';
import { pineLspExtensions } from './pine-lsp';
import {
  applyProfilerProfile,
  profilerGutterExtension,
} from './profiler-gutter';
import type { RunProfile } from '../results/profiler';
import {
  applyInlineDebug,
  inlineDebugExtension,
  type InlineDebugAnnotation,
} from './inline-debug';

interface Props {
  initialDoc?: string;
  onDocChange?: (doc: string) => void;
  /**
   * Cursor / selection head moved — 1-based line & column, plus absolute offset.
   * Fires on selection changes (arrows, click, typing).
   */
  onCursorChange?: (pos: { line: number; col: number; offset: number }) => void;
  onRun?: () => void;
  height?: string;
  editorRef?: { getDoc: () => string; setDoc?: (doc: string) => void };
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
}

/** Solid wrapper around a single CodeMirror EditorView instance. */
export const PineEditor: Component<Props> = (props) => {
  let containerRef!: HTMLDivElement;
  let view: EditorView | undefined;

  const getDoc = () => view?.state.doc.toString() ?? '';

  const setDoc = (doc: string) => {
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
      });
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

  onMount(() => {
    const runKeymap = keymap.of([{
      key: 'Mod-Enter',
      run: () => { props.onRun?.(); return true; },
    }]);

    const state = EditorState.create({
      doc: props.initialDoc ?? '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        bracketMatching(),
        highlightSelectionMatches(),
        // Pine LSP-lite: typing completion + hover docs (from pyne builtin metadata)
        ...pineLspExtensions(),
        // Profiler gutter: always mounted; driven by setProfilerData effects
        profilerGutterExtension(),
        // Inline debug chips / line highlights (driven by applyInlineDebug)
        inlineDebugExtension(),
        runKeymap,
        keymap.of([...defaultKeymap, indentWithTab, ...searchKeymap]),
        pineScript,
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
    if (props.editorRef) {
      props.editorRef.getDoc = getDoc;
      props.editorRef.setDoc = setDoc;
    }
    // Initial measure so wrapped lines + full-height host size correctly
    queueMicrotask(() => {
      view?.requestMeasure();
      syncProfiler();
      syncInlineDebug();
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

    // Re-measure when the float/dock shell resizes (portal host changes geometry)
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        view?.requestMeasure();
      });
      ro.observe(containerRef);
    }
    onCleanup(() => {
      ro?.disconnect();
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

  return (
    <div
      ref={containerRef!}
      class="axis-pine-editor overflow-hidden bg-bg-panel"
      data-testid="axis-pine-editor"
      style={
        props.height
          ? { height: props.height, position: 'relative' }
          : undefined
      }
    />
  );
};
