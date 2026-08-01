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
 * Main AXIS product shell (Solid root when not in editor-popout view).
 *
 * ## Layout
 * Topbar → flex row (left dock | chart | right dock) → bottom dock → system
 * logs → status bar. Dock columns are portal hosts: open panels stack
 * **one below the other** on the same side. Overlay: settings, plugins,
 * script settings, panel drag ghost.
 *
 * ## Boot (`onMount`)
 * - Theme + UI scale; restore dynamic plugins; optional default symbol load
 * - Prefetch / idle-warm Pyodide assets
 * - Subscribe to editor-bridge (popout run/doc/reattach) and panel window bridge
 *
 * Built-ins register at module load (`registerBuiltins`) before first paint.
 */

import { Component, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { Topbar } from './ui/Topbar';
import { StatusBar } from './ui/StatusBar';
import { Watchlist } from './ui/Watchlist';
import { ChartWorkspace } from './chart/ChartWorkspace';
import { EditorPane } from './editor/EditorPane';
import { IndicatorPanel } from './indicators/IndicatorPanel';
import { SettingsDialog } from './ui/SettingsDialog';
import { ScriptSettingsModal } from './ui/ScriptSettingsModal';
import { ResultsPanel } from './ui/ResultsPanel';
import { SystemLogs } from './ui/SystemLogs';
import { ScriptLogsPanel } from './ui/ScriptLogsPanel';
import { PluginManager } from './ui/PluginManager';
import { DataViewPanel } from './ui/DataViewPanel';
import { LayerPanel } from './ui/LayerPanel';
import { runAndApply } from './indicators/runner';
import { registerBuiltins } from './plugins/bootstrap';
import { restoreInstalledPlugins } from './plugins/loader';

// Ensure built-in source/stream/engine plugins are registered before first paint.
registerBuiltins();
import {
  store,
  setEditorOpen,
  setEditorMode,
  setWatchlistOpen,
  saveEditorDoc,
  appendLog,
  applyUiScale,
} from './store';
import {
  PanelDragOverlay,
  installPanelWindowBridge,
} from './ui/panels/FloatableShell';
import { DockColumn, FloatRoot } from './ui/panels/DockColumn';
import {
  bridgeSubscribe,
  bridgePublish,
  writeSharedDoc,
  readSharedDoc,
} from './editor/editor-bridge';
import { loadSymbolData } from './data/load-symbol';
import { prefetchPyodideAssets, preloadPyodide } from './engines/catalog';

/** Primary charting workspace component mounted by `index.tsx`. */
export const App: Component = () => {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [pluginsOpen, setPluginsOpen] = createSignal(false);
  const [catalogTick, setCatalogTick] = createSignal(0);

  // Shared mutable ref — PineEditor populates getDoc/setDoc on mount
  const editorRef: { getDoc: () => string; setDoc?: (doc: string) => void } = {
    getDoc: () => '',
  };

  onMount(() => {
    document.documentElement.setAttribute('data-theme', store.theme);
    applyUiScale(store.uiScale);
    document.title = 'AXIS';
    appendLog(
      'ok',
      `AXIS ready · scale ${Math.round((store.uiScale || 1) * 100)}% · void chrome`,
      'boot',
    );
    restoreInstalledPlugins()
      .then(() => setCatalogTick((n) => n + 1))
      .catch(() => {});
    // Auto-load default symbol so the chart is not an empty void on first paint
    if (!store.bars.length && store.source !== 'csv-upload') {
      void loadSymbolData(store.symbol, store.interval, store.source);
    }
    // Pyodide: warm same-origin assets immediately; full init on idle (or ASAP if selected).
    // preloadPyodide only updates ENG HUD when pyodide is the active engine.
    prefetchPyodideAssets();
    const warmPyodide = () => {
      void preloadPyodide();
    };
    if (store.engine === 'pyodide' || store.activePlugins?.engine === 'pyodide') {
      warmPyodide();
    } else if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
        }
      ).requestIdleCallback(warmPyodide, { timeout: 5000 });
    } else {
      setTimeout(warmPyodide, 2000);
    }
    bridgePublish({ type: 'hello', role: 'main' });

    // If we reloaded while popout was open, stay in docked until popout says hello
    // (mode may be stale from localStorage)
    if (store.editor.mode === 'popout') {
      // keep mode; docked editor hidden until reattach or popout-closed
    }

    const unsub = bridgeSubscribe((msg) => {
      if (msg.type === 'popout-opened') {
        setEditorMode('popout');
      }
      if (msg.type === 'popout-closed') {
        setEditorMode('docked');
        setEditorOpen(true);
        // Restore doc from shared storage
        const doc = readSharedDoc();
        if (doc && editorRef.setDoc) editorRef.setDoc(doc);
      }
      if (msg.type === 'run') {
        // External editor requested a run — execute on main (has chart + bars)
        runAndApply(msg.doc).then((result) => {
          bridgePublish({
            type: 'run-status',
            status: result?.status || 'done',
            message: result?.error || store.statusMessage,
          });
        });
      }
      if (msg.type === 'doc') {
        saveEditorDoc(msg.doc);
        if (store.editor.mode === 'docked' && editorRef.setDoc) {
          if (msg.doc !== editorRef.getDoc()) editorRef.setDoc(msg.doc);
        }
      }
      if (msg.type === 'reattach') {
        setEditorMode('docked');
        setEditorOpen(true);
        const doc = readSharedDoc();
        if (doc && editorRef.setDoc) editorRef.setDoc(doc);
      }
      if (msg.type === 'hello' && msg.role === 'editor') {
        setEditorMode('popout');
        // Push current doc if main still has it
        const doc = editorRef.getDoc() || readSharedDoc();
        if (doc) writeSharedDoc(doc);
      }
    });

    const unsubPanelWin = installPanelWindowBridge();
    onCleanup(() => {
      unsub();
      unsubPanelWin();
    });
  });

  return (
    <div class="h-screen flex flex-col bg-bg-base text-text overflow-hidden">
      <Topbar
        onToggleEditor={() => {
          if (store.editor.mode === 'popout') {
            // Bring back docked
            setEditorMode('docked');
            setEditorOpen(true);
            return;
          }
          setEditorOpen(!store.editor.open);
        }}
        onToggleWatchlist={() => setWatchlistOpen(!store.watchlist.open)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPlugins={() => setPluginsOpen(true)}
        catalogTick={catalogTick()}
        editorRef={editorRef}
      />

      {/* Main workspace: dock columns claim flex space; chart fills the middle */}
      <div class="flex-1 flex min-h-0 min-w-0 overflow-hidden" data-axis-workspace>
        {/* Left dock column — panels portal in and stack vertically */}
        <DockColumn side="left" />

        {/* Center: chart shrinks when left/right columns open (not overlaid) */}
        <div class="flex-1 flex min-w-0 min-h-0 overflow-hidden bg-bg-base relative">
          <ChartWorkspace />

          {/* Popout placeholder when editor is external */}
          <Show when={store.editor.mode === 'popout'}>
            <div class="absolute bottom-3 right-3 z-20 flex items-center gap-2 px-2.5 py-1.5 bg-bg-panel border-2 border-accent text-[11px] text-accent shadow-[0_4px_20px_rgba(0,0,0,0.45)]">
              <span>Editor detached</span>
              <button
                class="sc-btn sc-btn-primary px-2 py-0.5 text-[10px]"
                onClick={() => {
                  setEditorMode('docked');
                  setEditorOpen(true);
                  bridgePublish({ type: 'reattach' });
                  const doc = readSharedDoc();
                  if (doc && editorRef.setDoc) editorRef.setDoc(doc);
                }}
              >
                Reattach
              </button>
            </div>
          </Show>
        </div>

        {/* Right dock column — editor / indicators / etc. stack */}
        <DockColumn side="right" />
      </div>

      {/* Bottom dock — results / logs / scriptlogs stack one below the other */}
      <DockColumn side="bottom" />

      {/* Float portal host before panel trees so first paint can attach */}
      <FloatRoot />

      {/* Panel Solid trees (DOM portaled into dock columns / float root) */}
      <Watchlist />
      <LayerPanel />
      <DataViewPanel />
      <IndicatorPanel />
      <EditorPane
        editorRef={editorRef}
        onRun={(doc) => {
          if (doc?.trim()) {
            runAndApply(doc, undefined, {
              inputs: store.editorInputValues || {},
            });
          }
        }}
      />
      <ResultsPanel />
      <ScriptLogsPanel />

      <SystemLogs />
      <StatusBar />

      {/* Skeleton ghost + dock zones while dragging a panel handle */}
      <PanelDragOverlay />

      <SettingsDialog open={settingsOpen()} onClose={() => setSettingsOpen(false)} />
      <ScriptSettingsModal />
      <PluginManager
        open={pluginsOpen()}
        onClose={() => setPluginsOpen(false)}
        onChanged={() => setCatalogTick((n) => n + 1)}
        getDoc={() => editorRef.getDoc()}
        setDoc={(doc, name) => {
          const ref = editorRef as {
            setDoc?: (d: string) => void;
            loadLibraryDoc?: (d: string, n?: string) => void;
          };
          if (ref.loadLibraryDoc) ref.loadLibraryDoc(doc, name);
          else ref.setDoc?.(doc);
        }}
      />
    </div>
  );
};
