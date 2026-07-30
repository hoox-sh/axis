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
 * Main workspace top bar — symbol, interval, source/stream/engine, load/run/live,
 * upload, theme, and panel toggles (editor, watchlist, indicators, data window,
 * layers, settings, plugins). Scriptlogs + Profiler live on the editor header.
 *
 * ## Actions
 * - **Load** → `loadSymbolData` (historical via active source)
 * - **Run** → `runAndApply(editorRef.getDoc())`
 * - **Live** → multiplex `startLive` / `stopLive`
 * - **Popout editor** → `openEditorWindow` + shared doc bridge
 *
 * Plugin pickers re-read catalogs when `catalogTick` bumps (after plugin install).
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import {
  store,
  setStore,
  setStatus,
  toggleTheme,
  persist,
  setChartType,
  setEditorOpen,
  setEditorMode,
  setActivePlugin,
  toggleIndicatorPanel,
  toggleDataViewPanel,
  toggleLayerPanel,
  openScriptSettings,
} from '../store';
import { CHART_TYPES } from '../chart/chart-type';
import { runAndApply } from '../indicators/runner';
import { startLive, stopLive, listStreams, defaultStreamForSource } from '../streams/multiplex';
import { loadSymbolData } from '../data/load-symbol';
import { parseOhlcvFile } from '../data/parse-bars';
import { openEditorWindow, writeSharedDoc } from '../editor/editor-bridge';
import { listSources } from '../sources/catalog';
import { listEngines, preloadPyodide } from '../engines/catalog';
import { setUploadedBars, getUploadedFileName } from '../sources/upload-store';
import { engineOptionLabel } from './plugin-badges';
import { Icons } from './icons';
import { HooxLogo } from './HooxLogo';
import { HooxLoader } from './HooxLoader';
import { WATCHLIST_INTERVALS } from '../data/watchlist-tickers';

const INTERVALS = [...WATCHLIST_INTERVALS];

/**
 * Workspace top chrome. Parent owns settings/plugins modals and editor ref.
 */
