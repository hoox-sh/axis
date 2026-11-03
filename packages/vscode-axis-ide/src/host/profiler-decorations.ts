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
 * Per-line profiler cost beside Pine line numbers.
 *
 * VS Code has no CodeMirror gutter. A `before` contentText percent chip on the
 * whole line sits next to the line-number margin. The Profiler webview is not
 * involved — this reads `ResultsFocusStore` the same way `attachProfiler` does.
 * Chip text uses `editor.background` so a theme foreground used as the chip
 * wash does not hide the percent.
 */

import {
  DecorationRangeBehavior,
  OverviewRulerLane,
  Range,
  ThemeColor,
  window,
  workspace,
  type DecorationOptions,
  type ExtensionContext,
  type TextDocument,
  type TextEditor,
  type TextEditorDecorationType,
} from 'vscode';
import {
  formatPct,
  hotProfileLineNumbers,
  normalizeProfileLines,
  profileLineTooltip,
  type ProfileLineStat,
} from './profile-lines';

/**
 * PYNE Language Support (`hoox-sh.pyne`) contributes `pinescript`.
 * `pine` / `pine-script` / `pynescript` are accepted aliases.
 */
const PINE_LANGUAGE_IDS = new Set(['pine', 'pine-script', 'pynescript', 'pinescript']);

const SCRIPT_KEYS = [
  'uri',
  'scriptUri',
  'script_uri',
  'path',
  'scriptPath',
  'script_path',
  'file',
  'filename',
  'fsPath',
  'script_name',
  'scriptName',
  'name',
] as const;

const CHIP_MARGIN = '0 0.65em 0 0';

function isPlain(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalDecoration(): TextEditorDecorationType {
  return window.createTextEditorDecorationType({
    isWholeLine: false,
    rangeBehavior: DecorationRangeBehavior.ClosedClosed,
    overviewRulerLane: OverviewRulerLane.Right,
    overviewRulerColor: new ThemeColor('charts.foreground'),
    before: {
      margin: CHIP_MARGIN,
      color: new ThemeColor('editor.background'),
      backgroundColor: new ThemeColor('descriptionForeground'),
      fontWeight: '500',
    },
  });
}

function hotDecoration(): TextEditorDecorationType {
  return window.createTextEditorDecorationType({
    isWholeLine: false,
    rangeBehavior: DecorationRangeBehavior.ClosedClosed,
    overviewRulerLane: OverviewRulerLane.Right,
    overviewRulerColor: new ThemeColor('editorWarning.foreground'),
    before: {
      margin: CHIP_MARGIN,
      color: new ThemeColor('editor.background'),
      backgroundColor: new ThemeColor('charts.orange'),
      fontWeight: '700',
    },
  });
}

function looksLikeScriptRef(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  if (value.startsWith('file:') || value.startsWith('untitled:')) return true;
  return /\.(?:pyne|pine|pinev5|pinev6|pinescript)$/i.test(value);
}

function scriptRef(run: unknown): string | null {
  const bags: unknown[] = [];
  if (isPlain(run)) {
    bags.push(run);
    try {
      bags.push(prop(run, 'meta'));
    } catch {
      // hostile meta — match on the record only
    }
  }
  for (const bag of bags) {
    if (!isPlain(bag)) continue;
    for (const key of SCRIPT_KEYS) {
      try {
        const value = prop(bag, key);
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed && looksLikeScriptRef(trimmed)) return trimmed;
      } catch {
        // hostile field — try the next key
      }
    }
  }
  return null;
}

function prop(obj: object, key: string): unknown {
  return (obj as Record<string, unknown>)[key];
}

