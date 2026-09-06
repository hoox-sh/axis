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
 * Global command palette (TradingView-style ⌘K / Ctrl+K).
 *
 * - Opens via Ctrl/Cmd+K (document capture); Escape / backdrop closes
 * - Fuzzy filter via {@link filterCommands} over {@link buildDefaultCommands}
 * - ArrowUp/Down + Enter to run; does not steal keys while closed
 *
 * Mount once from the product shell (`app.tsx`). Optional hooks let the
 * parent open settings/plugins and run the docked editor document.
 *
 * @module ui/CommandPalette
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import {
  store,
  isPanelOpen,
  setWatchlistOpen,
  setEditorOpen,
  setEditorMode,
  toggleTheme,
  setChartThemePreset,
  toggleIndicatorPanel,
  toggleDataViewPanel,
  toggleLayerPanel,
  toggleAlertsPanel,
  toggleScriptLogsPanel,
  toggleSystemLogsPanel,
  toggleStatusBarPanel,
  toggleLibraryPanel,
  setLibraryPanelOpen,
  toggleDataSourcePanel,
  toggleOnchainPanel,
  toggleProfilerEnabled,
  toggleInlineDebugEnabled,
  toggleDebugPinsEnabled,
  toggleEditorRulerEnabled,
  setChartGridMode,
  setDrawingTool,
  resetShortcuts,
  openScriptSettings,
  resetUiLayout,
  persist,
  setStore,
  updateChartSlot,
  setOnchainPanelOpen,
} from '../store';
import { runFromEditor } from '../indicators/run-target';
import { loadSymbolData, reloadChart } from '../data/load-symbol';
import { startLive, stopLive, defaultStreamForSource } from '../streams/multiplex';
import {
  clearAllOnchainSeries,
  clearOnchainEvents,
  refreshAllAttachedTvl,
  exportAllOnchainSeriesCsv,
} from '../onchain/manager';
import { attachPopularTvl } from '../onchain/presets';
import { kickOnchainHealthProbe } from '../onchain/health';
import {
  buildDefaultCommands,
  filterCommands,
  type CommandDef,
} from './command-registry';
import {
  toggleBrowserFullscreen,
  toggleChartOnlyMode,
  toggleChartOnlyFullscreen,
} from './presentation';
import { openAboutModal } from './AboutModal';
import {
  isPaletteOpen,
  openPalette,
  closePalette,
} from './shortcuts/palette-bridge';
import { getDisplay } from './shortcuts/registry';
import { detectPlatform } from './shortcuts/keys';
import type { ShortcutId } from './shortcuts/types';
import { PINE_SNIPPETS } from './shortcuts/pine-snippets';
import { THEME_PRESETS } from '../theme/presets';

/** Optional host hooks (e.g. desktop shell git bridge). */
type AxisHostWindow = Window & {
  axisGitPush?: () => void | Promise<void>;
  axisGitPull?: () => void | Promise<void>;
};

function emitWindowEvent(name: string, detail?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
  } catch {
    /* test DOM without CustomEvent */
  }
}

/**
 * Command id → bindable shortcut id. Palette chips render the *live* chord
 * (respecting user overrides + platform) instead of a static literal.
 */
const COMMAND_SHORTCUT_IDS: Readonly<Record<string, ShortcutId>> = {
  'action.run': 'app.run',
  'editor.save-library': 'app.save',
  'editor.goto-line': 'editor.goto-line',
  'help.shortcuts': 'app.show-shortcuts',
  'help.reset-shortcuts': 'palette.reset-shortcuts',
  'snippet.insert': 'palette.insert-snippet',
  'search.across': 'palette.find-across',
  'scripts.recent': 'palette.recent',
  'theme.cycle': 'palette.theme-cycle',
  'workspace.snapshot': 'palette.snapshot',
  'panel.compact': 'palette.compact-panels',
  'panel.focus-editor': 'panel.focus-editor',
  'panel.focus-chart': 'panel.focus-chart',
  'draw.trend': 'chart.tool-trend',
  'draw.fib': 'chart.tool-fib',
  'draw.rect': 'chart.tool-rect',
  'draw.text': 'chart.tool-text',
  'draw.hline': 'chart.tool-hline',
  'draw.brush': 'chart.tool-brush',
};

/** Resolve the live shortcut hint for a command (falls back to static). */
function liveShortcutFor(cmd: { id: string; shortcut?: string }): string | undefined {
  const sid = COMMAND_SHORTCUT_IDS[cmd.id];
  if (sid) {
    const live = getDisplay(sid, store.shortcuts?.overrides ?? {}, detectPlatform());
    if (live) return live;
  }
  return cmd.shortcut;
}

