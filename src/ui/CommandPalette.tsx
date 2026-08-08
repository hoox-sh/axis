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
  onCleanup,
  onMount,
} from 'solid-js';
import {
  store,
  setPanelOpen,
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
  toggleLibraryPanel,
  toggleDataSourcePanel,
  toggleOnchainPanel,
  toggleProfilerEnabled,
  toggleInlineDebugEnabled,
  toggleDebugPinsEnabled,
  toggleEditorRulerEnabled,
  setChartGridMode,
  openScriptSettings,
  resetUiLayout,
  persist,
  setStore,
  updateChartSlot,
  setOnchainPanelOpen,
} from '../store';
import { runAndApply } from '../indicators/runner';
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

export type CommandPaletteProps = {
  /** Docked editor document accessor for Run Script. */
  editorRef?: { getDoc: () => string };
  onOpenSettings?: () => void;
  /** Open Settings → Theme tab (chart colors). */
  onOpenThemeSettings?: () => void;
  onOpenPlugins?: () => void;
};

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  // CodeMirror / Monaco surfaces
  if (t.closest?.('.cm-editor, .cm-content, [role="textbox"]')) return true;
  return false;
}

/** Global ⌘K command search overlay. */
export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
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
      toggleResults: () => setPanelOpen('results', !isPanelOpen('results')),
      toggleLogs: () => {
        const next = !store.logsPanel.open;
        setStore('logsPanel', 'open', next);
        setPanelOpen('logs', next);
        persist();
      },
      toggleLayers: () => toggleLayerPanel(),
      toggleIndicators: () => toggleIndicatorPanel(),
      toggleDataView: () => toggleDataViewPanel(),
      toggleAlerts: () => toggleAlertsPanel(),
      toggleScriptLogs: () => toggleScriptLogsPanel(),
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
        const doc = props.editorRef?.getDoc?.() || '';
        if (!doc.trim()) return;
        const { runPreevalNow } = await import('../editor/preevaluate');
        const pe = await runPreevalNow(doc);
        if (pe.hasErrors) return;
        await runAndApply(doc, undefined, {
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
      openPlugins: () => props.onOpenPlugins?.(),
      openScriptSettings: () => openScriptSettings(null),
      resetUiLayout: () => resetUiLayout(),
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

  const openPalette = () => {
    setQuery('');
    setActive(0);
    setOpen(true);
  };

  const closePalette = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
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

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      // Open: Ctrl/Cmd+K (allow even from inputs — standard palette UX)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        if (open()) closePalette();
        else openPalette();
        return;
      }

      if (!open()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePalette();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
        return;
      }
      if (e.key === 'Enter') {
        // Don't steal Enter from nested form controls if any
        if (isEditableTarget(e.target) && e.target !== inputEl) return;
        e.preventDefault();
        void runActive();
      }
    };

    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  createEffect(() => {
    if (open()) {
      queueMicrotask(() => inputEl?.focus());
    }
  });

  const categoryLabel = (cat?: string) => {
    if (!cat) return '';
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  return (
    <Show when={open()}>
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
                  move(1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(-1);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  void runActive();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
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
                    <Show when={cmd.shortcut}>
                      <kbd class="axis-cmd-palette-item-shortcut">{cmd.shortcut}</kbd>
                    </Show>
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