function basename(value: string): string {
  const norm = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = norm.lastIndexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function sameScript(docValue: string, ref: string): boolean {
  if (!docValue) return false;
  if (docValue === ref) return true;
  const left = basename(docValue);
  const right = basename(ref);
  return left.length > 0 && left.toLowerCase() === right.toLowerCase();
}

function editorPaths(editor: TextEditor): { uri: string; fs: string } | null {
  try {
    const uri = editor.document.uri;
    const asString = typeof uri?.toString === 'function' ? uri.toString() : '';
    const fs = typeof uri?.fsPath === 'string' ? uri.fsPath : '';
    return { uri: asString, fs };
  } catch {
    return null;
  }
}

function editorMatchesScript(editor: TextEditor, ref: string): boolean {
  const paths = editorPaths(editor);
  if (!paths) return false;
  return sameScript(paths.uri, ref) || sameScript(paths.fs, ref);
}

function isPineEditor(editor: TextEditor): boolean {
  try {
    const lang = editor.document?.languageId;
    return typeof lang === 'string' && PINE_LANGUAGE_IDS.has(lang);
  } catch {
    return false;
  }
}

/** Whole line. Empty lines use a 1-column anchor so the range is not empty. */
function rangeForLine(document: TextDocument, line: number): Range | null {
  const index = line - 1;
  if (!Number.isInteger(index) || index < 0) return null;
  const count = document.lineCount;
  if (typeof count !== 'number' || index >= count) return null;
  const textLine = document.lineAt(index);
  const range = textLine.range;
  if (range && !range.isEmpty) return range;
  return new Range(index, 0, index, 1);
}

function optionsFor(
  document: TextDocument,
  stat: ProfileLineStat,
  hot: boolean,
): DecorationOptions | null {
  const range = rangeForLine(document, stat.line);
  if (!range) return null;
  return {
    range,
    hoverMessage: profileLineTooltip(stat),
    renderOptions: {
      before: {
        contentText: ` ${formatPct(stat.pct)} `,
        margin: CHIP_MARGIN,
        fontWeight: hot ? '700' : '500',
        color: new ThemeColor('editor.background'),
        backgroundColor: new ThemeColor(hot ? 'charts.orange' : 'descriptionForeground'),
      },
    },
  };
}

function clearEditor(
  editor: TextEditor,
  normalType: TextEditorDecorationType,
  hotType: TextEditorDecorationType,
): void {
  try {
    editor.setDecorations(normalType, []);
    editor.setDecorations(hotType, []);
  } catch {
    // disposed editor
  }
}

function paintEditor(
  editor: TextEditor,
  stats: readonly ProfileLineStat[],
  normalType: TextEditorDecorationType,
  hotType: TextEditorDecorationType,
): void {
  const hotLines = new Set(hotProfileLineNumbers(stats));
  const normalOpts: DecorationOptions[] = [];
  const hotOpts: DecorationOptions[] = [];
  for (const stat of stats) {
    try {
      const hot = hotLines.has(stat.line);
      const opt = optionsFor(editor.document, stat, hot);
      if (!opt) continue;
      if (hot) hotOpts.push(opt);
      else normalOpts.push(opt);
    } catch {
      // hostile document — skip the line
    }
  }
  try {
    editor.setDecorations(normalType, normalOpts);
    editor.setDecorations(hotType, hotOpts);
  } catch {
    // disposed editor
  }
}

function visibleEditors(): readonly TextEditor[] {
  try {
    const editors = window.visibleTextEditors;
    return Array.isArray(editors) ? editors : [];
  } catch {
    return [];
  }
}

function applyDecorations(
  normalType: TextEditorDecorationType,
  hotType: TextEditorDecorationType,
  run: unknown,
  painted: Set<TextEditor>,
): void {
  const visible = visibleEditors();
  const pine: TextEditor[] = [];
  for (const editor of visible) {
    try {
      if (isPineEditor(editor)) pine.push(editor);
    } catch {
      // skip
    }
  }
  let stats: ProfileLineStat[] = [];
  try {
    stats = run == null ? [] : normalizeProfileLines(run);
  } catch {
    stats = [];
  }
  const next = new Set<TextEditor>();
  if (run != null && stats.length > 0) {
    let ref: string | null = null;
    try {
      ref = scriptRef(run);
    } catch {
      ref = null;
    }
    const targets = ref ? pine.filter((editor) => editorMatchesScript(editor, ref)) : pine;
    for (const editor of targets) {
      next.add(editor);
      paintEditor(editor, stats, normalType, hotType);
    }
  }
  for (const editor of painted) {
    if (!next.has(editor)) clearEditor(editor, normalType, hotType);
  }
  for (const editor of visible) {
    if (!next.has(editor)) clearEditor(editor, normalType, hotType);
  }
  painted.clear();
  for (const editor of next) painted.add(editor);
}

function readStoreLast(store: unknown): unknown {
  try {
    if (!isPlain(store)) return null;
    const fn = prop(store, 'getLastRun');
    if (typeof fn !== 'function') return null;
    return (fn as () => unknown).call(store) ?? null;
  } catch {
    return null;
  }
}

function readEventLast(snapshot: unknown): unknown {
  try {
    if (!isPlain(snapshot)) return null;
    if (!('lastRun' in snapshot)) return null;
    return prop(snapshot, 'lastRun') ?? null;
  } catch {
    return null;
  }
}

interface DecorationSession {
  refresh(): void;
  dispose(): void;
}

function createSession(
  normalType: TextEditorDecorationType,
  hotType: TextEditorDecorationType,
  resultsStore: unknown,
): DecorationSession {
  const painted = new Set<TextEditor>();
  let current: unknown = readStoreLast(resultsStore);
  let unsub: (() => void) | undefined;
  const refresh = (): void => {
    try {
      applyDecorations(normalType, hotType, current, painted);
    } catch {
      // never throw from a host event
    }
  };
  try {
    if (isPlain(resultsStore)) {
      const subscribe = prop(resultsStore, 'subscribe');
      if (typeof subscribe === 'function') {
        const result = (subscribe as (listener: (snapshot: unknown) => void) => unknown).call(
          resultsStore,
          (snapshot: unknown) => {
            try {
              current = readEventLast(snapshot);
              refresh();
            } catch {
              // hostile listener body
            }
          },
        );
        if (typeof result === 'function') unsub = result as () => void;
      }
    }
  } catch {
    // hostile store — keep the initial snapshot only
  }
  return {
    refresh,
    dispose() {
      try {
        unsub?.();
      } catch {
        // hostile unsubscribe
      }
      current = null;
      try {
        applyDecorations(normalType, hotType, null, painted);
      } catch {
        // disposing
      }
    },
  };
}

function disposeAll(items: { dispose(): void }[]): void {
  for (const item of items) {
    try {
      item.dispose();
    } catch {
      // already disposed
    }
  }
}

/**
 * Paint per-line profiler percents on visible Pine editors.
 * Subscribes to `resultsStore` like {@link attachProfiler}. Never throws.
 */
export function registerProfilerDecorations(context: ExtensionContext, resultsStore: unknown): void {
  const held: { dispose(): void }[] = [];
  let session: DecorationSession | undefined;
  try {
    const normalType = normalDecoration();
    const hotType = hotDecoration();
    held.push(normalType, hotType);
    session = createSession(normalType, hotType, resultsStore);
    held.push(session);
    held.push(window.onDidChangeVisibleTextEditors(() => session?.refresh()));
    held.push(window.onDidChangeActiveTextEditor(() => session?.refresh()));
    held.push(workspace.onDidChangeTextDocument(() => session?.refresh()));
    context.subscriptions.push(...held);
  } catch {
    disposeAll(held);
    return;
  }
  try {
    session?.refresh();
  } catch {
    // initial paint is best-effort
  }
}
