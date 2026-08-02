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
 * script settings, command palette (⌘K), panel drag ghost.
 *
 * ## Boot (`onMount`)
 * - Theme + UI scale; restore dynamic plugins; optional default symbol load
 * - Prefetch / idle-warm Pyodide assets
 * - Subscribe to editor-bridge (popout run/doc/reattach) and panel window bridge
 *
 * ## Drag-and-drop
 * Dropping `.pyne` / `.pine` / `.pinescript` files anywhere on the shell saves
 * them to the active script library and opens the first file in the editor.
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
import { AlertsPanel } from './ui/AlertsPanel';
import { LibraryPanel } from './ui/ScriptLibraryPanel';
import { CommandPalette } from './ui/CommandPalette';
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
  setStatus,
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
import { filterPineFiles, importPineFiles } from './storage/import-pine-files';

/** Primary charting workspace component mounted by `index.tsx`. */
export const App: Component = () => {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [pluginsOpen, setPluginsOpen] = createSignal(false);
  const [catalogTick, setCatalogTick] = createSignal(0);
  /** File drag-over highlight for .pine drop-to-library. */
  const [pineDropActive, setPineDropActive] = createSignal(false);

  // Shared mutable ref — PineEditor / TabbedEditor populate on mount
  const editorRef: {
    getDoc: () => string;
    setDoc?: (doc: string) => void;
    loadLibraryDoc?: (doc: string, name?: string, libraryId?: string) => void;
    loadLibraryDocs?: (
      docs: Array<{ content: string; name?: string; libraryId?: string }>,
    ) => void;
  } = {
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

    /**
     * Window-level file drop (capture).
     * Must always preventDefault on dragover+drop of Files — otherwise the
     * browser navigates away and shows the raw file (default OS drop).
     * JSX handlers on the root div are not enough: canvas / CodeMirror /
     * portals often sit outside or swallow events.
     */
    const isFileDragEvent = (e: DragEvent): boolean => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      const types = dt.types;
      if (types) {
        // DOMStringList or string[] depending on engine
        if (typeof (types as DOMStringList).contains === 'function') {
          if ((types as DOMStringList).contains('Files')) return true;
        }
        for (let i = 0; i < types.length; i++) {
          if (types[i] === 'Files') return true;
        }
      }
      return !!(dt.files && dt.files.length > 0);
    };

    const handlePineImport = async (pine: File[]) => {
      try {
        const result = await importPineFiles(pine);
        const n = result.imported.length;
        if (n > 0) {
          const names = result.imported.map((d) => d.meta.name).join(', ');
          const lineHint = result.imported
            .map((d) => {
              const lines = d.content.split(/\r?\n/).length;
              return `${d.meta.name} (${lines} ln)`;
            })
            .join(', ');
          setStatus(
            'ready',
            n === 1
              ? `Saved "${names}" to script library`
              : `Saved ${n} scripts to library · opened ${n} tabs`,
          );
          appendLog(
            'ok',
            n === 1
              ? `Imported pine file → library: ${lineHint}`
              : `Imported ${n} pine files → library + tabs: ${lineHint}`,
            'library',
          );
          // Open every imported script as its own editor tab (full body from import)
          try {
            const docs = result.imported.map((d) => ({
              content: d.content,
              name: d.meta.name,
              libraryId: d.meta.id,
            }));
            if (editorRef.loadLibraryDocs) {
              editorRef.loadLibraryDocs(docs);
            } else if (editorRef.loadLibraryDoc) {
              const first = docs[0]!;
              editorRef.loadLibraryDoc(first.content, first.name, first.libraryId);
            } else {
              editorRef.setDoc?.(docs[0]!.content);
            }
            setEditorOpen(true);
          } catch {
            /* open is best-effort */
          }
        }
        if (result.warnings.length) {
          const w = result.warnings[0]!;
          // Truncation chrome is common for TV community copies — surface clearly
          setStatus('error', w.length > 160 ? `${w.slice(0, 157)}…` : w);
          for (const line of result.warnings.slice(0, 5)) {
            appendLog('warn', line, 'library');
          }
        }
        if (result.errors.length) {
          const msg = result.errors.slice(0, 3).join('; ');
          setStatus('error', `Pine import: ${msg}`);
          appendLog('error', `Pine import errors: ${msg}`, 'library');
        }
        if (!n && !result.errors.length) {
          setStatus('error', 'No Pine scripts found in drop');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('error', `Pine import failed: ${msg}`);
        appendLog('error', `Pine import failed: ${msg}`, 'library');
      }
    };

    const onWinDragEnter = (e: DragEvent) => {
      if (!isFileDragEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPineDropActive(true);
    };

    const onWinDragOver = (e: DragEvent) => {
      if (!isFileDragEvent(e)) return;
      // Required every dragover tick — without this, drop never becomes a drop
      // and the browser opens the file as a plain-text navigation.
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (!pineDropActive()) setPineDropActive(true);
    };

    const onWinDragLeave = (e: DragEvent) => {
      if (!isFileDragEvent(e)) return;
      // relatedTarget null ≈ left the window
      const leavingWindow =
        e.relatedTarget === null ||
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight;
      if (leavingWindow) setPineDropActive(false);
    };

    const onWinDrop = (e: DragEvent) => {
      if (!isFileDragEvent(e)) return;
      // Always cancel browser file-open navigation for any file drop on AXIS.
      e.preventDefault();
      e.stopPropagation();
      setPineDropActive(false);

      const files = e.dataTransfer?.files;
      if (!files?.length) return;

      const pine = filterPineFiles(files);
      if (!pine.length) {
        const names = Array.from(files)
          .map((f) => f.name)
          .slice(0, 3)
          .join(', ');
        setStatus('error', `Not a PYNE script (need .pyne / .pine / .pinescript): ${names}`);
        appendLog('warn', `Ignored non-script drop: ${names}`, 'library');
        return;
      }
      void handlePineImport(pine);
    };

    // Capture phase so we run before canvas / CM / nested handlers.
    const winOpts: AddEventListenerOptions = { capture: true };
    window.addEventListener('dragenter', onWinDragEnter, winOpts);
    window.addEventListener('dragover', onWinDragOver, winOpts);
    window.addEventListener('dragleave', onWinDragLeave, winOpts);
    window.addEventListener('drop', onWinDrop, winOpts);

    onCleanup(() => {
      unsub();
      unsubPanelWin();
      window.removeEventListener('dragenter', onWinDragEnter, winOpts);
      window.removeEventListener('dragover', onWinDragOver, winOpts);
      window.removeEventListener('dragleave', onWinDragLeave, winOpts);
      window.removeEventListener('drop', onWinDrop, winOpts);
    });
  });

  return (
    <div class="h-screen flex flex-col bg-bg-base text-text overflow-hidden relative">
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
      <AlertsPanel />
      <DataViewPanel />
      <IndicatorPanel />
      <LibraryPanel
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

      {/* Global ⌘K / Ctrl+K command palette */}
      <CommandPalette
        editorRef={editorRef}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPlugins={() => setPluginsOpen(true)}
      />

      {/* Drop .pyne / .pine / .pinescript files anywhere → script library */}
      <Show when={pineDropActive()}>
        <div
          class="absolute inset-0 z-[900] flex items-center justify-center pointer-events-none bg-void/75 backdrop-blur-[2px]"
          data-testid="axis-pine-drop-overlay"
          aria-hidden="true"
        >
          <div class="border-2 border-dashed border-accent bg-bg-panel/95 px-8 py-6 text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] rounded-[var(--radius-sc)] max-w-md">
            <div class="text-accent text-sm font-medium tracking-wide mb-1">
              Drop to add to script library
            </div>
            <div class="text-text-dim text-[11px] font-mono">
              .pyne · .pine · .pinescript
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