export type CommandPaletteProps = {
  /** Docked editor document accessor for Run Script. */
  editorRef?: {
    getDoc: () => string;
    ensureSavedForRun?: () => Promise<{ ok: boolean; doc: string }>;
    /** Insert text at the current selection (snippet picker). */
    insertAtCursor?: (text: string) => boolean;
  };
  onOpenSettings?: () => void;
  /** Open Settings → Theme tab (chart colors). */
  onOpenThemeSettings?: () => void;
  /** Open Settings → Editor tab (lint / hover / complete). */
  onOpenEditorSettings?: () => void;
  onOpenPlugins?: () => void;
  /** Open Workers catalog page. */
  onOpenWorkers?: () => void;
  /** Open Runtime page. */
  onOpenRuntime?: () => void;
  /** Open studio overlay (last page). */
  onOpenStudio?: () => void;
  /** Open Architecture (compose-recipe) modal. */
  onOpenArchitecture?: () => void;
};

/** Global ⌘K command search overlay. */
export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  const [snippetPickerOpen, setSnippetPickerOpen] = createSignal(false);
  let inputEl: HTMLInputElement | undefined;
  let listEl: HTMLDivElement | undefined;

  const commands = createMemo((): CommandDef[] => {
    const host =
      typeof window !== 'undefined' ? (window as AxisHostWindow) : (undefined as AxisHostWindow | undefined);

    return buildDefaultCommands({
      toggleWatchlist: () => setWatchlistOpen(!isPanelOpen('watchlist')),
      toggleEditor: () => {
        if (store.editor.mode === 'popout') {
          setEditorMode('docked');
          setEditorOpen(true);
          return;
        }
        setEditorOpen(!isPanelOpen('editor'));
      },
      toggleResults: () => setStore('resultsPanel', 'open', !store.resultsPanel.open),
      toggleLogs: () => toggleSystemLogsPanel(),
      toggleLayers: () => toggleLayerPanel(),
      toggleIndicators: () => toggleIndicatorPanel(),
      toggleDataView: () => toggleDataViewPanel(),
      toggleAlerts: () => toggleAlertsPanel(),
      toggleScriptLogs: () => toggleScriptLogsPanel(),
      toggleStatusBar: () => toggleStatusBarPanel(),
      toggleLibrary: () => toggleLibraryPanel(),
      toggleDataSource: () => toggleDataSourcePanel(),
      toggleOnchain: () => toggleOnchainPanel(),
      openOnchain: () => setOnchainPanelOpen(true),
      clearAllOnchainSeries: () => clearAllOnchainSeries(),
      clearOnchainEvents: () => clearOnchainEvents(),
      kickOnchainHealth: () => kickOnchainHealthProbe(),
      refreshAllAttachedTvl: () => void refreshAllAttachedTvl(),
      exportOnchainSeries: () => exportAllOnchainSeriesCsv(),
      attachPopularTvl: () => void attachPopularTvl(5),
      toggleTheme: () => toggleTheme(),
      setChartThemePreset: (id) => setChartThemePreset(id),
      setChartGridMode: (mode) => setChartGridMode(mode),
      runScript: async () => {
        let doc = props.editorRef?.getDoc?.() || '';
        if (!doc.trim()) return;
        // Save unsaved buffer to the library before running
        if (props.editorRef?.ensureSavedForRun) {
          const saved = await props.editorRef.ensureSavedForRun();
          if (!saved.ok) return;
          doc = saved.doc || doc;
        }
        if (!doc.trim()) return;
        const { runPreevalNow, isScriptRunBlocked } = await import('../editor/preevaluate');
        await runPreevalNow(doc);
        if (isScriptRunBlocked()) return;
        await runFromEditor(doc, {
          mode: 'auto',
          inputs: store.editorInputValues || {},
        });
      },
      focusSymbol: () => {
        const el = document.getElementById('axis-symbol') as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
        }
      },
      loadSymbol: async () => {
        const sym = store.symbol.trim().toUpperCase();
        if (!sym) {
          const el = document.getElementById('axis-symbol') as HTMLInputElement | null;
          el?.focus();
          return;
        }
        setStore('symbol', sym);
        const aid = store.chartLayout?.activeId;
        if (aid) updateChartSlot(aid, { symbol: sym });
        persist();
        await loadSymbolData(sym, store.interval, store.source);
      },
      reloadChart: async () => {
        await reloadChart();
      },
      toggleLive: () => {
        if (store.live.active) stopLive();
        else {
          const streamId = store.live.streamId || defaultStreamForSource(store.source);
          startLive(streamId, store.symbol, store.interval);
        }
      },
      openSettings: () => props.onOpenSettings?.(),
      openThemeSettings: () =>
        props.onOpenThemeSettings?.() ?? props.onOpenSettings?.(),
      openEditorSettings: () =>
        props.onOpenEditorSettings?.() ?? props.onOpenSettings?.(),
      openPlugins: () => props.onOpenPlugins?.(),
      openWorkers: () => props.onOpenWorkers?.(),
      openRuntime: () => props.onOpenRuntime?.(),
      openStudio: () => props.onOpenStudio?.() ?? props.onOpenRuntime?.(),
      openArchitecture: () => props.onOpenArchitecture?.(),
      openScriptSettings: () => openScriptSettings(null),
      openOptimise: () => {
        setStore('resultsPanel', 'open', true);
        window.dispatchEvent(new CustomEvent('axis-results-tab', { detail: { tab: 'optimise' } }));
      },
      openAbout: () => openAboutModal(),
      resetUiLayout: () => resetUiLayout(),
      toggleFullscreen: () => void toggleBrowserFullscreen(),
      toggleChartOnly: () => toggleChartOnlyMode(),
      toggleChartOnlyFullscreen: () => void toggleChartOnlyFullscreen(),
      // Editor power commands
      toggleEditorRuler: () => toggleEditorRulerEnabled(),
      toggleInlineDebug: () => toggleInlineDebugEnabled(),
      toggleDebugPins: () => toggleDebugPinsEnabled(),
      toggleProfiler: () => toggleProfilerEnabled(),
      jumpToLine: () => {
        const raw = window.prompt('Go to line', '1');
        if (raw == null) return;
        const line = Number.parseInt(String(raw).trim(), 10);
        if (!Number.isFinite(line) || line < 1) return;
        setEditorOpen(true);
        emitWindowEvent('axis-editor-goto-line', { line });
      },
      saveToLibrary: () => {
        setEditorOpen(true);
        emitWindowEvent('axis-editor-save-library');
      },
      focusEditor: () => {
        setEditorOpen(true);
        queueMicrotask(() => {
          const el =
            document.querySelector<HTMLElement>('.axis-pyne-editor .cm-content') ||
            document.querySelector<HTMLElement>('.cm-content') ||
            document.querySelector<HTMLElement>('[data-testid="axis-pyne-editor"]');
          el?.focus?.();
        });
      },
      focusChart: () => {
        queueMicrotask(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="axis-chart-pane"]');
          el?.focus?.();
        });
      },
      openShortcuts: () => emitWindowEvent('axis-open-shortcuts'),
      resetShortcuts: () => {
        resetShortcuts();
        emitWindowEvent('axis-shortcuts-reset');
      },
      insertSnippet: (id) => {
        if (id) {
          const snippet = PINE_SNIPPETS.find((s) => s.id === id);
          if (snippet) {
            setEditorOpen(true);
            queueMicrotask(() => {
              props.editorRef?.insertAtCursor?.(snippet.code);
            });
          }
          return;
        }
        // No id → open the snippet sub-palette
        setSnippetPickerOpen(true);
      },
      findAcrossScripts: () => {
        setLibraryPanelOpen(true);
        emitWindowEvent('axis-library-find');
      },
      openRecentScripts: () => {
        setLibraryPanelOpen(true);
        emitWindowEvent('axis-library-recent');
      },
      cycleTheme: () => {
        const current = store.chartTheme?.presetId || 'void-dark';
        const idx = THEME_PRESETS.findIndex((p) => p.id === current);
        const next = THEME_PRESETS[(idx + 1) % THEME_PRESETS.length];
        setChartThemePreset(next.id);
      },
      saveWorkspaceSnapshot: () => {
        persist();
        emitWindowEvent('axis-workspace-snapshot-save');
      },
      loadWorkspaceSnapshot: () => emitWindowEvent('axis-workspace-snapshot-load'),
      selectDrawingTool: (id) => {
        const tool = id as Parameters<typeof setDrawingTool>[0];
        setDrawingTool(tool);
      },
      toggleCompactPanels: () => emitWindowEvent('axis-panels-compact'),
      // Prefer host bridge when present; else fire editor events (EditorGitBar / tabbed-editor).
      gitPush: () => {
        if (typeof host?.axisGitPush === 'function') {
          void host.axisGitPush();
          return;
        }
        setEditorOpen(true);
        emitWindowEvent('axis-editor-git-push');
      },
      gitPull: () => {
        if (typeof host?.axisGitPull === 'function') {
          void host.axisGitPull();
          return;
        }
        setEditorOpen(true);
        emitWindowEvent('axis-editor-git-pull');
      },
    });
  });

  const results = createMemo(() => filterCommands(commands(), query()));

  // Keep highlight in range when filter shrinks
  createEffect(() => {
    const n = results().length;
    if (active() >= n) setActive(n > 0 ? n - 1 : 0);
  });

  // Reset search state whenever the palette opens (Hub may open it directly).
  createEffect(() => {
    if (isPaletteOpen()) {
      setQuery('');
      setActive(0);
      setSnippetPickerOpen(false);
    }
  });

  const runSnippet = (snippet: (typeof PINE_SNIPPETS)[number]) => {
    setSnippetPickerOpen(false);
    closePalette();
    setEditorOpen(true);
    queueMicrotask(() => {
      props.editorRef?.insertAtCursor?.(snippet.code);
    });
  };

  const runCommand = async (cmd: CommandDef | undefined) => {
    if (!cmd) return;
    closePalette();
    try {
      await cmd.run();
    } catch {
      // Actions log their own errors; palette must not throw into the UI tree
    }
  };

  const runActive = async () => {
    await runCommand(results()[active()]);
  };

  const move = (delta: number) => {
    const n = results().length;
    if (n <= 0) return;
    setActive((i) => (i + delta + n * 8) % n);
    queueMicrotask(() => {
      const el = listEl?.querySelector<HTMLElement>(`[data-cmd-index="${active()}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  // Keyboard dispatch moved to the shortcut Hub (Mod-K / Esc) and the
  // palette input's own onKeyDown (arrows / Enter / Esc while focused).

  createEffect(() => {
    if (isPaletteOpen()) {
      queueMicrotask(() => inputEl?.focus());
    }
  });

  const categoryLabel = (cat?: string) => {
    if (!cat) return '';
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  return (
    <Show when={isPaletteOpen()}>
      <div
        class="axis-cmd-palette-backdrop"
        role="presentation"
        data-testid="axis-command-palette-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) closePalette();
        }}
      >
        <div
          class="axis-cmd-palette sc-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          data-testid="axis-command-palette"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div class="sc-dialog-accent" />
          <div class="axis-cmd-palette-search">
            <input
              ref={inputEl}
              type="text"
              class="axis-cmd-palette-input"
              placeholder="Search commands…"
              value={query()}
              spellcheck={false}
              autocomplete="off"
              aria-autocomplete="list"
              aria-controls="axis-cmd-list"
              data-testid="axis-command-palette-input"
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                // Local handling so CM / other capture listeners don't fight
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (snippetPickerOpen()) return;
                  move(1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (snippetPickerOpen()) return;
                  move(-1);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (snippetPickerOpen()) {
                    const first = PINE_SNIPPETS[0];
                    if (first) runSnippet(first);
                    return;
                  }
                  void runActive();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  if (snippetPickerOpen()) {
                    setSnippetPickerOpen(false);
                    return;
                  }
                  closePalette();
                }
              }}
            />
            <kbd class="axis-cmd-palette-kbd" title="Close">
              esc
            </kbd>
          </div>

          <div
            id="axis-cmd-list"
            class="axis-cmd-palette-list"
            role="listbox"
            aria-label="Commands"
            ref={listEl}
          >
            <Show
              when={snippetPickerOpen()}
              fallback={
                <Show
                  when={results().length > 0}
                  fallback={
                    <div class="axis-cmd-palette-empty" data-testid="axis-command-palette-empty">
                      No matching commands
                    </div>
                  }
                >
                  <For each={results()}>
                    {(cmd, i) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={i() === active()}
                        data-cmd-id={cmd.id}
                        data-cmd-index={i()}
                        data-testid={`axis-cmd-${cmd.id}`}
                        class={`axis-cmd-palette-item ${i() === active() ? 'is-active' : ''}`}
                        onMouseEnter={() => setActive(i())}
                        onClick={() => {
                          setActive(i());
                          void runCommand(cmd);
                        }}
                      >
                        <span class="axis-cmd-palette-item-main">
                          <span class="axis-cmd-palette-item-title">{cmd.title}</span>
                          <Show when={cmd.category}>
                            <span class="axis-cmd-palette-item-cat">
                              {categoryLabel(cmd.category)}
                            </span>
                          </Show>
                        </span>
                        <Show when={liveShortcutFor(cmd)}>
                          <kbd class="axis-cmd-palette-item-shortcut">
                            {liveShortcutFor(cmd)}
                          </kbd>
                        </Show>
                      </button>
                    )}
                  </For>
                </Show>
              }
            >
              <For each={PINE_SNIPPETS}>
                {(snippet) => (
                  <button
                    type="button"
                    role="option"
                    data-testid={`axis-snippet-${snippet.id}`}
                    class="axis-cmd-palette-item"
                    onClick={() => runSnippet(snippet)}
                  >
                    <span class="axis-cmd-palette-item-main">
                      <span class="axis-cmd-palette-item-title">{snippet.title}</span>
                      <span class="axis-cmd-palette-item-cat">{snippet.description}</span>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>

          <div class="axis-cmd-palette-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> run
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
};
