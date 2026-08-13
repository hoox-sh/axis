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
 * Hosts one {@link PyneEditor} for the active tab. Tabs track dirty state and
 * optional `libraryId` when bound to storage. Includes demo scripts
 * (RSI, MACD, …), draft load/save via storage service, and Run callback to parent.
 *
 * @module editor/tabbed-editor
 */

import {
  Component,
  For,
  Show,
  createMemo,
  createSignal,
  batch,
  onCleanup,
  onMount,
  createEffect,
  untrack,
} from 'solid-js';
import { PyneEditor, type PyneEditorRef } from './PyneEditor';
import {
  store,
  loadEditorDoc,
  saveEditorDoc,
  setStatus,
  setEditorOpen,
  toggleDebugPinsEnabled,
  toggleEditorWrapEnabled,
  toggleEditorRulerEnabled,
} from '../store';
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
import {
  countProblemsBySeverity,
  shouldAutoOpenProblems,
} from '../ui/editor-problems';
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
import {
  cancelPreeval,
  runPreevalNow,
  schedulePreeval,
  PREEVAL_IDLE_MS,
} from './preevaluate';
import { countDocStats, cursorLineCol } from './doc-stats';
import { ColorToolsPanel } from './ColorToolsPanel';
import { scanPineColors } from './pine-colors';
import { Icons } from '../ui/icons';

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
  'rsi-overlay': `//@version=6
indicator("RSI", overlay=false)
length = input.int(14, "RSI Length", minval=2, maxval=100)
rsi = ta.rsi(close, length)
plot(rsi, "RSI", color=color.purple)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)
`,
  macd: `//@version=6
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
  editorRef?: PyneEditorRef;
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
   * 1. Pre-eval (parse/lint) — after Save or Run only (not mid-typing)
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
  const [colorsOpen, setColorsOpen] = createSignal(false);

  /** Active tab source (reactive) — color tools + badge count. */
  const activeDoc = createMemo(
    () => props.editorRef?.getDoc?.() || tabs()[activeTab()]?.doc || '',
  );
  const colorHitCount = createMemo(() => scanPineColors(activeDoc()).length);

  // Auto-expand only when the diagnostic count *increases* (e.g. after a run).
  // Forcing open whenever n > 0 re-opened the panel on every store/pre-eval tick
  // and made the statusbar toggle unable to stay closed.
  let prevProblemsCount = 0;
  createEffect(() => {
    const n = editorDiagnostics().length;
    if (shouldAutoOpenProblems(prevProblemsCount, n)) {
      setProblemsOpen(true);
    }
    prevProblemsCount = n;
  });

  const scheduleDraft = (doc: string, name?: string) => {
    // Debounce ALL persistence — sync localStorage every keystroke was a
    // main-thread tax on large Pine buffers. Stats stay live for the strip.
    setStats(countDocStats(doc));
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      saveEditorDoc(doc);
      void saveDraft(doc, name).catch(() => {});
    }, 500);
  };

  // Refresh counters when switching tabs (not on every keystroke)
  createEffect(() => {
    const idx = activeTab();
    const doc = untrack(() => tabs()[idx]?.doc ?? '');
    setStats(countDocStats(doc));
    // Cursor resets to start of tab until CM reports the real head
    setCursor({ line: 1, col: 1 });
    // Lint this tab after a short beat (immediate feel when switching)
    schedulePreeval(doc, 120);
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
        const items = (docs || [])
          .filter((d) => d && typeof d.content === 'string')
          .map((d) => ({
            content: d.content,
            name: (d.name || 'Imported').trim() || 'Imported',
            libraryId: d.libraryId,
          }));
        if (!items.length) return;

        // Snapshot current CM buffer into the active tab before we reshuffle
        let prev = tabs();
        if (props.editorRef?.getDoc) {
          const currentDoc = props.editorRef.getDoc();
          const idx = activeTab();
          prev = prev.map((tab, i) => (i === idx ? { ...tab, doc: currentDoc } : tab));
        }

        const newTabs = items.map((d) =>
          newTab(d.name, d.content, d.libraryId),
        );

        const onlyPlaceholder =
          prev.length === 1 &&
          !prev[0]!.libraryId &&
          !prev[0]!.dirty &&
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

    /**
     * PYNE Agent plugin bridge:
     * - `axis-agent-insert-script` → replace active tab body
     * - `axis-agent-open-script` → new tab (via loadLibraryDocs)
     */
    const onAgentInsert = (ev: Event) => {
      const detail = (ev as CustomEvent<{ code?: string; name?: string }>).detail;
      const code = typeof detail?.code === 'string' ? detail.code : '';
      if (!code.trim()) return;
      setEditorOpen(true);
      props.editorRef?.setDoc?.(code);
      // Keep tab model in sync with CM buffer
      setTabs((prev) => {
        const idx = activeTab();
        return prev.map((tab, i) =>
          i === idx
            ? {
                ...tab,
                doc: code,
                dirty: true,
                name: detail?.name?.trim() || tab.name,
              }
            : tab,
        );
      });
      scheduleDraft(code, detail?.name);
      setStats(countDocStats(code));
      setStatus('ready', 'Agent script added to editor');
    };
    const onAgentOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ code?: string; name?: string }>).detail;
      const code = typeof detail?.code === 'string' ? detail.code : '';
      if (!code.trim()) return;
      setEditorOpen(true);
      const name = (detail?.name || 'Agent script').trim() || 'Agent script';
      // Snapshot live CM buffer, then open a dirty new tab with agent source
      let snapshot = tabs();
      if (props.editorRef?.getDoc) {
        const currentDoc = props.editorRef.getDoc();
        const cur = activeTab();
        snapshot = snapshot.map((tab, i) =>
          i === cur ? { ...tab, doc: currentDoc } : tab,
        );
      }
      const tab = { ...newTab(name, code), dirty: true };
      const next = [...snapshot, tab];
      const newIdx = next.length - 1;
      batch(() => {
        setTabs(next);
        setActiveTab(newIdx);
      });
      props.editorRef?.setDoc?.(code);
      scheduleDraft(code, name);
      setStats(countDocStats(code));
      setStatus('ready', `Opened "${name}" from PYNE Agent`);
    };
    window.addEventListener('axis-agent-insert-script', onAgentInsert);
    window.addEventListener('axis-agent-open-script', onAgentOpen);

    onCleanup(() => {
      window.removeEventListener('axis-editor-save-library', onSaveLibrary);
      window.removeEventListener('axis-editor-git-push', onGitPush);
      window.removeEventListener('axis-editor-git-pull', onGitPull);
      window.removeEventListener('axis-agent-insert-script', onAgentInsert);
      window.removeEventListener('axis-agent-open-script', onAgentOpen);
    });
  });

  onCleanup(() => {
    if (draftTimer) clearTimeout(draftTimer);
  });

  const addTab = () => {
    // Snapshot CM into the current tab before opening a blank one
    let snapshot = tabs();
    if (props.editorRef?.getDoc) {
      const currentDoc = props.editorRef.getDoc();
      const cur = activeTab();
      snapshot = snapshot.map((tab, i) =>
        i === cur ? { ...tab, doc: currentDoc } : tab,
      );
    }
    const next = [...snapshot, newTab(`Script ${snapshot.length + 1}`, '')];
    const newIdx = next.length - 1;
    batch(() => {
      setTabs(next);
      setActiveTab(newIdx);
    });
    props.editorRef?.setDoc?.('');
  };

  const closeTab = (idx: number) => {
    const list = tabs();
    if (list.length <= 1) return;
    if (idx < 0 || idx >= list.length) return;

    const cur = activeTab();
    // Snapshot live CM buffer into the active tab before reshuffling
    let snapshot = list;
    if (props.editorRef?.getDoc) {
      const currentDoc = props.editorRef.getDoc();
      snapshot = list.map((tab, i) =>
        i === cur ? { ...tab, doc: currentDoc } : tab,
      );
    }

    const newTabs = snapshot.filter((_, i) => i !== idx);
    let nextActive: number;
    if (idx === cur) {
      // Closing the focused tab → stay at same index (next tab slides in)
      nextActive = Math.min(idx, newTabs.length - 1);
    } else if (idx < cur) {
      // Closed a tab to the left → active index shifts down
      nextActive = cur - 1;
    } else {
      nextActive = cur;
    }
    nextActive = Math.max(0, Math.min(nextActive, newTabs.length - 1));

    batch(() => {
      setTabs(newTabs);
      setActiveTab(nextActive);
    });
    props.editorRef?.setDoc?.(newTabs[nextActive]?.doc ?? '');
  };

  const switchTab = (idx: number) => {
    const list = tabs();
    if (idx < 0 || idx >= list.length || idx === activeTab()) return;
    // Persist CM buffer into the tab we're leaving
    let snapshot = list;
    if (props.editorRef?.getDoc) {
      const currentDoc = props.editorRef.getDoc();
      snapshot = list.map((tab, i) =>
        i === activeTab() ? { ...tab, doc: currentDoc } : tab,
      );
      setTabs(snapshot);
    }
    setActiveTab(idx);
    props.editorRef?.setDoc?.(snapshot[idx]?.doc ?? '');
  };

  const onDocChange = (doc: string) => {
    const text = typeof doc === 'string' ? doc : String(doc ?? '');
    setTabs((t) =>
      t.map((tab, i) =>
        i === activeTab()
          ? {
              ...tab,
              doc: text,
              // Only mark dirty when content actually changed
              dirty: tab.dirty || tab.doc !== text,
            }
          : tab,
      ),
    );
    props.onDocChange?.(text);
    scheduleDraft(text, tabs()[activeTab()]?.name);
    // Idle lint: clear mid-type marks; re-check after 2s without typing
    // (Save / Run still call runPreevalNow immediately)
    schedulePreeval(text, PREEVAL_IDLE_MS);
  };

  const activeTabState = () => tabs()[activeTab()];

  /** Live doc for the active tab (CM buffer preferred). */
  const activeDocText = () =>
    props.editorRef?.getDoc?.() || activeTabState()?.doc || '';

  /**
   * Unsaved = dirty edits, or never written to the library (`libraryId` missing).
   * Empty buffers are not considered “needing save” for Run (blocked separately).
   */
  const isActiveUnsaved = (): boolean => {
    const tab = activeTabState();
    if (!tab) return true;
    const doc = activeDocText();
    if (!doc.trim()) return false;
    return !!tab.dirty || !tab.libraryId;
  };

  /**
   * Persist active tab via storage (library write / git commit).
   * @returns whether the write succeeded and the document that was saved.
   */
  const saveActiveToLibrary = async (): Promise<{ ok: boolean; doc: string }> => {
    const tab = activeTabState();
    const doc = activeDocText();
    if (!doc.trim()) {
      setStatus('error', 'Editor is empty');
      return { ok: false, doc: '' };
    }
    // Snapshot CM into tab state so libraryId/dirty updates stay consistent
    setTabs((t) =>
      t.map((tb, i) => (i === activeTab() ? { ...tb, doc } : tb)),
    );
    // Syntax diagnostics after save (editor does not lint while typing)
    const pe = await runPreevalNow(doc);
    const name = tab?.name || 'Script';
    try {
      const meta = await pushScript({
        id: tab?.libraryId,
        name,
        content: doc,
      });
      onGitPushSuccess(meta);
      const errN = pe.diagnostics.filter((d) => d.severity === 'error').length;
      const base = isGitStorageActive()
        ? `Committed & saved "${meta.name}" to git`
        : `Saved "${meta.name}" → ${getEditorStorageId()}`;
      if (errN > 0) {
        setStatus('error', `${base} · ${errN} syntax error${errN === 1 ? '' : 's'}`);
      } else {
        setStatus('ready', base);
      }
      return { ok: true, doc };
    } catch (e: unknown) {
      setStatus('error', e instanceof Error ? e.message : String(e));
      return { ok: false, doc };
    }
  };

  /**
   * Before Run: write the active script to the library when unsaved.
   * Already-saved clean tabs are a no-op.
   */
  const ensureSavedForRun = async (): Promise<{ ok: boolean; doc: string }> => {
    const doc = activeDocText();
    if (!doc.trim()) {
      setStatus('error', 'Editor is empty');
      return { ok: false, doc: '' };
    }
    if (!isActiveUnsaved()) {
      return { ok: true, doc };
    }
    setStatus('ready', 'Saving before run…');
    return saveActiveToLibrary();
  };

  // Expose save/run hooks for topbar / command palette / EditorPane
  if (props.editorRef) {
    props.editorRef.isUnsaved = () => isActiveUnsaved();
    props.editorRef.ensureSavedForRun = () => ensureSavedForRun();
  }

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
    if (typeof doc !== 'string') return;
    const idx = activeTab();
    const resolvedName = name || activeTabState()?.name || 'Script';
    setTabs((t) =>
      t.map((tab, i) =>
        i === idx
          ? {
              ...tab,
              doc,
              name: resolvedName,
              dirty: false,
              libraryId: libraryId ?? tab.libraryId,
            }
          : tab,
      ),
    );
    props.editorRef?.setDoc?.(doc);
    scheduleDraft(doc, resolvedName);
  };

  return (
    <div class="flex flex-col h-full min-h-0 flex-1">
      {/* ── Tab strip + git/source actions ───────────────────────── */}
      <div
        class="axis-editor-tabbar flex items-stretch bg-bg-base border-b-2 border-border flex-shrink-0 min-h-[2rem]"
        data-testid="axis-editor-tabbar"
      >
        <div class="axis-editor-tabs flex items-stretch min-w-0 flex-1 overflow-x-auto">
          <For each={tabs()}>
            {(tab, idx) => (
              <button
                type="button"
                class={`axis-editor-tab flex items-center gap-1.5 px-2.5 py-1 text-[11px] border-r border-border-soft cursor-pointer whitespace-nowrap select-none ${
                  idx() === activeTab()
                    ? 'is-active bg-bg-panel text-text'
                    : 'text-text-dim hover:bg-bg-hover hover:text-text'
                }`}
                onClick={() => switchTab(idx())}
              >
                {tab.dirty && (
                  <span class="inline-block w-1.5 h-1.5 rounded-full bg-orange flex-shrink-0" />
                )}
                <span class="max-w-[140px] overflow-hidden text-ellipsis">{tab.name}</span>
                {tabs().length > 1 && (
                  <span
                    role="button"
                    tabindex={0}
                    class="text-text-faint hover:text-red text-sm px-0.5 leading-none hover:bg-bg-hover rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(idx());
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        closeTab(idx());
                      }
                    }}
                    title="Close tab"
                    aria-label={`Close ${tab.name}`}
                  >
                    ×
                  </span>
                )}
              </button>
            )}
          </For>
          <button
            type="button"
            class="axis-editor-tab-add text-text-dim border-none bg-transparent px-2 cursor-pointer text-base hover:text-accent hover:bg-bg-hover flex-shrink-0"
            onClick={addTab}
            title="New tab"
            aria-label="New tab"
          >
            +
          </button>
        </div>
        <div
          class="axis-editor-tabbar-actions flex items-center gap-0.5 px-1.5 flex-shrink-0 border-l border-border-soft"
          onPointerDown={(e) => e.stopPropagation()}
        >
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
        <PyneEditor
          initialDoc={tabs()[activeTab()]?.doc}
          onDocChange={onDocChange}
          onCursorChange={(pos) => setCursor({ line: pos.line, col: pos.col })}
          onRun={() => {
            void (async () => {
              if (store.preEval?.hasErrors && !store.preEval?.pending) return;
              const saved = await ensureSavedForRun();
              if (!saved.ok || !saved.doc.trim()) return;
              // Re-check after save (save runs pre-eval; block hard errors)
              if (store.preEval?.hasErrors) return;
              props.onRun?.(saved.doc);
            })();
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
          wrapEnabled={store.editorWrapEnabled}
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
      <Show when={colorsOpen()}>
        <ColorToolsPanel
          doc={activeDoc()}
          onApplyDoc={(next) => {
            const ref = props.editorRef;
            if (ref?.setDoc) ref.setDoc(next);
            // Keep tab dirty + draft in sync (setDoc does fire CM listener)
            onDocChange(next);
          }}
          onJump={(hit) => {
            const ref = props.editorRef as PyneEditorRef | undefined;
            if (ref?.selectRange?.(hit.from, hit.to)) return;
            if (ref?.scrollToLine) ref.scrollToLine(hit.line);
            else ref?.focusLine?.(hit.line);
          }}
        />
      </Show>
      {/* ── Status / action bar ─────────────────────────────────── */}
      <div
        class="axis-editor-statusbar flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 border-t-2 border-border bg-bg-base text-[10px] font-mono tabular-nums select-none min-h-[1.75rem]"
        data-testid="axis-editor-stats"
      >
        {/* Stats cluster */}
        <div class="axis-editor-statusbar-stats flex items-center gap-2 text-text-faint min-w-0">
          <span data-testid="axis-editor-cursor" title="Cursor (line : column)" class="flex-shrink-0">
            <span class="text-text-dim">
              {cursor().line}:{cursor().col}
            </span>
          </span>
          <span class="text-border-soft" aria-hidden="true">
            ·
          </span>
          <span title="Lines" class="flex-shrink-0">
            <span class="text-text-dim">{stats().lines}</span>
            <span class="text-text-faint ml-0.5">ln</span>
          </span>
          <span title="Characters" class="hidden sm:inline flex-shrink-0">
            <span class="text-text-dim">{stats().chars}</span>
            <span class="text-text-faint ml-0.5">ch</span>
          </span>
        </div>

        <span class="axis-editor-statusbar-sep" aria-hidden="true" />

        {/* Diagnostics / panels */}
        <div class="axis-editor-statusbar-actions flex items-center gap-0.5 min-w-0">
          <button
            type="button"
            class={`axis-editor-status-btn ${
              problemsOpen() ? 'is-active' : ''
            } ${
              diagCounts().errors > 0
                ? 'is-error'
                : diagCounts().warnings > 0
                  ? 'is-warn'
                  : diagCounts().typos > 0
                    ? 'is-typo'
                    : ''
            }`}
            data-testid="axis-editor-problems-toggle"
            title={
              editorDiagnostics().length
                ? `${diagCountLabel() || `${problemCounts().total} problem(s)`} — ${problemsOpen() ? 'hide' : 'show'}`
                : store.preEval?.pending
                  ? 'Checking script…'
                  : 'No problems'
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
              class={`axis-editor-status-btn font-semibold ${
                diagCounts().errors > 0
                  ? 'is-error'
                  : diagCounts().warnings > 0
                    ? 'is-warn'
                    : diagCounts().typos > 0
                      ? 'is-typo'
                      : ''
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
          <button
            type="button"
            class={`axis-editor-status-btn ${colorsOpen() ? 'is-active' : ''}`}
            data-testid="axis-editor-colors-toggle"
            title={
              colorsOpen()
                ? 'Hide color tools'
                : 'Color chips, editor, and converter'
            }
            aria-pressed={colorsOpen()}
            aria-expanded={colorsOpen()}
            onClick={() => setColorsOpen((o) => !o)}
          >
            Colors
            <Show when={colorHitCount() > 0}>
              <span class="tabular-nums" data-testid="axis-editor-colors-badge">
                {colorHitCount()}
              </span>
            </Show>
          </button>
        </div>

        <div class="flex-1 min-w-[0.5rem]" />

        {/* View cluster (right) — format via overflow menu / Shift+Alt+F */}
        <div class="axis-editor-statusbar-view flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            class={`axis-editor-status-btn ${
              store.editorWrapEnabled ? 'is-active' : ''
            }`}
            data-testid="axis-editor-wrap-toggle"
            title={
              store.editorWrapEnabled
                ? 'Soft wrap on'
                : 'Soft wrap off'
            }
            aria-pressed={store.editorWrapEnabled}
            onClick={() => toggleEditorWrapEnabled()}
          >
            <Icons.wrapText size={11} />
            wrap
          </button>
          <button
            type="button"
            class={`axis-editor-status-btn ${
              store.editorRulerEnabled ? 'is-active' : ''
            }`}
            data-testid="axis-editor-ruler-toggle"
            title={
              store.editorRulerEnabled
                ? 'Column ruler on (80 cols)'
                : 'Show column ruler'
            }
            aria-pressed={store.editorRulerEnabled}
            onClick={() => toggleEditorRulerEnabled()}
          >
            <Icons.ruler size={11} />
            80
          </button>
        </div>
      </div>
    </div>
  );
};
