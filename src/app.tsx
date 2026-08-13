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
 * workers manager, architecture (Wire), script settings, command palette (⌘K),
 * panel drag ghost.
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

import {
  Component,
  createSignal,
  onMount,
  onCleanup,
  Show,
  ErrorBoundary,
  lazy,
  Suspense,
} from 'solid-js';
import { Topbar } from './ui/Topbar';
import { StatusBar } from './ui/StatusBar';
import { Watchlist } from './ui/Watchlist';
import { ChartWorkspace } from './chart/ChartWorkspace';
import { IndicatorPanel } from './indicators/IndicatorPanel';
import { type SettingsTabId } from './ui/SettingsDialog';
import { ResultsPanel } from './ui/ResultsPanel';
import { SystemLogs } from './ui/SystemLogs';
import { ScriptLogsPanel } from './ui/ScriptLogsPanel';
import { DataViewPanel } from './ui/DataViewPanel';
import { LayerPanel } from './ui/LayerPanel';
import { errorFallback } from './ui/ErrorFallback';
import { ErrorShareToast } from './ui/ErrorShareToast';
import { reportUiError } from './ui/boot-errors';
import { registerBuiltins } from './plugins/bootstrap';
import { restoreInstalledPlugins } from './plugins/loader';

// Heavy / rarely-open UI — split out of the first paint graph
const EditorPane = lazy(() =>
  import('./editor/EditorPane').then((m) => ({ default: m.EditorPane })),
);
const SettingsDialog = lazy(() =>
  import('./ui/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
);
const ScriptSettingsModal = lazy(() =>
  import('./ui/ScriptSettingsModal').then((m) => ({ default: m.ScriptSettingsModal })),
);
const RuntimesHub = lazy(() =>
  import('./ui/RuntimesHub').then((m) => ({ default: m.RuntimesHub })),
);
const ArchitectureModal = lazy(() =>
  import('./ui/ArchitectureModal').then((m) => ({ default: m.ArchitectureModal })),
);
const AlertsPanel = lazy(() =>
  import('./ui/AlertsPanel').then((m) => ({ default: m.AlertsPanel })),
);
const LibraryPanel = lazy(() =>
  import('./ui/ScriptLibraryPanel').then((m) => ({ default: m.LibraryPanel })),
);
const DataSourceManagerPanel = lazy(() =>
  import('./ui/DataSourceManagerPanel').then((m) => ({ default: m.DataSourceManagerPanel })),
);
const OnChainPanel = lazy(() =>
  import('./ui/OnChainPanel').then((m) => ({ default: m.OnChainPanel })),
);
const CommandPalette = lazy(() =>
  import('./ui/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const AboutModal = lazy(() =>
  import('./ui/AboutModal').then((m) => ({ default: m.AboutModal })),
);

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
import { filterPyneFiles } from './storage/import-pyne-files';
import { importAndOpenPyneFiles } from './storage/import-pyne-open';
import { isTauriShell } from './desktop/is-tauri';
import { applyThemeToDocument } from './theme';
import {
  installPresentationControls,
  setPresentationRoot,
} from './ui/presentation';

/** Primary charting workspace component mounted by `index.tsx`. */
export const App: Component = () => {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsTab, setSettingsTab] = createSignal<SettingsTabId>('general');
  const openSettings = (tab: SettingsTabId = 'general') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  /** Unified Runtimes hub (Status = workers, Plugins = catalog/library). */
  const [runtimesOpen, setRuntimesOpen] = createSignal(false);
  const [runtimesSection, setRuntimesSection] = createSignal<'status' | 'plugins'>(
    'status',
  );
  const openRuntimes = (section: 'status' | 'plugins' = 'status') => {
    setRuntimesSection(section);
    setRuntimesOpen(true);
  };
  const [architectureOpen, setArchitectureOpen] = createSignal(false);
  const [catalogTick, setCatalogTick] = createSignal(0);
  /** File drag-over highlight for .pine drop-to-library. */
  const [pineDropActive, setPineDropActive] = createSignal(false);

  // Shared mutable ref — PyneEditor / TabbedEditor populate on mount
  const editorRef: {
    getDoc: () => string;
    setDoc?: (doc: string) => void;
    loadLibraryDoc?: (doc: string, name?: string, libraryId?: string) => void;
    loadLibraryDocs?: (
      docs: Array<{ content: string; name?: string; libraryId?: string }>,
    ) => void;
    isUnsaved?: () => boolean;
    ensureSavedForRun?: () => Promise<{ ok: boolean; doc: string }>;
  } = {
    getDoc: () => '',
  };

  onMount(() => {
    // Full chrome + chart CSS vars (not only data-theme)
    applyThemeToDocument(store.chartTheme);
    applyUiScale(store.uiScale);
    document.title = 'AXIS';
    // Fullscreen API + chart-only shortcuts (F11 / Shift+F / Esc)
    const unsubPresentation = installPresentationControls();
    appendLog(
      'ok',
      `AXIS ready · scale ${Math.round((store.uiScale || 1) * 100)}% · void chrome`,
      'boot',
    );
    restoreInstalledPlugins()
      .then(() => setCatalogTick((n) => n + 1))
      .catch((err: unknown) => {
        reportUiError(err, {
          source: 'plugins',
          context: 'Plugin restore failed',
          status: true,
        });
      });
    // Auto-load default symbol so the chart is not an empty void on first paint
    if (!store.bars.length && store.source !== 'csv-upload') {
      void loadSymbolData(store.symbol, store.interval, store.source).catch((err: unknown) => {
        reportUiError(err, {
          source: 'data',
          context: 'Initial symbol load failed',
          status: true,
        });
      });
    }
    // Pyodide: only warm when selected (or user switches later via Workers Manager).
    // Avoid ~14MB download contention on server-engine boots.
    if (store.engine === 'pyodide' || store.activePlugins?.engine === 'pyodide') {
      prefetchPyodideAssets();
      void preloadPyodide();
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
        void import('./indicators/run-target')
          .then(({ runFromEditor }) =>
            runFromEditor(msg.doc, {
              mode: 'auto',
              inputs: store.editorInputValues || {},
            }),
          )
          .then((result) => {
            bridgePublish({
              type: 'run-status',
              status: result?.status || 'done',
              message: result?.error || store.statusMessage,
            });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            reportUiError(err, {
              source: 'run',
              context: 'Popout run failed',
              status: true,
            });
            bridgePublish({
              type: 'run-status',
              status: 'error',
              message,
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
        // DOMStringList (legacy) or readonly string[] — duck-type .contains
        const withContains = types as { contains?: (s: string) => boolean };
        if (typeof withContains.contains === 'function' && withContains.contains('Files')) {
          return true;
        }
        for (let i = 0; i < types.length; i++) {
          if (types[i] === 'Files') return true;
        }
      }
      return !!(dt.files && dt.files.length > 0);
    };

    const handlePineImport = async (pine: File[]) => {
      await importAndOpenPyneFiles(pine, { editorRef, emptyContext: 'drop' });
    };

    // Tauri desktop: File → Open Script… / Help → About
    // Dynamic import keeps @tauri-apps/* out of the PWA static graph.
    let unsubDesktop: (() => void) | undefined;
    if (isTauriShell()) {
      void import('./desktop/shell')
        .then(({ installDesktopShell }) => installDesktopShell({ editorRef }))
        .then((off) => {
          unsubDesktop = off;
        })
        .catch((err: unknown) => {
          console.warn('[axis-desktop] shell install failed', err);
        });
    }

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

      const pine = filterPyneFiles(files);
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
      unsubDesktop?.();
      unsubPresentation();
      setPresentationRoot(null);
      window.removeEventListener('dragenter', onWinDragEnter, winOpts);
      window.removeEventListener('dragover', onWinDragOver, winOpts);
      window.removeEventListener('dragleave', onWinDragLeave, winOpts);
      window.removeEventListener('drop', onWinDrop, winOpts);
    });
  });

  return (
    <div
      class="h-screen flex flex-col bg-bg-base text-text overflow-hidden relative"
      data-axis-app
      data-fullscreen={store.presentation?.fullscreen ? '1' : '0'}
      data-chart-only={store.presentation?.chartOnly ? '1' : '0'}
      ref={(el) => setPresentationRoot(el)}
    >
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
        onOpenSettings={() => openSettings('general')}
        onOpenPlugins={() => openRuntimes('plugins')}
        onOpenWorkers={() => openRuntimes('status')}
        onOpenArchitecture={() => setArchitectureOpen(true)}
        catalogTick={catalogTick()}
        editorRef={editorRef}
      />

      {/* Main workspace: dock columns claim flex space; chart fills the middle */}
      <div class="flex-1 flex min-h-0 min-w-0 overflow-hidden" data-axis-workspace>
        {/* Left dock column — panels portal in and stack vertically */}
        <DockColumn side="left" />

        {/* Center: chart shrinks when left/right columns open (not overlaid).
            Nested ErrorBoundary keeps topbar/status alive if chart host dies. */}
        <div class="flex-1 flex min-w-0 min-h-0 overflow-hidden bg-bg-base relative">
          <ErrorBoundary
            fallback={errorFallback({
              variant: 'inline',
              source: 'chart',
              title: 'Chart failed',
              onError: (err) =>
                reportUiError(err, {
                  source: 'chart',
                  context: 'Chart workspace error',
                  status: true,
                }),
            })}
          >
            <ChartWorkspace />
          </ErrorBoundary>

          {/* Popout placeholder when editor is external */}
          <Show when={store.editor.mode === 'popout' && !store.presentation?.chartOnly}>
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
      <Suspense fallback={null}>
        <AlertsPanel />
        <LibraryPanel
          getDoc={() => editorRef.getDoc()}
          setDoc={(doc, name, libraryId) => {
            const ref = editorRef as {
              setDoc?: (d: string) => void;
              loadLibraryDoc?: (d: string, n?: string, id?: string) => void;
            };
            if (ref.loadLibraryDoc) ref.loadLibraryDoc(doc, name, libraryId);
            else ref.setDoc?.(doc);
          }}
        />
        <DataSourceManagerPanel />
        <OnChainPanel />
        {/* CodeMirror / editor chrome — only fetch when docked editor is open */}
        <Show when={store.editor.open && store.editor.mode !== 'popout'}>
          <EditorPane
            editorRef={editorRef}
            onRun={(doc) => {
              // EditorPane already ensureSavedForRun before calling onRun
              if (doc?.trim()) {
                void import('./indicators/run-target')
                  .then(({ runFromEditor }) =>
                    runFromEditor(doc, {
                      mode: 'auto',
                      inputs: store.editorInputValues || {},
                    }),
                  )
                  .catch((err: unknown) => {
                    reportUiError(err, {
                      source: 'run',
                      context: 'Run failed',
                      status: true,
                    });
                  });
              }
            }}
          />
        </Show>
      </Suspense>
      <ResultsPanel />
      <ScriptLogsPanel />

      <SystemLogs />
      <StatusBar />

      {/* Opt-in error diagnostic share (telemetry.shareOnError) */}
      <ErrorShareToast />

      {/* Skeleton ghost + dock zones while dragging a panel handle */}
      <PanelDragOverlay />

      <Suspense fallback={null}>
        <Show when={settingsOpen()}>
          <SettingsDialog
            open={settingsOpen()}
            initialTab={settingsTab()}
            onClose={() => setSettingsOpen(false)}
          />
        </Show>
        <ScriptSettingsModal />
        <Show when={runtimesOpen()}>
          <RuntimesHub
            open={runtimesOpen()}
            initialSection={runtimesSection()}
            onClose={() => setRuntimesOpen(false)}
            onChanged={() => setCatalogTick((n) => n + 1)}
            getDoc={() => editorRef.getDoc()}
            setDoc={(doc, name, libraryId) => {
              const ref = editorRef as {
                setDoc?: (d: string) => void;
                loadLibraryDoc?: (d: string, n?: string, id?: string) => void;
              };
              if (ref.loadLibraryDoc) ref.loadLibraryDoc(doc, name, libraryId);
              else ref.setDoc?.(doc);
            }}
          />
        </Show>
        <Show when={architectureOpen()}>
          <ArchitectureModal
            open={architectureOpen()}
            onClose={() => setArchitectureOpen(false)}
            onApplied={() => setCatalogTick((n) => n + 1)}
          />
        </Show>
        {/* Global ⌘K / Ctrl+K command palette */}
        <CommandPalette
          editorRef={editorRef}
          onOpenSettings={() => openSettings('general')}
          onOpenThemeSettings={() => openSettings('theme')}
          onOpenPlugins={() => openRuntimes('plugins')}
          onOpenWorkers={() => openRuntimes('status')}
          onOpenArchitecture={() => setArchitectureOpen(true)}
        />
        {/* About AXIS — logo click / Help → About / command palette */}
        <AboutModal />
      </Suspense>

      {/* Drop .pyne / .pine / .pinescript files anywhere → script library */}
      <Show when={pineDropActive()}>
        <div
          class="absolute inset-0 z-[900] flex items-center justify-center pointer-events-none bg-void/75 backdrop-blur-[2px]"
          data-testid="axis-pyne-drop-overlay"
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
