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
 * Dockable / floatable **editor chrome** around {@link TabbedEditor}.
 *
 * Uses {@link FloatableShell} for the same panel management as watchlist /
 * layers (dock menu, float, drag-to-edge, close). Primary header tools show
 * **icon + label** always (no hover slide-in): **Run**, **Library**,
 * **Scriptlogs**, **Profiler**. Secondary tools (inline debug, chart pins,
 * column ruler, format) live in a **right overflow** next to close.
 * **Open in new tab** stays in the left dock menu.
 *
 * Set `standalone` for the `?view=editor` popout window (simplified chrome).
 *
 * @module editor/EditorPane
 */

import {
  Component,
  JSX,
  Show,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
} from 'solid-js';
import { TabbedEditor } from './tabbed-editor';
import {
  store,
  isPanelOpen,
  setEditorMode,
  toggleScriptLogsPanel,
  toggleProfilerEnabled,
  toggleInlineDebugEnabled,
  toggleDebugPinsEnabled,
  toggleEditorRulerEnabled,
  toggleEditorWrapEnabled,
  toggleLibraryPanel,
  saveEditorDoc,
  isScriptRunBlockedByPreEval,
  setStatus,
} from '../store';
import { FloatableShell } from '../ui/panels/FloatableShell';
import { Icons } from '../ui/icons';
import { openEditorWindow, writeSharedDoc, bridgePublish } from './editor-bridge';
import {
  editorHasChartInstance,
  runFromEditor,
} from '../indicators/run-target';
import { countDebugPins } from '../results/debug-pins';
import { runPreevalNow } from './preevaluate';
import { formatPineSource } from './pine-format';

interface Props {
  editorRef: {
    getDoc: () => string;
    setDoc?: (doc: string) => void;
    ensureSavedForRun?: () => Promise<{ ok: boolean; doc: string }>;
  };
  /** When true, render as full-window editor (no floatable chrome) */
  standalone?: boolean;
  onRun?: (doc: string) => void;
}

