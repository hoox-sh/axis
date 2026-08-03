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
 * layers (dock menu, float, drag-to-edge, close). Header tools are **icon-only**
 * (Run, Scriptlogs, Profiler, Debug, Pins, Ruler). **Open in new tab** lives
 * in the left hamburger menu with dock options.
 *
 * Set `standalone` for the `?view=editor` popout window (simplified chrome).
 *
 * @module editor/EditorPane
 */

import { Component, Show, createMemo, onMount, onCleanup } from 'solid-js';
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

  /** Icon-only toolbar — labels live in title / aria-label to avoid header overflow. */
  const editorTools = (
    <div
      class="axis-editor-tools"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="axis-editor-tools"
    >
      <Show when={!props.standalone}>
        <button
          type="button"
          class="sc-btn sc-btn-primary px-1"
          title="Run script against loaded bars"
          aria-label="Run"
          data-testid="axis-editor-btn-run"
          onClick={() => {
            const doc = props.editorRef.getDoc?.() || '';
            if (doc.trim()) onRun(doc);
          }}
        >
          <Icons.play size={12} />
        </button>
      </Show>
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1 ${
          isPanelOpen('scriptlogs') ? 'text-accent' : ''
        }`}
        title="Scriptlogs — script log.* output (not system telemetry)"
        aria-label="Scriptlogs"
        aria-pressed={isPanelOpen('scriptlogs')}
        data-testid="axis-btn-scriptlogs"
        onClick={() => toggleScriptLogsPanel()}
      >
        <Icons.scrollText size={12} />
      </button>
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1 ${
          store.profilerEnabled ? 'text-accent border-accent' : ''
        }`}
        title={profilerTitle()}
        aria-label="Profiler"
        aria-pressed={store.profilerEnabled}
        data-testid="axis-btn-profiler"
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
      </button>
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1 ${
          store.inlineDebugEnabled ? 'text-accent border-accent' : ''
        }`}
        title={
          store.inlineDebugEnabled
            ? 'Inline debug on — end-of-line log/error chips from last run (click pin-able chips to jump to bar)'
            : 'Show last-run logs/errors inline on source lines (needs line refs)'
        }
        aria-label="Inline debug"
        aria-pressed={store.inlineDebugEnabled}
        data-testid="axis-btn-inline-debug"
        onClick={() => toggleInlineDebugEnabled()}
      >
        <Icons.alert size={12} />
      </button>
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1 ${
          store.debugPinsEnabled ? 'text-accent border-accent' : ''
        }`}
        title={pinsTitle()}
        aria-label="Chart pins"
        aria-pressed={store.debugPinsEnabled}
        data-testid="axis-btn-debug-pins"
        onClick={() => toggleDebugPinsEnabled()}
      >
        <Icons.pin size={12} />
        <Show when={store.debugPinsEnabled && pinCount() > 0}>
          <span
            class="sr-only"
            data-testid="axis-debug-pin-count"
          >
            {pinCount()} pins
          </span>
        </Show>
      </button>
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1 ${
          store.editorRulerEnabled ? 'text-accent border-accent' : ''
        }`}
        title={
          store.editorRulerEnabled
            ? 'Column ruler on — 80-character recommended line length guide'
            : 'Show 80-character recommended line length ruler'
        }
        aria-label="Column ruler"
        aria-pressed={store.editorRulerEnabled}
        data-testid="axis-btn-editor-ruler"
        onClick={() => toggleEditorRulerEnabled()}
      >
        <Icons.ruler size={12} />
      </button>
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
