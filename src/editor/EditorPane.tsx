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
 * layers (dock menu, float, drag-to-edge, close). Primary header tools:
 * **Run**, **Scriptlogs**, **Profiler** (slide-in labels on hover). Secondary
 * tools (inline debug, chart pins, column ruler) live in a **right hamburger**
 * next to close. **Open in new tab** stays in the left dock menu.
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
  saveEditorDoc,
} from '../store';
import { FloatableShell } from '../ui/panels/FloatableShell';
import { Icons } from '../ui/icons';
import { openEditorWindow, writeSharedDoc, bridgePublish } from './editor-bridge';
import { runAndApply } from '../indicators/runner';
import { countDebugPins } from '../results/debug-pins';

/** How long a slide-in label stays open after pointer leaves (ms). */
const EDITOR_LABEL_HOLD_MS = 2000;

interface Props {
  editorRef: { getDoc: () => string; setDoc?: (doc: string) => void };
  /** When true, render as full-window editor (no floatable chrome) */
  standalone?: boolean;
  onRun?: (doc: string) => void;
}

/** Side panel or full-window shell for the multi-tab Pine editor. */
export const EditorPane: Component<Props> = (props) => {
  const onRun = (doc: string) => {
    if (doc?.trim()) {
      props.onRun?.(doc) ?? runAndApply(doc);
    }
  };

  const popoutLiveEditor = (mode: 'popup' | 'tab' = 'popup') => {
    const doc = props.editorRef.getDoc?.() || '';
    writeSharedDoc(doc);
    saveEditorDoc(doc);
    setEditorMode('popout');
    openEditorWindow(mode);
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
      if (t.closest?.('.cm-editor') || t.closest?.('.axis-pine-editor')) return;
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
   * Icon toolbar with slide-in labels to the right on hover.
   * Label stays open while hovering; slides out 2s after leave, or immediately
   * when the pointer moves to another tool.
   */
  const [labelId, setLabelId] = createSignal<string | null>(null);
  let labelHideTimer: ReturnType<typeof setTimeout> | null = null;

  const clearLabelHideTimer = () => {
    if (labelHideTimer != null) {
      clearTimeout(labelHideTimer);
      labelHideTimer = null;
    }
  };

  const showToolLabel = (id: string) => {
    clearLabelHideTimer();
    setLabelId(id);
  };

  const scheduleHideToolLabel = (id: string) => {
    clearLabelHideTimer();
    labelHideTimer = setTimeout(() => {
      labelHideTimer = null;
      // Only hide if still the same tool (next-button hover will have changed it)
      if (labelId() === id) setLabelId(null);
    }, EDITOR_LABEL_HOLD_MS);
  };

  onCleanup(() => clearLabelHideTimer());

  /** Primary strip: Run · Logs · Profiler only. */
  const editorTools = (
    <div
      class="axis-editor-tools"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="axis-editor-tools"
    >
      <Show when={!props.standalone}>
        <EditorToolBtn
          id="run"
          label={store.status === 'running' ? 'Running…' : 'Run'}
          title={
            store.status === 'running'
              ? 'Script is running…'
              : 'Run script against loaded bars'
          }
          testId="axis-editor-btn-run"
          pressed={store.status === 'running'}
          open={labelId() === 'run'}
          onShow={() => showToolLabel('run')}
          onScheduleHide={() => scheduleHideToolLabel('run')}
          onClick={() => {
            if (store.status === 'running') return;
            const doc = props.editorRef.getDoc?.() || '';
            if (doc.trim()) onRun(doc);
          }}
        >
          <Icons.play size={12} />
        </EditorToolBtn>
      </Show>
      <EditorToolBtn
        id="scriptlogs"
        label="Logs"
        title="Scriptlogs — script log.* output (not system telemetry)"
        testId="axis-btn-scriptlogs"
        pressed={isPanelOpen('scriptlogs')}
        open={labelId() === 'scriptlogs'}
        onShow={() => showToolLabel('scriptlogs')}
        onScheduleHide={() => scheduleHideToolLabel('scriptlogs')}
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
        open={labelId() === 'profiler'}
        onShow={() => showToolLabel('profiler')}
        onScheduleHide={() => scheduleHideToolLabel('profiler')}
        onClick={() => {
          const turningOn = !store.profilerEnabled;
          toggleProfilerEnabled();
          // Enabling without a fresh run never produces line stats — re-run now.
          if (turningOn) {
            const doc = props.editorRef.getDoc?.() || '';
            if (doc.trim()) {
              // Defer so store.profilerEnabled is true when runScript reads it.
              queueMicrotask(() => onRun(doc));
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

  /** Right overflow (next to close): secondary editor tools. */
  const editorOverflowMenu = () => (
    <EditorOverflowMenu
      pinCount={pinCount()}
      onToggleInlineDebug={() => toggleInlineDebugEnabled()}
      onTogglePins={() => toggleDebugPinsEnabled()}
      onToggleRuler={() => toggleEditorRulerEnabled()}
      pinsTitle={pinsTitle()}
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

/** Right-side hamburger: secondary editor tools (debug / pins / ruler). */
const EditorOverflowMenu: Component<{
  pinCount: number;
  pinsTitle: string;
  onToggleInlineDebug: () => void;
  onTogglePins: () => void;
  onToggleRuler: () => void;
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
        </div>
      </Show>
    </div>
  );
};

/**
 * Icon button with a label that slides in to the right when `open`.
 * Active/pressed state is **icon color only** (no border / fill chrome).
 */
const EditorToolBtn: Component<{
  id: string;
  label: string;
  title: string;
  testId?: string;
  pressed?: boolean;
  open: boolean;
  onShow: () => void;
  onScheduleHide: () => void;
  onClick: () => void;
  children: JSX.Element;
}> = (props) => {
  return (
    <button
      type="button"
      class={`sc-btn sc-btn-ghost axis-editor-tool-btn ${
        props.pressed ? 'is-tool-on' : ''
      } ${props.open ? 'is-label-open' : ''}`}
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.pressed}
      data-testid={props.testId}
      data-tool-id={props.id}
      onPointerEnter={() => props.onShow()}
      onPointerLeave={() => props.onScheduleHide()}
      onFocus={() => props.onShow()}
      onBlur={() => props.onScheduleHide()}
      onClick={() => props.onClick()}
    >
      <span class="axis-editor-tool-icon" aria-hidden="true">
        {props.children}
      </span>
      <span class="axis-editor-tool-label">{props.label}</span>
    </button>
  );
};