/** Side panel or full-window shell for the multi-tab Pine editor. */
export const EditorPane: Component<Props> = (props) => {
  const onRun = async (doc: string, mode: 'auto' | 'new' = 'auto') => {
    if (!doc?.trim()) return;
    try {
      // Unsaved scripts are written to the library before any run
      let source = doc;
      if (props.editorRef.ensureSavedForRun) {
        const saved = await props.editorRef.ensureSavedForRun();
        if (!saved.ok) return;
        source = saved.doc || doc;
      }
      if (!source.trim()) return;
      // Final pre-eval gate (catches race if debounce has not finished)
      const pe = await runPreevalNow(source);
      if (pe.hasErrors) return;
      if (isScriptRunBlockedByPreEval()) return;
      // Parent may override (e.g. app shell) — still pass through doc only for auto
      if (props.onRun && mode === 'auto') {
        props.onRun(source);
        return;
      }
      void runFromEditor(source, { mode });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error', msg || 'Run failed');
    }
  };

  const runBlocked = () => isScriptRunBlockedByPreEval();

  /** Reactive: pre-eval source + chart scripts decide Run vs Re-run label. */
  const hasChartInstance = () => {
    void store.scripts.length;
    void store.resultsFocusId;
    const src = store.preEval?.source || props.editorRef.getDoc?.() || '';
    return editorHasChartInstance(src);
  };

  const popoutLiveEditor = (mode: 'popup' | 'tab' = 'popup') => {
    try {
      const doc = props.editorRef.getDoc?.() || '';
      writeSharedDoc(doc);
      saveEditorDoc(doc);
      setEditorMode('popout');
      openEditorWindow(mode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error', msg || 'Could not open editor window');
    }
  };

  /** Chart pin count from last run (shown next to Pins when enabled). */
  const pinCount = createMemo(() => {
    if (!store.debugPinsEnabled || store.lastRun == null) return 0;
    return countDebugPins(store.lastRun, { bars: store.bars });
  });

  // Alt-P toggles pins when focus is outside CodeMirror (CM has its own Alt-p map).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'p' && e.key !== 'P') return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // CM keymap owns Alt-P while the editor is focused — avoid double-toggle
      if (t.closest?.('.cm-editor') || t.closest?.('.axis-pyne-editor')) return;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
        return;
      }
      e.preventDefault();
      toggleDebugPinsEnabled();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const profilerTitle = () => {
    if (!store.profilerEnabled) return 'Enable profiler and re-run for % cost gutter';
    const ms =
      store.lastRunMs != null ? ` · last run ${Math.round(store.lastRunMs)}ms` : '';
    return `Profiler on — line cost gutter; click to disable${ms}`;
  };

  const pinsTitle = () => {
    if (!store.debugPinsEnabled) {
      return 'Pin last-run log bars on the chart + editor gutter (needs bar_index or time). Alt-P';
    }
    const n = pinCount();
    return `Chart pins on (${n} ${n === 1 ? 'pin' : 'pins'}) — markers + gutter (Alt-P). Click 📍 to jump.`;
  };

  /**
   * Format active buffer (indent / whitespace).
   * Available from overflow menu + Shift+Alt+F / Mod+Shift+F in CodeMirror.
   */
  const formatActiveDoc = () => {
    try {
      const ref = props.editorRef as {
        formatDoc?: () => boolean;
        getDoc?: () => string;
        setDoc?: (d: string) => void;
      };
      if (typeof ref.formatDoc === 'function') {
        const changed = ref.formatDoc();
        const doc = ref.getDoc?.() || '';
        if (changed) {
          saveEditorDoc(doc);
          setStatus('ready', 'Formatted');
        } else {
          setStatus('ready', 'Already formatted');
        }
        return;
      }
      const doc = ref.getDoc?.() || '';
      if (!doc.trim()) {
        setStatus('ready', 'Nothing to format');
        return;
      }
      const next = formatPineSource(doc);
      if (next === doc) {
        setStatus('ready', 'Already formatted');
        return;
      }
      ref.setDoc?.(next);
      saveEditorDoc(next);
      setStatus('ready', 'Formatted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error', msg || 'Format failed');
    }
  };

  /**
   * Primary strip (left → right): Run · Library · | · Logs · Profiler
   * Labels always visible (icon + text). Secondary tools in overflow menu.
   */
  const editorTools = (
    <div
      class="axis-editor-tools"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="axis-editor-tools"
    >
      <Show when={!props.standalone}>
        <EditorToolBtn
          id="run"
          label={
            store.status === 'running'
              ? 'Running…'
              : runBlocked()
                ? 'Fix errors'
                : hasChartInstance()
                  ? 'Re-run'
                  : 'Run'
          }
          title={
            store.status === 'running'
              ? 'Script is running…'
              : runBlocked()
                ? `Fix ${store.preEval.diagnostics.filter((d) => d.severity === 'error').length || ''} script error(s) before running`
                : hasChartInstance()
                  ? 'Re-run replaces the matching script on the chart (topbar ▾ adds another instance)'
                  : 'Run script against loaded bars'
          }
          testId="axis-editor-btn-run"
          pressed={store.status === 'running'}
          disabled={runBlocked() || store.status === 'running'}
          onClick={() => {
            if (store.status === 'running' || runBlocked()) return;
            const doc = props.editorRef.getDoc?.() || '';
            if (doc.trim()) void onRun(doc, 'auto');
          }}
        >
          {hasChartInstance() && store.status !== 'running' ? (
            <Icons.refresh size={12} />
          ) : (
            <Icons.play size={12} />
          )}
        </EditorToolBtn>
        <EditorToolBtn
          id="library"
          label="Library"
          title="Script library — load / save Pine scripts"
          testId="axis-editor-btn-library"
          pressed={isPanelOpen('library')}
          onClick={() => toggleLibraryPanel()}
        >
          <Icons.folder size={12} />
        </EditorToolBtn>
        <span class="axis-editor-tools-sep" aria-hidden="true" />
      </Show>
      <EditorToolBtn
        id="scriptlogs"
        label="Logs"
        title="Scriptlogs — script log.* output (not system telemetry)"
        testId="axis-btn-scriptlogs"
        pressed={isPanelOpen('scriptlogs')}
        onClick={() => toggleScriptLogsPanel()}
      >
        <Icons.scrollText size={12} />
      </EditorToolBtn>
      <EditorToolBtn
        id="profiler"
        label="Profiler"
        title={profilerTitle()}
        testId="axis-btn-profiler"
        pressed={store.profilerEnabled}
        onClick={() => {
          const turningOn = !store.profilerEnabled;
          toggleProfilerEnabled();
          // Enabling without a fresh run never produces line stats — re-run now.
          if (turningOn) {
            const doc = props.editorRef.getDoc?.() || '';
            if (doc.trim() && !runBlocked()) {
              // Defer so store.profilerEnabled is true when runScript reads it.
              queueMicrotask(() => void onRun(doc));
            }
          }
        }}
      >
        <Icons.activity size={12} />
      </EditorToolBtn>
    </div>
  );

  /** Left hamburger: open editor in a full browser tab (dock items stay in shell). */
  const editorMenuExtra = (
    <button
      type="button"
      role="menuitem"
      class="axis-panel-menu-item"
      title="Open editor in a new browser tab"
      data-testid="axis-editor-btn-new-tab"
      onClick={() => popoutLiveEditor('tab')}
    >
      <Icons.externalLink size={14} />
      <span>Open in new tab</span>
    </button>
  );

  /** Right overflow (next to close): view / debug / format toggles. */
  const editorOverflowMenu = () => (
    <EditorOverflowMenu
      pinCount={pinCount()}
      pinsTitle={pinsTitle()}
      onToggleInlineDebug={() => toggleInlineDebugEnabled()}
      onTogglePins={() => toggleDebugPinsEnabled()}
      onToggleRuler={() => toggleEditorRulerEnabled()}
      onToggleWrap={() => toggleEditorWrapEnabled()}
      onFormat={() => formatActiveDoc()}
      onOpenLibrary={
        props.standalone ? undefined : () => toggleLibraryPanel()
      }
      libraryOpen={!props.standalone && isPanelOpen('library')}
    />
  );

  if (props.standalone) {
    return (
      <div class="flex flex-col h-full min-h-0 bg-bg-panel" data-testid="axis-editor">
        <div class="flex items-center gap-1 px-2 py-1 border-b-2 border-border bg-bg-base flex-shrink-0 min-h-[28px]">
          <span class="text-[10px] text-text-dim uppercase tracking-wider font-semibold mr-auto">
            Editor
          </span>
          {editorTools}
          {editorOverflowMenu()}
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1"
            title="Reattach to main chart window"
            aria-label="Reattach to main chart window"
            onClick={() => {
              const doc = props.editorRef.getDoc?.() || '';
              writeSharedDoc(doc);
              bridgePublish({ type: 'reattach' });
              setTimeout(() => {
                try {
                  window.close();
                } catch {
                  /* tab may ignore */
                }
              }, 120);
            }}
          >
            <Icons.panelLeft size={12} />
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-hidden">
          <TabbedEditor onRun={onRun} editorRef={props.editorRef} />
        </div>
      </div>
    );
  }

  return (
    <Show when={isPanelOpen('editor') && store.editor.mode !== 'popout'}>
      <FloatableShell
        id="editor"
        title="Editor"
        testId="axis-editor"
        class="min-h-0 h-full flex-1"
        headerExtra={editorTools}
        headerEnd={editorOverflowMenu()}
        menuExtra={editorMenuExtra}
        onPopoutWindow={() => popoutLiveEditor('popup')}
      >
        <div class="flex flex-col h-full min-h-0 flex-1 overflow-hidden">
          <TabbedEditor
            onRun={onRun}
            editorRef={props.editorRef}
            onDocChange={(doc) => {
              saveEditorDoc(doc);
            }}
          />
        </div>
      </FloatableShell>
    </Show>
  );
};

