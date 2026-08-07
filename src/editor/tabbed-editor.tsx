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
 * Multi-tab Pine editor with demos, draft, and library save.
 *
 * Hosts one {@link PineEditor} for the active tab. Tabs track dirty state and
 * optional `libraryId` when bound to storage. Includes demo scripts
 * (RSI, MACD, …), draft load/save via storage service, and Run callback to parent.
 *
 * @module editor/tabbed-editor
 */

import { Component, For, Show, createMemo, createSignal, batch, onCleanup, onMount, createEffect } from 'solid-js';
import { PineEditor, type PineEditorRef } from './PineEditor';
import { store, loadEditorDoc, saveEditorDoc, setStatus, toggleDebugPinsEnabled } from '../store';
import { saveDraft, loadDraft } from '../storage/service';
import { normalizeRunProfile, type RunProfile } from '../results/profiler';
import {
  collectInlineDebugAnnotations,
  filterPinableAnnotations,
  type InlineDebugAnnotation,
} from '../results/inline-debug';
import { setDebugChipClickHandler } from './inline-debug';
import { jumpToDebugPin } from '../chart/manager-access';
import { EditorProblems } from '../ui/EditorProblems';
import { countProblemsBySeverity } from '../ui/editor-problems';
import { EditorGitBar } from '../ui/EditorGitBar';
import {
  getEditorStorageId,
  isGitStorageActive,
  pullLibrary,
  pushScript,
} from './git-sync';
import {
  countDiagnostics,
  diagnosticsFromLastRun,
  formatDiagnosticCount,
  type EditorDiagnostic,
} from './diagnostics';
import { schedulePreeval, cancelPreeval } from './preevaluate';
import { countDocStats, cursorLineCol } from './doc-stats';

export { countDocStats, cursorLineCol } from './doc-stats';

/** One editor tab (in-memory until saved to library/draft). */
interface Tab {
  id: string;
  name: string;
  doc: string;
  dirty: boolean;
  /** Bound library script id when loaded/saved */
  libraryId?: string;
}

const DEMOS: Record<string, string> = {
  // Oscillators must use overlay=false — on the price pane RSI (0–100) is invisible.
  'rsi-overlay': `//@version=5
indicator("RSI", overlay=false)
length = input.int(14, "RSI Length", minval=2, maxval=100)
rsi = ta.rsi(close, length)
plot(rsi, "RSI", color=color.purple)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)
`,
  macd: `//@version=5
indicator("MACD", overlay=false)
fastLen   = input.int(12, "Fast Length")
slowLen   = input.int(26, "Slow Length")
signalLen = input.int(9,  "Signal Length")
[macdLine, signalLine, histLine] = ta.macd(close, fastLen, slowLen, signalLen)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
plot(histLine, "Hist", color=color.gray, style=plot.style_histogram)
`,
};

let tabIdCounter = 0;
const newTab = (name: string, doc: string, libraryId?: string): Tab => ({
  id: `tab_${Date.now()}_${++tabIdCounter}`,
  name,
  doc,
  dirty: false,
  libraryId,
});

function initialDoc(): string {
  const shared = loadEditorDoc();
  if (shared.trim()) return shared;
  return store.scripts[0]?.code || DEMOS['rsi-overlay'];
}

interface Props {
  onRun?: (doc: string) => void;
  onDocChange?: (doc: string) => void;
  editorRef?: PineEditorRef;
}