export const Topbar: Component<{
  onToggleEditor: () => void;
  onToggleWatchlist: () => void;
  onOpenSettings: () => void;
  onOpenPlugins?: () => void;
  /** Bump when plugin catalog changes */
  catalogTick?: number;
  editorRef: { getDoc: () => string };
}> = (props) => {
  const sources = createMemo(() => {
    void props.catalogTick;
    return listSources();
  });
  const streams = createMemo(() => {
    void props.catalogTick;
    return listStreams();
  });
  const engines = createMemo(() => {
    void props.catalogTick;
    return listEngines();
  });
  const [loading, setLoading] = createSignal(false);
  const [uploadLabel, setUploadLabel] = createSignal(getUploadedFileName() || '');
  let fileInput: HTMLInputElement | undefined;

  const loadHistorical = async () => {
    if (loading()) return;
    setLoading(true);
    try {
      await loadSymbolData(store.symbol, store.interval, store.source);
    } finally {
      setLoading(false);
    }
  };

  const onSourceChange = (id: string) => {
    setActivePlugin('source', id);
    // Align default live stream with source (mock → mock-poll)
    const streamId = defaultStreamForSource(id);
    setActivePlugin('stream', streamId);
    // CSV needs a file first — nudge the picker
    if (id === 'csv-upload' && !getUploadedFileName()) {
      fileInput?.click();
    }
  };

  const onFilePicked = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const bars = await parseOhlcvFile(file);
      setUploadedBars(bars, file.name);
      setUploadLabel(file.name);
      setStore('source', 'csv-upload');
      persist();
      await loadSymbolData(store.symbol, store.interval, 'csv-upload');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error', `Upload failed: ${msg}`);
    } finally {
      setLoading(false);
      // allow re-selecting the same file
      input.value = '';
    }
  };

  const onRun = async () => {
    const doc = props.editorRef.getDoc();
    if (!doc?.trim()) return;
    await runAndApply(doc, undefined, {
      inputs: store.editorInputValues || {},
    });
  };

  const toggleLive = () => {
    const next = !store.live.active;
    if (next) {
      const streamId = store.live.streamId || defaultStreamForSource(store.source);
      startLive(streamId, store.symbol, store.interval);
    } else {
      stopLive();
    }
  };

  const detachEditor = (mode: 'popup' | 'tab') => {
    const doc = props.editorRef.getDoc?.() || '';
    writeSharedDoc(doc);
    setEditorMode('popout');
    setEditorOpen(false);
    openEditorWindow(mode);
  };

  const sourceNeedsSymbol = () => store.source !== 'csv-upload' && store.source !== 'mock-walk';

  return (
    <header
      class="flex items-center gap-[var(--ui-gap-sm)] px-2.5 py-1 bg-bg-panel border-b-2 border-border flex-shrink-0 min-h-[var(--ui-topbar-min-h)] flex-wrap"
      data-testid="axis-topbar"
    >
      <div
        class="flex items-center gap-1.5 mr-0.5 min-w-0"
        data-testid="axis-brand"
        title="HOOX · AXIS"
      >
        <HooxLogo size="xs" class="text-text flex-shrink-0" data-testid="axis-hoox-logo" />
        <div class="font-semibold text-[1em] text-text tracking-tight leading-none">
          AXIS
          <span class="text-text-faint font-normal text-[0.78em] ml-1.5 tracking-wide">
            chart
          </span>
        </div>
      </div>

      <span class="sc-sep" aria-hidden="true" />

      <button
        class={`sc-btn sc-btn-ghost ${store.watchlist.open ? 'text-accent' : ''}`}
        onClick={props.onToggleWatchlist}
        title="Toggle watchlist"
      >
        <Icons.list />
        List
      </button>

      <span class="sc-sep" aria-hidden="true" />

      <label class="sc-label hidden sm:inline">Source</label>
      <select
        class="sc-input min-w-[7.5em]"
        data-testid="axis-select-source"
        value={store.source}
        onChange={(e) => onSourceChange(e.currentTarget.value)}
        title={sources().find((s) => s.id === store.source)?.description || 'Historical data source'}
      >
        <For each={sources()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
      </select>

      <Show when={store.source === 'csv-upload'}>
        <button
          class="sc-btn sc-btn-ghost max-w-[12em]"
          title={uploadLabel() || 'Upload CSV or JSON OHLCV'}
          onClick={() => fileInput?.click()}
        >
          <Icons.upload />
          <span class="truncate">{uploadLabel() || 'Upload…'}</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          class="hidden"
          onChange={onFilePicked}
        />
      </Show>

      <Show when={sourceNeedsSymbol()}>
        <label class="sc-label hidden sm:inline" for="axis-symbol">
          Symbol
        </label>
        <input
          id="axis-symbol"
          class="sc-input min-w-[6.5em] font-mono uppercase"
          value={store.symbol}
          spellcheck={false}
          autocomplete="off"
          onChange={(e) => {
            setStore('symbol', e.currentTarget.value.toUpperCase());
            persist();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') loadHistorical();
          }}
          onBlur={() => {
            // Reload if symbol was edited without Enter
            if (store.symbol && store.bars.length === 0) void loadHistorical();
          }}
          title="Symbol · Enter to load"
        />
      </Show>

      <Show when={store.source !== 'csv-upload'}>
        <label class="sc-label hidden sm:inline" for="axis-interval">
          Interval
        </label>
        <select
          id="axis-interval"
          class="sc-input min-w-[3.5em]"
          value={store.interval}
          title="Bar interval · reloads chart"
          onChange={(e) => {
            const next = e.currentTarget.value;
            setStore('interval', next);
            persist();
            // Auto-reload so interval changes always paint
            if (store.source !== 'csv-upload') {
              void loadSymbolData(store.symbol, next, store.source);
            }
          }}
        >
          <For each={INTERVALS}>{(i) => <option value={i}>{i}</option>}</For>
        </select>
      </Show>

      <label class="sc-label hidden sm:inline" for="axis-chart-type">
        Type
      </label>
      <select
        id="axis-chart-type"
        class="sc-input min-w-[5.5em]"
        data-testid="axis-select-chart-type"
        value={store.chartType}
        title={
          CHART_TYPES.find((t) => t.id === store.chartType)?.description ||
          'Price chart style'
        }
        onChange={(e) => setChartType(e.currentTarget.value)}
      >
        <For each={[...CHART_TYPES]}>
          {(t) => (
            <option value={t.id} title={t.description}>
              {t.short}
            </option>
          )}
        </For>
      </select>

      <button
        class={`sc-btn ${loading() ? 'opacity-50' : ''}`}
        onClick={loadHistorical}
        disabled={loading()}
        data-testid="axis-btn-load"
        title={
          store.source === 'csv-upload'
            ? 'Reload last uploaded file'
            : `Load bars from ${store.source}`
        }
      >
        {loading() ? <HooxLoader size="xs" /> : <Icons.download />}
        {loading() ? 'Loading…' : 'Load'}
      </button>

      <span class="sc-sep" aria-hidden="true" />

      <label class="sc-label hidden sm:inline">Engine</label>
      <select
        class="sc-input min-w-[7.5em] max-w-[12em]"
        data-testid="axis-select-engine"
        value={store.engine}
        onChange={(e) => {
          const id = e.currentTarget.value;
          setActivePlugin('engine', id);
          if (id === 'pyodide') {
            void preloadPyodide();
          }
        }}
        title={
          store.engine === 'pyodide'
            ? 'RUN=browser (Pyodide) · ENG=local — first load often 20–30s. HUD: ENG / RUN / MODE.'
            : engines().find((en) => en.id === store.engine)?.description ||
              'Calculation engine — maps to HUD ENG (local|remote) + RUN (browser|server|worker)'
        }
      >
        <For each={engines()}>
          {(en) => (
            <option
              value={en.id}
              title={
                en.id === 'pyodide'
                  ? 'ENG local · RUN browser (Pyodide)'
                  : en.id === 'server'
                    ? 'ENG local|remote (from endpoint) · RUN server (or worker if URL is edge)'
                    : en.description
              }
            >
              {engineOptionLabel(en)}
            </option>
          )}
        </For>
      </select>

      <label class="sc-label hidden sm:inline">Stream</label>
      <select
        class="sc-input min-w-[7em]"
        value={store.live.streamId}
        disabled={store.live.active}
        onChange={(e) => {
          setActivePlugin('stream', e.currentTarget.value);
        }}
        title="Live data stream (disabled while Live is on)"
      >
        <For each={streams()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
      </select>

      <button
        class={`sc-btn ${store.live.active ? 'border-accent-2 text-accent-2' : ''}`}
        onClick={toggleLive}
        title={store.live.active ? 'Stop live stream' : 'Start live stream'}
      >
        {store.live.active ? (
          <Icons.wifi class="text-accent-2" />
        ) : (
          <Icons.wifiOff />
        )}
        Live
      </button>

      <div class="flex-1 min-w-2" />

      <button
        class="sc-btn sc-btn-primary"
        onClick={onRun}
        data-testid="axis-btn-run"
        title="Run (or use detached editor)"
      >
        <Icons.play />
        Run
      </button>

      <span class="sc-sep" aria-hidden="true" />

      <button
        class={`sc-btn sc-btn-ghost ${
          store.editor.open && store.editor.mode === 'docked' ? 'text-accent' : ''
        }`}
        onClick={props.onToggleEditor}
        title="Toggle docked editor"
      >
        <Icons.panelRight />
        Editor
        {store.editor.mode === 'popout' && (
          <span class="text-orange ml-0.5 text-[0.72em]">ext</span>
        )}
      </button>

      <button
        class="sc-btn sc-btn-ghost px-1.5"
        title="Detach editor to window"
        onClick={() => detachEditor('popup')}
      >
        <Icons.popout />
      </button>
      <button
        class="sc-btn sc-btn-ghost px-1.5"
        title="Open editor in new tab"
        onClick={() => detachEditor('tab')}
      >
        <Icons.externalLink />
      </button>

      <span class="sc-sep" aria-hidden="true" />

      <button
        type="button"
        class={`sc-btn sc-btn-ghost ${store.indicatorPanel.open ? 'text-accent' : ''}`}
        onClick={() => toggleIndicatorPanel()}
        title="Toggle indicator list"
        aria-pressed={store.indicatorPanel.open}
        data-testid="axis-btn-indicators"
      >
        <Icons.activity />
        Indicators
      </button>

      <button
        type="button"
        class={`sc-btn sc-btn-ghost ${store.layerPanel.open ? 'text-accent' : ''}`}
        onClick={() => toggleLayerPanel()}
        title="Layers — panes, scripts, drawings"
        aria-pressed={store.layerPanel.open}
        data-testid="axis-btn-layers"
      >
        <Icons.layers />
        Layers
      </button>

      <button
        type="button"
        class={`sc-btn sc-btn-ghost ${store.dataViewPanel.open ? 'text-accent' : ''}`}
        onClick={() => toggleDataViewPanel()}
        title="Data window — OHLCV & plot values at crosshair"
        aria-pressed={store.dataViewPanel.open}
        data-testid="axis-btn-dataview"
      >
        <Icons.table />
        Data
      </button>

      <button
        type="button"
        class="sc-btn sc-btn-ghost"
        onClick={() => openScriptSettings(null)}
        title="Script settings — edit input.* parameters"
        data-testid="axis-btn-script-settings"
      >
        <Icons.settings />
        Inputs
      </button>

      <button
        class={`sc-btn sc-btn-ghost ${store.resultsPanel.open ? 'text-accent' : ''}`}
        title="Results & export"
        data-testid="axis-btn-results"
        onClick={() => {
          setStore('resultsPanel', 'open', !store.resultsPanel.open);
          persist();
        }}
      >
        <Icons.scrollText />
        Results
      </button>

      <span class="sc-sep" aria-hidden="true" />

      <button
        class="sc-btn sc-btn-ghost px-2"
        onClick={() => props.onOpenPlugins?.()}
        title="Plugins"
        data-testid="axis-btn-plugins"
        aria-label="Open plugin manager"
      >
        <Icons.folder />
      </button>

      <button
        class="sc-btn sc-btn-ghost px-2"
        onClick={props.onOpenSettings}
        title="Settings — density, engine, live"
        data-testid="axis-btn-settings"
        aria-label="Open settings"
      >
        <Icons.settings />
      </button>

      <button
        class="sc-btn sc-btn-ghost px-2"
        onClick={toggleTheme}
        title={store.theme === 'dark' ? 'Switch to light (soft void lift)' : 'Switch to dark void'}
        aria-label="Toggle color theme"
      >
        {store.theme === 'dark' ? <Icons.sun /> : <Icons.moon />}
      </button>
    </header>
  );
};