/** Right-side overflow: view toggles + format (secondary). */
const EditorOverflowMenu: Component<{
  pinCount: number;
  pinsTitle: string;
  onToggleInlineDebug: () => void;
  onTogglePins: () => void;
  onToggleRuler: () => void;
  onToggleWrap: () => void;
  onFormat: () => void;
  onOpenLibrary?: () => void;
  libraryOpen?: boolean;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  let wrapEl: HTMLDivElement | undefined;

  const close = () => setOpen(false);

  onMount(() => {
    const onDoc = (e: PointerEvent) => {
      if (!open()) return;
      const t = e.target as Node | null;
      if (wrapEl && t && wrapEl.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open()) close();
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <div
      class="axis-editor-overflow relative flex-shrink-0"
      ref={(el) => {
        wrapEl = el;
      }}
      data-testid="axis-editor-overflow"
    >
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1 axis-editor-overflow-btn ${
          open() ? 'text-accent' : ''
        }`}
        title="More editor tools"
        aria-label="More editor tools"
        aria-expanded={open()}
        aria-haspopup="menu"
        data-testid="axis-editor-overflow-btn"
        onClick={() => setOpen((v) => !v)}
      >
        <Icons.menu size={14} />
      </button>
      <Show when={open()}>
        <div
          class="axis-panel-menu-pop axis-editor-overflow-pop"
          role="menu"
          aria-label="Editor tools"
          onClick={(e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest?.('[role="menuitem"]')) close();
          }}
        >
          <Show when={props.onOpenLibrary}>
            <div class="axis-panel-menu-section">Scripts</div>
            <button
              type="button"
              role="menuitem"
              class={`axis-panel-menu-item ${
                props.libraryOpen ? 'is-active' : ''
              }`}
              title="Open script library panel"
              data-testid="axis-btn-editor-library-menu"
              onClick={() => props.onOpenLibrary?.()}
            >
              <Icons.folder size={14} />
              <span>Open library</span>
              <Show when={props.libraryOpen}>
                <Icons.check size={12} class="ml-auto opacity-80" />
              </Show>
            </button>
          </Show>
          <div class="axis-panel-menu-section">View</div>
          <button
            type="button"
            role="menuitem"
            class={`axis-panel-menu-item ${
              store.editorWrapEnabled ? 'is-active' : ''
            }`}
            title={
              store.editorWrapEnabled
                ? 'Soft wrap on — long lines wrap in the viewport'
                : 'Soft wrap off — horizontal scroll for long lines'
            }
            data-testid="axis-btn-editor-wrap"
            onClick={() => props.onToggleWrap()}
          >
            <Icons.wrapText size={14} />
            <span>Soft wrap</span>
            <Show when={store.editorWrapEnabled}>
              <Icons.check size={12} class="ml-auto opacity-80" />
            </Show>
          </button>
          <button
            type="button"
            role="menuitem"
            class={`axis-panel-menu-item ${
              store.editorRulerEnabled ? 'is-active' : ''
            }`}
            title={
              store.editorRulerEnabled
                ? 'Column ruler on — 80-character recommended line length guide'
                : 'Show 80-character recommended line length ruler'
            }
            data-testid="axis-btn-editor-ruler"
            onClick={() => props.onToggleRuler()}
          >
            <Icons.ruler size={14} />
            <span>Column ruler</span>
            <Show when={store.editorRulerEnabled}>
              <Icons.check size={12} class="ml-auto opacity-80" />
            </Show>
          </button>
          <div class="axis-panel-menu-section">Debug</div>
          <button
            type="button"
            role="menuitem"
            class={`axis-panel-menu-item ${
              store.inlineDebugEnabled ? 'is-active' : ''
            }`}
            title={
              store.inlineDebugEnabled
                ? 'Inline debug on — end-of-line log/error chips from last run'
                : 'Show last-run logs/errors inline on source lines'
            }
            data-testid="axis-btn-inline-debug"
            onClick={() => props.onToggleInlineDebug()}
          >
            <Icons.alert size={14} />
            <span>Inline debug</span>
            <Show when={store.inlineDebugEnabled}>
              <Icons.check size={12} class="ml-auto opacity-80" />
            </Show>
          </button>
          <button
            type="button"
            role="menuitem"
            class={`axis-panel-menu-item ${
              store.debugPinsEnabled ? 'is-active' : ''
            }`}
            title={props.pinsTitle}
            data-testid="axis-btn-debug-pins"
            onClick={() => props.onTogglePins()}
          >
            <Icons.pin size={14} />
            <span>
              Chart pins
              <Show when={store.debugPinsEnabled && props.pinCount > 0}>
                <span class="text-text-faint ml-1" data-testid="axis-debug-pin-count">
                  ({props.pinCount})
                </span>
              </Show>
            </span>
            <Show when={store.debugPinsEnabled}>
              <Icons.check size={12} class="ml-auto opacity-80" />
            </Show>
          </button>
          <div class="axis-panel-menu-section">Source</div>
          <button
            type="button"
            role="menuitem"
            class="axis-panel-menu-item"
            title="Format document (Shift+Alt+F)"
            data-testid="axis-btn-editor-format-menu"
            onClick={() => props.onFormat()}
          >
            <Icons.alignLeft size={14} />
            <span>Format document</span>
          </button>
        </div>
      </Show>
    </div>
  );
};

/**
 * Compact icon + always-visible label button for the editor header strip.
 * Active/pressed state is **icon/label color only** (no border / fill chrome).
 */
const EditorToolBtn: Component<{
  id: string;
  label: string;
  title: string;
  testId?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: JSX.Element;
}> = (props) => {
  return (
    <button
      type="button"
      class={`sc-btn sc-btn-ghost axis-editor-tool-btn ${
        props.pressed ? 'is-tool-on' : ''
      } ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.pressed}
      aria-disabled={props.disabled || undefined}
      disabled={props.disabled}
      data-testid={props.testId}
      data-tool-id={props.id}
      onClick={() => {
        if (props.disabled) return;
        props.onClick();
      }}
    >
      <span class="axis-editor-tool-icon" aria-hidden="true">
        {props.children}
      </span>
      <span class="axis-editor-tool-label">{props.label}</span>
    </button>
  );
};
