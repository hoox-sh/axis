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
 * layers (dock menu, float, drag-to-edge, close). Header extras host
 * **Scriptlogs** and **Profiler** toggles (editor-owned tools, not topbar).
 *
 * Set `standalone` for the `?view=editor` popout window (simplified chrome).
 *
 * @module editor/EditorPane
 */

import { Component, Show } from 'solid-js';
import { TabbedEditor } from './tabbed-editor';
import {
  store,
  isPanelOpen,
  setEditorMode,
  toggleScriptLogsPanel,
  toggleProfilerEnabled,
  saveEditorDoc,
} from '../store';
import { FloatableShell } from '../ui/panels/FloatableShell';
import { Icons } from '../ui/icons';
import { openEditorWindow, writeSharedDoc, bridgePublish } from './editor-bridge';
import { runAndApply } from '../indicators/runner';

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

  const editorTools = (
    <div
      class="flex items-center gap-0.5 flex-shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="axis-editor-tools"
    >
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1.5 text-[10px] ${
          isPanelOpen('scriptlogs') ? 'text-accent' : ''
        }`}
        title="Scriptlogs — script log.* output (not system telemetry)"
        aria-pressed={isPanelOpen('scriptlogs')}
        data-testid="axis-btn-scriptlogs"
        onClick={() => toggleScriptLogsPanel()}
      >
        <Icons.scrollText size={12} />
        Scriptlogs
      </button>
      <button
        type="button"
        class={`sc-btn sc-btn-ghost px-1.5 text-[10px] ${
          store.profilerEnabled ? 'text-accent border-accent' : ''
        }`}
        title={
          store.profilerEnabled
            ? 'Profiler on — re-run script for line costs; click to disable'
            : 'Enable profiler — then re-run for % cost gutter'
        }
        aria-pressed={store.profilerEnabled}
        data-testid="axis-btn-profiler"
        onClick={() => toggleProfilerEnabled()}
      >
        <Icons.activity size={12} />
        Profiler
        <Show when={store.profilerEnabled && store.lastRunMs != null}>
          <span class="font-mono opacity-80">
            · {Math.round(store.lastRunMs!)}ms
          </span>
        </Show>
      </button>
    </div>
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
            class="sc-btn sc-btn-ghost px-1.5 text-[10px]"
            title="Reattach to main chart window"
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
            ⬅ Reattach
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
        class="min-h-0"
        headerExtra={editorTools}
        onPopoutWindow={() => popoutLiveEditor('popup')}
      >
        <div class="flex flex-col h-full min-h-0 overflow-hidden">
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