/** Multi-tab editor UI with demos, draft autosave, and library integration. */
export const TabbedEditor: Component<Props> = (props) => {
  const [tabs, setTabs] = createSignal<Tab[]>([newTab('Script 1', initialDoc())]);
  const [activeTab, setActiveTab] = createSignal(0);

  /** Normalize last-run profile for the CM profiler gutter (null when off / empty). */
  const profilerProfile = createMemo((): RunProfile | null => {
    if (!store.profilerEnabled) return null;
    const last = store.lastRun as {
      profile?: unknown;
      meta?: { profile?: unknown; ms?: number };
      ms?: number;
    } | null;
    const raw = last?.profile ?? last?.meta?.profile ?? last;
    const fallbackMs =
      typeof store.lastRunMs === 'number'
        ? store.lastRunMs
        : typeof last?.meta?.ms === 'number'
          ? last.meta.ms
          : undefined;
    return normalizeRunProfile(raw, fallbackMs);
  });

  /** Last-run logs/errors mapped to source lines for inline chips. */
  const inlineDebugAnns = createMemo((): InlineDebugAnnotation[] => {
    if (!store.inlineDebugEnabled) return [];
    return collectInlineDebugAnnotations(store.lastRun);
  });

  /**
   * Pin-able source lines for the editor pin gutter (📍).
   * Independent of inline debug chips — gated on `debugPinsEnabled`.
   */
  const debugPinAnns = createMemo((): InlineDebugAnnotation[] => {
    if (!store.debugPinsEnabled) return [];
    return filterPinableAnnotations(collectInlineDebugAnnotations(store.lastRun));
  });

  /**
   * CM underlines / gutter diagnostics:
   * 1. Live pre-eval (parse/lint) — marks wrong code as you type
   * 2. Last-run engine errors — only when buffer still matches last pre-eval
   *    source and pre-eval did not already cover the same line+message
   */
  const editorDiagnostics = createMemo((): EditorDiagnostic[] => {
    void store.lastRun;
    void store.preEval;
    void tabs();
    void activeTab();
    const sourceDoc =
      props.editorRef?.getDoc?.() || tabs()[activeTab()]?.doc || '';
    const pre = store.preEval?.diagnostics ?? [];
    // Prefer pre-eval for current buffer; keep last-run when pre-eval empty/pending
    // and the buffer is still the one that was run (stale underlines after edits
    // are avoided by clearing last-run contribution when pre has results).
    if (pre.length > 0) return pre as EditorDiagnostic[];
    if (store.preEval?.pending) {
      // While checking, still show last-run if any
      return diagnosticsFromLastRun(store.lastRun, sourceDoc);
    }
    // Pre-eval finished with zero findings — drop stale last-run marks for this doc
    if (store.preEval && store.preEval.source === sourceDoc && !store.preEval.hasErrors) {
      return [];
    }
    return diagnosticsFromLastRun(store.lastRun, sourceDoc);
  });

  const diagCountLabel = createMemo(() => formatDiagnosticCount(editorDiagnostics()));
  const problemCounts = createMemo(() => countProblemsBySeverity(editorDiagnostics()));
  // Prefer diagnostics module counts when available (same totals)
  const diagCounts = createMemo(() => countDiagnostics(editorDiagnostics()));

  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  const [stats, setStats] = createSignal(countDocStats(tabs()[0]?.doc || ''));
  /** Cursor position in the active editor (1-based line / column). */
  const [cursor, setCursor] = createSignal({ line: 1, col: 1 });
  /** Problems panel expanded under the editor. */
  const [problemsOpen, setProblemsOpen] = createSignal(false);

  // Auto-expand when new diagnostics appear after a run
  createEffect(() => {
    const n = editorDiagnostics().length;
    if (n > 0) setProblemsOpen(true);
  });

  const scheduleDraft = (doc: string, name?: string) => {
    saveEditorDoc(doc);
    setStats(countDocStats(doc));
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      void saveDraft(doc, name).catch(() => {});
    }, 400);
  };

  // Refresh counters when switching tabs
  createEffect(() => {
    const doc = tabs()[activeTab()]?.doc ?? '';
    setStats(countDocStats(doc));
    // Cursor resets to start of tab until CM reports the real head
    setCursor({ line: 1, col: 1 });
    // Pre-eval active tab (marks wrong code; gates Run)
    schedulePreeval(doc);
  });

  onMount(() => {
    // Click pin-able chips / pin gutter → crosshair + scroll to bar
    // (line flash is handled inside editor/inline-debug firePinJump)
    setDebugChipClickHandler((detail) => {
      // Line flash is applied inside editor/inline-debug firePinJump
      jumpToDebugPin({ barIndex: detail.barIndex, time: detail.time });
    });
    onCleanup(() => {
      setDebugChipClickHandler(null);
      cancelPreeval();
    });

    // Prefer storage draft over empty first paint (async)
    void loadDraft().then((d) => {
      if (!d?.content?.trim()) return;
      const current = props.editorRef?.getDoc?.() || tabs()[0]?.doc || '';
      // Don't clobber if user already typed or initial had content from localStorage
      if (current.trim() && current !== DEMOS['rsi-overlay']) return;
      if (loadEditorDoc().trim()) return;
      setTabs((t) => t.map((tab, i) => (i === 0 ? { ...tab, doc: d.content, name: d.name || tab.name } : tab)));
      props.editorRef?.setDoc?.(d.content);
    });

    if (props.editorRef) {
      props.editorRef.loadLibraryDoc = (doc: string, name?: string, libraryId?: string) => {
        props.editorRef?.loadLibraryDocs?.([{ content: doc, name, libraryId }]);
      };

      /**
       * Open each imported script in its own tab.
       * Replaces a single empty/demo tab; otherwise appends.
       * Activates the first opened tab and loads full content into CM.
       */
      props.editorRef.loadLibraryDocs = (docs) => {
        const items = (docs || []).filter((d) => d && typeof d.content === 'string');
        if (!items.length) return;

        // Snapshot current CM buffer into the active tab before we reshuffle
        let prev = tabs();
        if (props.editorRef?.getDoc) {
          const currentDoc = props.editorRef.getDoc();
          const idx = activeTab();
          prev = prev.map((tab, i) => (i === idx ? { ...tab, doc: currentDoc } : tab));
        }

        const newTabs = items.map((d) =>
          newTab(d.name || 'Imported', d.content, d.libraryId),
        );

        const onlyPlaceholder =
          prev.length === 1 &&
          !prev[0]!.libraryId &&
          (!prev[0]!.doc.trim() ||
            prev[0]!.doc === DEMOS['rsi-overlay'] ||
            prev[0]!.doc === DEMOS.macd ||
            prev[0]!.name === 'Script 1');

        let nextTabs: Tab[];
        let firstNewIdx: number;
        if (onlyPlaceholder) {
          nextTabs = newTabs;
          firstNewIdx = 0;
        } else {
          firstNewIdx = prev.length;
          nextTabs = [...prev, ...newTabs];
        }

        batch(() => {
          setTabs(nextTabs);
          setActiveTab(firstNewIdx);
        });

        const active = nextTabs[firstNewIdx]!;
        // Full body from import — never re-read / never truncate
        props.editorRef?.setDoc?.(active.doc);
        scheduleDraft(active.doc, active.name);
        setStats(countDocStats(active.doc));
      };
    }

    // Command palette → Save to Library / Git Push / Git Pull
    const onSaveLibrary = () => {
      void saveActiveToLibrary();
    };
    const onGitPush = () => {
      void saveActiveToLibrary();
    };
    const onGitPull = () => {
      void pullActiveFromLibrary();
    };
    window.addEventListener('axis-editor-save-library', onSaveLibrary);
    window.addEventListener('axis-editor-git-push', onGitPush);
    window.addEventListener('axis-editor-git-pull', onGitPull);
    onCleanup(() => {
      window.removeEventListener('axis-editor-save-library', onSaveLibrary);
      window.removeEventListener('axis-editor-git-push', onGitPush);
      window.removeEventListener('axis-editor-git-pull', onGitPull);
    });
  });

  onCleanup(() => {
    if (draftTimer) clearTimeout(draftTimer);
  });

  const addTab = () => {
    const newIdx = tabs().length;
    setTabs((t) => [...t, newTab(`Script ${t.length + 1}`, '')]);
    setActiveTab(newIdx);
    if (props.editorRef?.setDoc) {
      props.editorRef.setDoc('');
    }
  };

  const closeTab = (idx: number) => {
    if (tabs().length <= 1) return;
    batch(() => {
      const newTabs = tabs().filter((_, i) => i !== idx);
      setTabs(newTabs);
      if (activeTab() >= newTabs.length) {
        setActiveTab(newTabs.length - 1);
      }
    });
    const newActiveIdx = Math.min(activeTab(), tabs().length - 1);
    if (props.editorRef?.setDoc) {
      props.editorRef.setDoc(tabs()[newActiveIdx]?.doc ?? '');
    }
  };

  const switchTab = (idx: number) => {
    if (props.editorRef?.getDoc) {
      const currentDoc = props.editorRef.getDoc();
      setTabs((t) =>
        t.map((tab, i) => (i === activeTab() ? { ...tab, doc: currentDoc } : tab)),
      );
    }
    setActiveTab(idx);
    if (props.editorRef?.setDoc) {
      props.editorRef.setDoc(tabs()[idx]?.doc ?? '');
    }
  };

  const onDocChange = (doc: string) => {
    setTabs((t) =>
      t.map((tab, i) => (i === activeTab() ? { ...tab, doc, dirty: true } : tab)),
    );
    props.onDocChange?.(doc);
    scheduleDraft(doc, tabs()[activeTab()]?.name);
    schedulePreeval(doc);
  };

  const activeTabState = () => tabs()[activeTab()];

  /** Persist active tab via storage (library write / git commit). */
  const saveActiveToLibrary = async () => {
    const tab = activeTabState();
    const doc = props.editorRef?.getDoc?.() || tab?.doc || '';
    if (!doc.trim()) {
      setStatus('error', 'Editor is empty');
      return;
    }
    const name = tab?.name || 'Script';
    try {
      const meta = await pushScript({
        id: tab?.libraryId,
        name,
        content: doc,
      });
      onGitPushSuccess(meta);
      setStatus(
        'ready',
        isGitStorageActive()
          ? `Committed & saved "${meta.name}" to git`
          : `Saved "${meta.name}" → ${getEditorStorageId()}`,
      );
    } catch (e: unknown) {
      setStatus('error', e instanceof Error ? e.message : String(e));
    }
  };

  /** Pull / refresh bound library script from active storage. */
  const pullActiveFromLibrary = async () => {
    const tab = activeTabState();
    try {
      const result = await pullLibrary(tab?.libraryId);
      if (result.sync && !result.sync.ok) {
        setStatus('error', result.sync.message || 'Pull failed');
        return;
      }
      if (result.doc && tab?.libraryId) {
        onGitPullReload(result.doc.content, result.doc.name, result.doc.id);
        setStatus(
          'ready',
          isGitStorageActive()
            ? `Pulled "${result.doc.name}" from git (${result.list.length} script(s))`
            : `Refreshed "${result.doc.name}" (${result.list.length} script(s))`,
        );
      } else {
        setStatus(
          'ready',
          result.sync?.message ||
            (isGitStorageActive()
              ? `Pulled ${result.list.length} script(s) from git`
              : `Library: ${result.list.length} script(s)`),
        );
      }
    } catch (e: unknown) {
      setStatus('error', e instanceof Error ? e.message : String(e));
    }
  };

  const onGitPushSuccess = (meta: { id: string; name: string }) => {
    setTabs((t) =>
      t.map((tb, i) =>
        i === activeTab()
          ? { ...tb, dirty: false, libraryId: meta.id, name: meta.name }
          : tb,
      ),
    );
  };

  const onGitPullReload = (doc: string, name?: string, libraryId?: string) => {
    const idx = activeTab();
    setTabs((t) =>
      t.map((tab, i) =>
        i === idx
          ? {
              ...tab,
              doc,
              name: name || tab.name,
              dirty: false,
              libraryId: libraryId ?? tab.libraryId,
            }
          : tab,
      ),
    );
    props.editorRef?.setDoc?.(doc);
    scheduleDraft(doc, name);
  };

  return (
    <div class="flex flex-col h-full min-h-0 flex-1">
      <div class="flex items-stretch bg-bg-base border-b-2 border-border overflow-x-auto flex-shrink-0">
        <For each={tabs()}>
          {(tab, idx) => (
            <button
              class={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] border-r-2 border-border-soft cursor-pointer whitespace-nowrap select-none ${
                idx() === activeTab()
                  ? 'bg-bg-panel text-text border-b-2 border-b-accent -mb-[2px]'
                  : 'text-text-dim hover:bg-bg-hover hover:text-text border-b-2 border-b-transparent'
              }`}
              onClick={() => switchTab(idx())}
            >
              {tab.dirty && <span class="inline-block w-1.5 h-1.5 rounded-full bg-orange" />}
              <span class="max-w-[140px] overflow-hidden text-ellipsis">{tab.name}</span>
              {tabs().length > 1 && (
                <span
                  class="text-text-faint hover:text-red text-sm px-0.5 hover:bg-bg-hover"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(idx());
                  }}
                >
                  ×
                </span>
              )}
            </button>
          )}
        </For>
        <button
          class="text-text-dim border-none bg-transparent px-2.5 cursor-pointer text-lg hover:text-accent hover:bg-bg-hover"
          onClick={addTab}
          title="New tab"
        >
          +
        </button>
        <div class="flex-1" />
        <div class="self-center m-0.5">
          <EditorGitBar
            getDoc={() => props.editorRef?.getDoc?.() || activeTabState()?.doc || ''}
            getName={() => activeTabState()?.name || 'Script'}
            getLibraryId={() => activeTabState()?.libraryId}
            dirty={() => !!activeTabState()?.dirty}
            onPushSuccess={onGitPushSuccess}
            onPullReload={onGitPullReload}
            compact
          />
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden relative">
        <PineEditor
          initialDoc={tabs()[activeTab()]?.doc}
          onDocChange={onDocChange}
          onCursorChange={(pos) => setCursor({ line: pos.line, col: pos.col })}
          onRun={() => {
            if (store.preEval?.hasErrors && !store.preEval?.pending) return;
            const doc = props.editorRef?.getDoc?.() || tabs()[activeTab()]?.doc;
            if (doc?.trim()) props.onRun?.(doc);
          }}
          editorRef={props.editorRef}
          profilerEnabled={store.profilerEnabled}
          profilerProfile={profilerProfile()}
          inlineDebugEnabled={store.inlineDebugEnabled}
          inlineDebug={inlineDebugAnns()}
          debugPinsEnabled={store.debugPinsEnabled}
          debugPins={debugPinAnns()}
          onToggleDebugPins={() => toggleDebugPinsEnabled()}
          diagnostics={editorDiagnostics()}
          rulerEnabled={store.editorRulerEnabled}
        />
      </div>
      <Show when={problemsOpen()}>
        <EditorProblems
          diagnostics={editorDiagnostics()}
          onJump={(line) => {
            const ref = props.editorRef;
            // Prefer full diagnostic jump when we have a matching range
            const match = editorDiagnostics().find((d) => d.line === line);
            if (match && ref?.jumpToDiagnostic) {
              ref.jumpToDiagnostic(match);
              return;
            }
            if (ref?.scrollToLine) ref.scrollToLine(line);
            else ref?.focusLine?.(line);
          }}
        />
      </Show>
      <div
        class="flex-shrink-0 flex items-center gap-3 px-2 py-0.5 border-t-2 border-border bg-bg-base text-[10px] font-mono text-text-faint tabular-nums select-none"
        data-testid="axis-editor-stats"
        title="Document statistics · cursor position · line wrap on"
      >
        <span data-testid="axis-editor-cursor" title="Cursor position (line : column)">
          Pos{' '}
          <span class="text-text-dim">
            {cursor().line}:{cursor().col}
          </span>
        </span>
        <span title="Total lines in document">
          Ln <span class="text-text-dim">{stats().lines}</span>
        </span>
        <span>
          Words <span class="text-text-dim">{stats().words}</span>
        </span>
        <span>
          Chars <span class="text-text-dim">{stats().chars}</span>
        </span>
        <button
          type="button"
          class={`ml-1 px-1.5 py-0 rounded border border-transparent hover:bg-bg-hover hover:text-text inline-flex items-center gap-1 ${
            problemsOpen() ? 'text-accent border-border-soft bg-bg-hover' : ''
          } ${
            diagCounts().errors > 0
              ? 'text-red'
              : diagCounts().warnings > 0
                ? 'text-orange'
                : 'text-text-faint'
          }`}
          data-testid="axis-editor-problems-toggle"
          title={
            editorDiagnostics().length
              ? `${diagCountLabel() || `${problemCounts().total} problem(s)`} — click to ${problemsOpen() ? 'hide' : 'show'} list`
              : store.preEval?.pending
                ? 'Checking script…'
                : 'No problems (pre-eval + last run)'
          }
          aria-pressed={problemsOpen()}
          aria-expanded={problemsOpen()}
          onClick={() => setProblemsOpen((o) => !o)}
        >
          Problems
          <Show when={editorDiagnostics().length > 0}>
            <span class="tabular-nums" data-testid="axis-editor-problems-badge">
              {editorDiagnostics().length}
            </span>
          </Show>
        </button>
        <Show when={editorDiagnostics().length > 0}>
          <button
            type="button"
            class={`px-1.5 py-0 rounded border border-transparent hover:bg-bg-hover inline-flex items-center gap-1 font-semibold ${
              diagCounts().errors > 0
                ? 'text-red'
                : diagCounts().warnings > 0
                  ? 'text-orange'
                  : 'text-text-dim'
            }`}
            data-testid="axis-editor-diag-count"
            title={`${diagCountLabel()} — jump to first`}
            onClick={() => {
              const diags = editorDiagnostics();
              if (!diags.length) return;
              const ref = props.editorRef;
              const first =
                diags.find((d) => d.severity === 'error') ??
                diags.find((d) => d.severity === 'warning') ??
                diags[0]!;
              if (ref?.jumpToDiagnostic) {
                ref.jumpToDiagnostic(first);
                return;
              }
              if (ref?.scrollToLine) ref.scrollToLine(first.line);
              else ref?.focusLine?.(first.line);
            }}
          >
            {diagCountLabel()}
          </button>
        </Show>
        <span class="ml-auto text-text-faint/80">wrap</span>
      </div>
    </div>
  );
};
