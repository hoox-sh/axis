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
 * layers (dock menu, float, drag-to-edge, close). Header tools are compact
 * icons with **slide-in labels** on hover (Run, Scriptlogs, Profiler, Debug,
 * Pins, Ruler). **Open in new tab** lives in the left hamburger menu.
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
          /* Accent only while this run is executing — idle stays ghost */
          primary={store.status === 'running'}
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
        label="Scriptlogs"
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
      <EditorToolBtn
        id="inline-debug"
        label="Inline debug"
        title={
          store.inlineDebugEnabled
            ? 'Inline debug on — end-of-line log/error chips from last run (click pin-able chips to jump to bar)'
            : 'Show last-run logs/errors inline on source lines (needs line refs)'
        }
        testId="axis-btn-inline-debug"
        pressed={store.inlineDebugEnabled}
        open={labelId() === 'inline-debug'}
        onShow={() => showToolLabel('inline-debug')}
        onScheduleHide={() => scheduleHideToolLabel('inline-debug')}
        onClick={() => toggleInlineDebugEnabled()}
      >
        <Icons.alert size={12} />
      </EditorToolBtn>
      <EditorToolBtn
        id="debug-pins"
        label="Chart pins"
        title={pinsTitle()}
        testId="axis-btn-debug-pins"
        pressed={store.debugPinsEnabled}
        open={labelId() === 'debug-pins'}
        onShow={() => showToolLabel('debug-pins')}
        onScheduleHide={() => scheduleHideToolLabel('debug-pins')}
        onClick={() => toggleDebugPinsEnabled()}
      >
        <Icons.pin size={12} />
        <Show when={store.debugPinsEnabled && pinCount() > 0}>
          <span class="sr-only" data-testid="axis-debug-pin-count">
            {pinCount()} pins
          </span>
        </Show>
      </EditorToolBtn>
      <EditorToolBtn
        id="ruler"
        label="Column ruler"
        title={
          store.editorRulerEnabled
            ? 'Column ruler on — 80-character recommended line length guide'
            : 'Show 80-character recommended line length ruler'
        }
        testId="axis-btn-editor-ruler"
        pressed={store.editorRulerEnabled}
        open={labelId() === 'ruler'}
        onShow={() => showToolLabel('ruler')}
        onScheduleHide={() => scheduleHideToolLabel('ruler')}
        onClick={() => toggleEditorRulerEnabled()}
      >
        <Icons.ruler size={12} />
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

  if (props.standalone) {
    return (
      <div class="flex flex-col h-full min-h-0 bg-bg-panel" data-testid="axis-editor">
        <div class="flex items-center gap-1 px-2 py-1 border-b-2 border-border bg-bg-base flex-shrink-0 min-h-[28px]">
          <span class="text-[10px] text-text-dim uppercase tracking-wider font-semibold mr-auto">
            Editor
          </span>
          {editorTools}
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

/** Icon button with a label that slides in to the right when `open`. */
const EditorToolBtn: Component<{
  id: string;
  label: string;
  title: string;
  testId?: string;
  primary?: boolean;
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
      class={`sc-btn axis-editor-tool-btn ${
        props.primary ? 'sc-btn-primary' : 'sc-btn-ghost'
      } ${props.pressed ? 'text-accent border-accent' : ''} ${
        props.open ? 'is-label-open' : ''
      }`}
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
