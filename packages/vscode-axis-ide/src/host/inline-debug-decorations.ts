// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-of-line inline debug chips on visible Pine editors.
 * VS Code shim — excluded from the pure-host coverage gate.
 * Subscribes like {@link attachProfiler} in `src/run/profiler-store.ts`.
 */

import {
  MarkdownString,
  Range,
  ThemeColor,
  window,
  workspace,
  type DecorationOptions,
  type ExtensionContext,
  type TextEditor,
  type TextEditorDecorationType,
} from 'vscode';
import {
  collectInlineDebug,
  redactInlineDebugText,
  truncateInlineDebugChip,
  type InlineDebugAnnotation,
  type InlineDebugLevel,
} from './inline-debug';
import { PINE_LANGUAGE_ID } from './open-chart';

/** `contributes.languages[0].id` in hoox-sh.pyne (`pinescript`). */
const PINE_LANGUAGE_IDS: readonly string[] = [PINE_LANGUAGE_ID];

const LEVEL_THEME: Record<InlineDebugLevel, string> = {
  error: 'errorForeground',
  warning: 'editorWarning.foreground',
  info: 'descriptionForeground',
  debug: 'descriptionForeground',
};

const LEVELS: readonly InlineDebugLevel[] = ['error', 'warning', 'info', 'debug'];

type ResultsLike = {
  subscribe?: (listener: (snapshot: unknown) => void) => unknown;
  getLastRun?: () => unknown;
};

function isPine(languageId: unknown): boolean {
  return typeof languageId === 'string' && PINE_LANGUAGE_IDS.includes(languageId);
}

function endOfLine(editor: TextEditor, lineNumber: number): Range | null {
  const doc = editor.document;
  if (!doc || lineNumber < 0 || lineNumber >= doc.lineCount) return null;
  const end = doc.lineAt(lineNumber).range.end;
  return new Range(end.line, end.character, end.line, end.character);
}

function watchResults(store: unknown, onRecord: (record: unknown) => void): () => void {
  const noop = (): void => {};
  try {
    if (!store || typeof store !== 'object' || Array.isArray(store)) return noop;
    const results = store as ResultsLike;
    try {
      if (typeof results.getLastRun === 'function') onRecord(results.getLastRun());
      else onRecord(undefined);
    } catch {
      onRecord(undefined);
    }
    if (typeof results.subscribe !== 'function') return noop;
    let unsubscribe: unknown;
    try {
      unsubscribe = results.subscribe((snapshot) => {
        try {
          const last =
            snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
              ? (snapshot as { lastRun?: unknown }).lastRun
              : undefined;
          onRecord(last);
        } catch {
          // hostile snapshot — keep the previous chips
        }
      });
    } catch {
      return noop;
    }
    if (typeof unsubscribe !== 'function') return noop;
    return () => {
      try {
        (unsubscribe as () => void)();
      } catch {
        // hostile unsubscribe
      }
    };
  } catch {
    return noop;
  }
}

/**
 * Paint inline debug chips for the focused run and drop them on deactivate.
 * Never throws. No-ops when `context.subscriptions` is missing.
 */
export function registerInlineDebugDecorations(
  context: ExtensionContext,
  resultsStore: unknown,
): void {
  let types: TextEditorDecorationType[] | undefined;
  let detach: (() => void) | undefined;
  try {
    const subscriptions = context?.subscriptions;
    if (!subscriptions || typeof subscriptions.push !== 'function') return;

    types = LEVELS.map((level) =>
      window.createTextEditorDecorationType({
        after: {
          color: new ThemeColor(LEVEL_THEME[level]),
          margin: '0 0 0 1.2em',
        },
      }),
    );
    const byLevel = {
      error: types[0]!,
      warning: types[1]!,
      info: types[2]!,
      debug: types[3]!,
    };

    let annotations: InlineDebugAnnotation[] = [];
    let disposed = false;

    const clearEditor = (editor: TextEditor): void => {
      for (const type of types ?? []) editor.setDecorations(type, []);
    };

    const paint = (): void => {
      if (disposed) return;
      try {
        const editors = window.visibleTextEditors ?? [];
        for (const editor of editors) {
          try {
            if (!isPine(editor.document?.languageId) || annotations.length === 0) {
              clearEditor(editor);
              continue;
            }
            const buckets: Record<InlineDebugLevel, DecorationOptions[]> = {
              error: [],
              warning: [],
              info: [],
              debug: [],
            };
            for (const ann of annotations) {
              const range = endOfLine(editor, ann.line - 1);
              if (!range) continue;
              const shown = redactInlineDebugText(ann.message);
              const chip = shown === '[redacted]' ? shown : truncateInlineDebugChip(shown);
              const hover = new MarkdownString();
              hover.isTrusted = false;
              hover.appendText(shown);
              const color = new ThemeColor(LEVEL_THEME[ann.level]);
              buckets[ann.level].push({
                range,
                hoverMessage: hover,
                renderOptions: {
                  after: {
                    contentText: chip,
                    color,
                    margin: '0 0 0 1.2em',
                  },
                },
              });
            }
            for (const level of LEVELS) {
              editor.setDecorations(byLevel[level], buckets[level]);
            }
          } catch {
            // one editor failed — keep painting the rest
          }
        }
      } catch {
        // visibleTextEditors unavailable
      }
    };

    detach = watchResults(resultsStore, (record) => {
      annotations = collectInlineDebug(record);
      paint();
    });

    const disposeAll = (): void => {
      if (disposed) return;
      disposed = true;
      try {
        detach?.();
      } catch {
        // ignore
      }
      try {
        for (const editor of window.visibleTextEditors ?? []) clearEditor(editor);
      } catch {
        // editors already gone
      }
      for (const type of types ?? []) {
        try {
          type.dispose();
        } catch {
          // already disposed
        }
      }
    };

    subscriptions.push(
      window.onDidChangeVisibleTextEditors(() => paint()),
      workspace.onDidChangeTextDocument((event) => {
        try {
          if (isPine(event.document?.languageId)) paint();
        } catch {
          // document unavailable
        }
      }),
      { dispose: disposeAll },
    );
  } catch {
    try {
      detach?.();
    } catch {
      // ignore
    }
    for (const type of types ?? []) {
      try {
        type.dispose();
      } catch {
        // ignore
      }
    }
  }
}
