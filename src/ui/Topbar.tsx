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
 * Main workspace top bar — grouped left→right:
 * Brand · Market · Data · Compute · Layout · Panels · System.
 * Scriptlogs + Profiler live on the editor header.
 *
 * ## Groups
 * - **Brand** — logo + AXIS chart
 * - **Market** — Symbol, Interval, Chart type, Compare
 * - **Data** — Source (+ CSV upload), Load, Reload
 * - **Compute** — Engine, Stream, Run, Live, Replay
 * - **Layout** — multi-chart layout menu
 * - **Panels** — List → Editor → Library → Scripts → Inputs → Layers → DSM →
 *   On-Chain → Alerts → Values → Results → Script Logs → System Logs → Status
 * - **System** — Fullscreen, Chart only, Studio, Theme (`ml-auto`)
 *
 * ## Actions
 * - **Load / Reload** → force `loadSymbolData` (historical via active source)
 * - **Run / Re-run** → {@link RunSplitButton} (`runFromEditor`; replace or add instance)
 * - **Live** → multiplex `startLive` / `stopLive`
 * - **Replay** → bar replay over loaded OHLCV (`startBarReplay` / `exitBarReplay`)
 *
 * Plugin pickers re-read catalogs when `catalogTick` bumps (after plugin install).
 * Editor popout (new tab) lives on the editor panel chrome, not the topbar.
 */

import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  store,
  setStore,
  setStatus,
  toggleTheme,
  persist,
  setChartType,
  setActivePlugin,
  toggleIndicatorPanel,
  toggleDataViewPanel,
  toggleLayerPanel,
  toggleAlertsPanel,
  openScriptSettings,
  updateChartSlot,
  isPanelOpen,
  toggleLibraryPanel,
  toggleDataSourcePanel,
  toggleOnchainPanel,
  toggleScriptLogsPanel,
  toggleSystemLogsPanel,
  toggleStatusBarPanel,
} from '../store';
import { CHART_TYPES } from '../chart/chart-type';
import { startLive, stopLive, listStreams, defaultStreamForSource } from '../streams/multiplex';
import { loadSymbolData } from '../data/load-symbol';
import { parseOhlcvFile } from '../data/parse-bars';
import { listSources } from '../sources/catalog';
import { listEngines, preloadPyodide } from '../engines/catalog';
import { setUploadedBars, getUploadedFileName } from '../sources/upload-store';
import { DATA_MANAGER_SOURCE_ID } from '../data/data-manager-source';
import { engineOptionLabel } from './plugin-badges';
import { Icons } from './icons';
import { HooxLogo } from './HooxLogo';
import { HooxLoader } from './HooxLoader';
import { ChartLayoutMenu } from './ChartLayoutMenu';
import { CompareSymbolControl } from './CompareSymbolControl';
import { TopbarField } from './TopbarField';
import { PluginConfigRow } from './PluginConfigRow';
import { startBarReplay, exitBarReplay } from './BarReplayControls';
import { isReplayActive, subscribeReplay } from '../chart/bar-replay';
import { WATCHLIST_INTERVALS } from '../data/watchlist-tickers';
import { CachedDatasetsModal } from './CachedDatasetsModal';
import { SymbolModal } from './SymbolModal';
import { RunSplitButton } from './RunSplitButton';
import { openAboutModal } from './AboutModal';
import {
  activeCcxtExchange,
  hasCcxtCredential,
  subscribeCredentials,
} from '../data/credentials';
import {
  applyVenueToken,
  listVenueOptions,
  parseVenueToken,
  venueTokenFromState,
} from '../data/venue-picker';
import {
  toggleBrowserFullscreen,
  toggleChartOnlyMode,
} from './presentation';

const INTERVALS = [...WATCHLIST_INTERVALS];

/**
 * Workspace top chrome. Parent owns settings/plugins modals and editor ref.
 */
export const Topbar: Component<{
  onToggleEditor: () => void;
  onToggleWatchlist: () => void;
  onOpenSettings: (tab?: 'general' | 'data' | 'editor' | 'theme') => void;
  onOpenPlugins?: () => void;
  /** Open Workers catalog (backends / edge / Pyodide / SW). */
  onOpenWorkers?: () => void;
  /** Open Architecture — wire source / stream / engine / storage. */
  onOpenArchitecture?: () => void;
  /** Open Runtime — active engine, endpoint, health. */
  onOpenRuntime?: () => void;
  /** Open the studio overlay (last page, or Runtime). */
  onOpenStudio?: () => void;
  /** Bump when plugin catalog changes */
  catalogTick?: number;
  editorRef: {
    getDoc: () => string;
    ensureSavedForRun?: () => Promise<{ ok: boolean; doc: string }>;
  };
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
  const [replayOn, setReplayOn] = createSignal(isReplayActive());
  const [datasetsOpen, setDatasetsOpen] = createSignal(false);
  const [symbolModalOpen, setSymbolModalOpen] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  /** Last symbol we successfully requested (avoids redundant blur reloads). */
  let lastLoadedSymbol = store.symbol;
  let lastLoadedInterval = store.interval;
  /** Newest load wins; `loadSymbolData` already aborts the prior network request. */
  let loadSeq = 0;

  onMount(() => {
    const unsub = subscribeReplay((st) => setReplayOn(st.active));
    onCleanup(unsub);
  });

  const loadHistorical = async (opts?: { force?: boolean }) => {
    const sym = store.symbol.trim().toUpperCase();
    if (!sym) return;
    if (
      !opts?.force &&
      sym === lastLoadedSymbol &&
      store.interval === lastLoadedInterval &&
      store.bars.length > 0
    ) {
      return;
    }
    const seq = ++loadSeq;
    setLoading(true);
    try {
      const ok = await loadSymbolData(sym, store.interval, store.source);
      if (seq !== loadSeq) return;
      if (ok) {
        lastLoadedSymbol = sym;
        lastLoadedInterval = store.interval;
      }
    } finally {
      if (seq === loadSeq) setLoading(false);
    }
  };

  const venueToken = createMemo(() =>
    venueTokenFromState(store.source, activeCcxtExchange()),
  );
  const venueOptions = createMemo(() =>
    listVenueOptions(
      sources().map((s) => ({ id: s.id, name: s.name })),
      activeCcxtExchange(),
    ),
  );

  const onVenueChange = (token: string) => {
    applyVenueToken(token);
    const { sourceId } = parseVenueToken(token);
    if (sourceId === 'csv-upload' && !getUploadedFileName()) {
      fileInput?.click();
    }
    if (sourceId === DATA_MANAGER_SOURCE_ID) {
      setDatasetsOpen(true);
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

  const toggleLive = () => {
    const next = !store.live.active;
    if (next) {
      // Live and bar replay are mutually exclusive
      if (isReplayActive()) exitBarReplay();
      const streamId = store.live.streamId || defaultStreamForSource(store.source);
      startLive(streamId, store.symbol, store.interval);
    } else {
      stopLive();
    }
  };

  const toggleReplay = () => {
    if (isReplayActive()) {
      exitBarReplay();
      setStatus('ready', 'Bar replay ended');
      return;
    }
    if (store.bars.length <= 0) {
      setStatus('error', 'Load bars before starting bar replay');
      return;
    }
    if (!startBarReplay()) {
      setStatus('error', 'Could not start bar replay');
      return;
    }
    setStatus(
      'ready',
      'Bar replay · scrub/step to a start bar, then Play — or Play to run from the first bar',
    );
  };

  const sourceNeedsSymbol = () => store.source !== 'csv-upload' && store.source !== 'mock-walk';

  const commitSymbol = (raw: string, forceLoad: boolean) => {
    const next = raw.toUpperCase().trim();
    if (!next) return;
    setStore('symbol', next);
    const aid = store.chartLayout?.activeId;
    if (aid) updateChartSlot(aid, { symbol: next });
    persist();
    if (forceLoad) void loadHistorical({ force: true });
    else void loadHistorical();
  };

  return (
    <header
      class="flex items-center gap-[var(--ui-gap-sm)] px-2.5 py-1 bg-bg-panel border-b-2 border-border flex-shrink-0 min-h-[var(--ui-topbar-min-h)] flex-wrap"
      data-testid="axis-topbar"
    >
      {/* ── Brand (click → About) ───────────────────────────── */}
      <Show when={store.topbar.brand}>
        <button
          type="button"
          class="axis-tb-group axis-tb-brand axis-tb-brand-btn"
          data-tb-group="brand"
          data-testid="axis-brand"
          title="About AXIS · HOOX ethos"
          aria-label="About AXIS"
          onClick={() => openAboutModal()}
        >
          <HooxLogo
            size="m"
            class="axis-tb-brand-logo text-text flex-shrink-0"
            data-testid="axis-hoox-logo"
          />
          <div class="axis-tb-brand-title">
            AXIS
            <span class="axis-tb-brand-sub">chart</span>
          </div>
        </button>
      </Show>

      {/* ── Market ──────────────────────────────────────────── */}
      <Show when={store.topbar.market}>
        <div class="axis-tb-group" data-tb-group="market">
        <Show when={sourceNeedsSymbol()}>
          <div class="flex items-stretch gap-0.5" data-testid="axis-symbol-control">
            <TopbarField
              id="axis-symbol"
              label="Symbol"
              class="min-w-[7em]"
              mono
              value={store.symbol}
              spellcheck={false}
              autocomplete="off"
              title="Symbol · click list to browse exchange pairs · Enter to load"
              onInput={(e) => {
                setStore('symbol', e.currentTarget.value.toUpperCase());
              }}
              onChange={(e) => {
                // Persist + slot sync only; load on blur / Enter (same as before)
                const next = e.currentTarget.value.toUpperCase().trim();
                if (!next) return;
                setStore('symbol', next);
                const aid = store.chartLayout?.activeId;
                if (aid) updateChartSlot(aid, { symbol: next });
                persist();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitSymbol(e.currentTarget.value, true);
                } else if (e.key === 'ArrowDown' || (e.key === ' ' && e.ctrlKey)) {
                  e.preventDefault();
                  setSymbolModalOpen(true);
                }
              }}
              onBlur={(e) => {
                commitSymbol(e.currentTarget.value, false);
              }}
            />
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-1.5 self-stretch border border-border/40 rounded-[var(--radius-chip)]"
              data-testid="axis-symbol-browse"
              title="Browse symbols for current exchange (source / stream)"
              aria-label="Browse symbols"
              onClick={() => setSymbolModalOpen(true)}
            >
              <Icons.search />
            </button>
          </div>
          <SymbolModal
            open={symbolModalOpen()}
            initialQuery={store.symbol}
            onClose={() => setSymbolModalOpen(false)}
            onSelect={(sym) => {
              commitSymbol(sym, true);
            }}
          />
        </Show>

        <Show when={store.source !== 'csv-upload'}>
          <TopbarField
            id="axis-interval"
            label="Interval"
            variant="select"
            class="min-w-[4em]"
            value={store.interval}
            title="Bar interval · reloads chart"
            onChange={(e) => {
              const next = e.currentTarget.value;
              setStore('interval', next);
              const aid = store.chartLayout?.activeId;
              if (aid) updateChartSlot(aid, { interval: next });
              persist();
              // Auto-reload so interval changes always paint
              if (store.source !== 'csv-upload') {
                void loadSymbolData(store.symbol, next, store.source);
              }
            }}
          >
            <For each={INTERVALS}>{(i) => <option value={i}>{i}</option>}</For>
          </TopbarField>
        </Show>

        <TopbarField
          id="axis-chart-type"
          label="Type"
          variant="select"
          class="min-w-[5.5em]"
          testId="axis-select-chart-type"
          value={store.chartType}
          title={
            CHART_TYPES.find((t) => t.id === store.chartType)?.description || 'Price chart style'
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
        </TopbarField>

        <CompareSymbolControl />
      </div>
      </Show>

      {/* ── Data ────────────────────────────────────────────── */}
      <Show when={store.topbar.data}>
        <div class="axis-tb-group" data-tb-group="data" data-axis-source={store.source}>
        <TopbarField
          label="Venue"
          variant="select"
          class="min-w-[8em]"
          testId="axis-select-source"
          value={venueToken()}
          title="Exchange / data venue — native CEX, CCXT long-tail, or local"
          onChange={(e) => onVenueChange(e.currentTarget.value)}
        >
          <optgroup label="CEX">
            <For each={venueOptions().filter((o) => o.group === 'native')}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </optgroup>
          <optgroup label="CCXT">
            <For each={venueOptions().filter((o) => o.group === 'ccxt')}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </optgroup>
          <optgroup label="Other">
            <For each={venueOptions().filter((o) => o.group === 'other' || o.group === 'plugin')}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </optgroup>
        </TopbarField>

        <PluginConfigRow
          onApplied={() => void loadHistorical({ force: true })}
          hideKeys={venueToken() === 'ccxt:' ? [] : ['exchange']}
        />

        <Show when={store.source === 'ccxt-rest'}>
          <CcxtKeyChip onOpen={() => props.onOpenSettings('data')} />
        </Show>

        <Show when={store.source === 'csv-upload'}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost max-w-[12em]"
            title={uploadLabel() || 'Upload CSV or JSON OHLCV'}
            onClick={() => fileInput?.click()}
          >
            <Icons.upload />
            <span class="truncate axis-tb-btn-label">{uploadLabel() || 'Upload…'}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            class="hidden"
            onChange={onFilePicked}
          />
        </Show>

        <Show when={store.source === DATA_MANAGER_SOURCE_ID}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost max-w-[12em]"
            title="Browse cached datasets from the Data Source Manager"
            onClick={() => setDatasetsOpen(true)}
            data-testid="axis-btn-datasets"
          >
            <Icons.datasets />
            <span class="truncate axis-tb-btn-label">Datasets…</span>
          </button>
        </Show>

        <CachedDatasetsModal
          open={datasetsOpen()}
          onClose={() => setDatasetsOpen(false)}
        />

        <button
          type="button"
          class={`sc-btn ${loading() ? 'is-loading' : ''}`}
          onClick={() => void loadHistorical({ force: true })}
          disabled={loading()}
          aria-busy={loading() || undefined}
          data-testid="axis-btn-load"
          title={
            store.source === 'csv-upload'
              ? 'Reload last uploaded file'
              : store.source === DATA_MANAGER_SOURCE_ID
                ? 'Load bars from Data Manager cache'
                : `Load bars from ${store.source}`
          }
        >
          {loading() ? <HooxLoader size="xs" /> : <Icons.download />}
          <span class="axis-tb-btn-label">{loading() ? 'Loading…' : 'Load'}</span>
        </button>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost sc-btn-icon ${loading() ? 'is-loading' : ''}`}
          onClick={() => void loadHistorical({ force: true })}
          disabled={loading()}
          aria-busy={loading() || undefined}
          data-testid="axis-btn-reload-chart"
          title="Reload chart — refetch bars for the current symbol / interval"
          aria-label="Reload chart"
        >
          {loading() ? <HooxLoader size="xs" /> : <Icons.refresh />}
        </button>
      </div>
      </Show>

      {/* ── Compute (Engine · Stream · Run / Live / Replay) ── */}
      <Show when={store.topbar.compute}>
        <div class="axis-tb-group" data-tb-group="compute" data-axis-engine={store.engine}>
        <TopbarField
          label="Engine"
          variant="select"
          class="min-w-[7.5em] max-w-[12em]"
          testId="axis-select-engine"
          value={store.engine}
          title={
            store.engine === 'pyodide'
              ? 'RUN=browser (Pyodide) · ENG=local — first load often 20–30s. HUD: ENG / RUN / MODE.'
              : engines().find((en) => en.id === store.engine)?.description ||
                'Calculation engine — maps to HUD ENG (local|remote) + RUN (browser|server|worker)'
          }
          onChange={(e) => {
            const id = e.currentTarget.value;
            setActivePlugin('engine', id);
            if (id === 'pyodide') {
              void preloadPyodide();
            }
          }}
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
        </TopbarField>

        <Show
          when={store.live.streamId !== defaultStreamForSource(store.source)}
          fallback={null}
        >
          <TopbarField
            label="Stream"
            variant="select"
            class="min-w-[7em]"
            value={store.live.streamId}
            disabled={store.live.active}
            title={`Live stream (mismatched vs ${defaultStreamForSource(store.source)} — HUD Fix)`}
            onChange={(e) => {
              setActivePlugin('stream', e.currentTarget.value);
            }}
          >
            <For each={streams()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
          </TopbarField>
        </Show>

        {/* Action cluster: Run/Re-run · Live · Replay — Run is accent only while executing */}
        <RunSplitButton
          getDoc={() => props.editorRef.getDoc()}
          ensureSavedForRun={
            props.editorRef.ensureSavedForRun
              ? () => props.editorRef.ensureSavedForRun!()
              : undefined
          }
        />

        <button
          type="button"
          class={`sc-btn ${store.live.active ? 'is-live-on' : 'sc-btn-ghost'}`}
          onClick={toggleLive}
          data-testid="axis-btn-live"
          aria-pressed={store.live.active}
          title={
            store.live.active
              ? 'Stop live stream'
              : `Start live stream (${
                  streams().find((s) => s.id === defaultStreamForSource(store.source))?.name ||
                  defaultStreamForSource(store.source)
                })`
          }
        >
          {store.live.active ? (
            <Icons.wifi class="text-accent-2" />
          ) : (
            <Icons.wifiOff />
          )}
          <span class="axis-tb-btn-label">Live</span>
        </button>

        <button
          type="button"
          class={`sc-btn ${replayOn() ? 'is-replay-on' : 'sc-btn-ghost'}`}
          onClick={toggleReplay}
          disabled={!replayOn() && store.bars.length <= 0}
          data-testid="axis-btn-bar-replay"
          aria-pressed={replayOn()}
          title={
            replayOn()
              ? 'Exit bar replay'
              : store.bars.length <= 0
                ? 'Load bars first to start bar replay'
                : 'Start bar replay over loaded history'
          }
        >
          <Icons.play />
          <span class="axis-tb-btn-label">Replay</span>
        </button>
      </div>
      </Show>

      {/* ── Layout ──────────────────────────────────────────── */}
      <Show when={store.topbar.layout}>
        <div class="axis-tb-group" data-tb-group="layout">
          <ChartLayoutMenu />
        </div>
      </Show>

      {/* ── Panels (unique Icons.* per button — see ICON_MAP in icons.tsx) ─ */}
      <Show when={store.topbar.panels}>
        <div class="axis-tb-group" data-tb-group="panels">
        <Show when={store.topbar.panelsWatchlist}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('watchlist') || store.watchlist.open ? 'is-active' : ''}`}
          onClick={props.onToggleWatchlist}
          title="Toggle watchlist"
          aria-pressed={isPanelOpen('watchlist') || store.watchlist.open}
          data-testid="axis-btn-watchlist"
        >
          <Icons.watchlist />
          <span class="axis-tb-btn-label">List</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsEditor}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${
            store.editor.open && store.editor.mode === 'docked' ? 'is-active' : ''
          }`}
          onClick={props.onToggleEditor}
          title="Toggle docked editor"
          aria-pressed={!!(store.editor.open && store.editor.mode === 'docked')}
          data-testid="axis-btn-editor"
        >
          <Icons.editor />
          <span class="axis-tb-btn-label">Editor</span>
          {store.editor.mode === 'popout' && (
            <span class="text-orange ml-0.5 text-[0.72em]">ext</span>
          )}
        </button>
        </Show>

        <Show when={store.topbar.panelsLibrary}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('library') ? 'is-active' : ''}`}
          onClick={() => toggleLibraryPanel()}
          title="Script library — load / save Pine scripts"
          aria-pressed={isPanelOpen('library')}
          data-testid="axis-btn-library"
        >
          <Icons.library />
          <span class="axis-tb-btn-label">Library</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsScripts}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('indicators') || store.indicatorPanel.open ? 'is-active' : ''}`}
          onClick={() => toggleIndicatorPanel()}
          title="Toggle scripts list — applied Pine indicators & strategies"
          aria-pressed={isPanelOpen('indicators') || store.indicatorPanel.open}
          data-testid="axis-btn-indicators"
        >
          <Icons.scripts />
          <span class="axis-tb-btn-label">Scripts</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsInputs}>
        <button
          type="button"
          class="sc-btn sc-btn-ghost"
          onClick={() => openScriptSettings(null)}
          title="Script settings — edit input.* parameters"
          data-testid="axis-btn-script-settings"
        >
          <Icons.inputs />
          <span class="axis-tb-btn-label">Inputs</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsLayers}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('layers') || store.layerPanel.open ? 'is-active' : ''}`}
          onClick={() => toggleLayerPanel()}
          title="Layers — left slide-in: panes, scripts, drawings"
          aria-pressed={isPanelOpen('layers') || store.layerPanel.open}
          data-testid="axis-btn-layers"
        >
          <Icons.layers />
          <span class="axis-tb-btn-label">Layers</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsDsm}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('datasource') ? 'is-active' : ''}`}
          onClick={() => toggleDataSourcePanel()}
          title="Data Source Manager — background OHLCV backfill"
          aria-pressed={isPanelOpen('datasource')}
          data-testid="axis-btn-datasource"
        >
          <Icons.dataSource />
          <span class="axis-tb-btn-label">DSM</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsOnchain}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('onchain') ? 'is-active' : ''}`}
          onClick={() => toggleOnchainPanel()}
          title="On-Chain — DefiLlama protocol TVL overlays"
          aria-pressed={isPanelOpen('onchain')}
          data-testid="axis-btn-onchain"
        >
          <Icons.onchain />
          <span class="axis-tb-btn-label">On-Chain</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsAlerts}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('alerts') || store.alertsPanel.open ? 'is-active' : ''}`}
          onClick={() => toggleAlertsPanel()}
          title="Price alerts — create, toggle, webhook"
          aria-pressed={isPanelOpen('alerts') || store.alertsPanel.open}
          data-testid="axis-btn-alerts"
        >
          <Icons.alerts />
          <span class="axis-tb-btn-label">Alerts</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsValues}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('dataview') || store.dataViewPanel.open ? 'is-active' : ''}`}
          onClick={() => toggleDataViewPanel()}
          title="Data window — OHLCV & plot values at crosshair"
          aria-pressed={isPanelOpen('dataview') || store.dataViewPanel.open}
          data-testid="axis-btn-dataview"
        >
          <Icons.dataView />
          <span class="axis-tb-btn-label">Values</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsResults}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('results') || store.resultsPanel.open ? 'is-active' : ''}`}
          title="Results & export"
          data-testid="axis-btn-results"
          aria-pressed={isPanelOpen('results') || store.resultsPanel.open}
          onClick={() => {
            setStore('resultsPanel', 'open', !store.resultsPanel.open);
            persist();
          }}
        >
          <Icons.results />
          <span class="axis-tb-btn-label">Results</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsScriptLogs}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('scriptlogs') ? 'is-active' : ''}`}
          title="Script Logs — Pine log.* from the last run"
          data-testid="axis-btn-scriptlogs-top"
          aria-pressed={isPanelOpen('scriptlogs')}
          onClick={() => toggleScriptLogsPanel()}
        >
          <Icons.scriptLogs />
          <span class="axis-tb-btn-label">Script Logs</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsSystemLogs}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('logs') ? 'is-active' : ''}`}
          title="System Logs — app / transport / boot telemetry"
          data-testid="axis-btn-systemlogs"
          aria-pressed={isPanelOpen('logs')}
          onClick={() => toggleSystemLogsPanel()}
        >
          <Icons.systemLogs />
          <span class="axis-tb-btn-label">System Logs</span>
        </button>
        </Show>

        <Show when={store.topbar.panelsStatus}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost ${isPanelOpen('statusbar') ? 'is-active' : ''}`}
          title="Status — connection HUD and status message"
          data-testid="axis-btn-statusbar"
          aria-pressed={isPanelOpen('statusbar')}
          onClick={() => toggleStatusBarPanel()}
        >
          <Icons.status />
          <span class="axis-tb-btn-label">Status</span>
        </button>
        </Show>
      </div>
      </Show>

      {/* ── System (pushed right via CSS) ───────────────────── */}
      <Show when={store.topbar.system}>
        <div class="axis-tb-group" data-tb-group="system">
        <button
          type="button"
          class={`sc-btn sc-btn-ghost sc-btn-icon ${store.presentation?.fullscreen ? 'is-active' : ''}`}
          onClick={() => void toggleBrowserFullscreen()}
          title={
            store.presentation?.fullscreen
              ? 'Exit fullscreen (F11)'
              : 'Fullscreen — fill the display (F11)'
          }
          aria-pressed={!!store.presentation?.fullscreen}
          aria-label="Toggle fullscreen"
          data-testid="axis-btn-fullscreen"
        >
          <Icons.fullscreen />
        </button>

        <button
          type="button"
          class={`sc-btn sc-btn-ghost sc-btn-icon ${store.presentation?.chartOnly ? 'is-active' : ''}`}
          onClick={() => toggleChartOnlyMode()}
          title={
            store.presentation?.chartOnly
              ? 'Exit chart only (Shift+F / Esc)'
              : 'Chart only — hide chrome, chart fills the shell (Shift+F)'
          }
          aria-pressed={!!store.presentation?.chartOnly}
          aria-label="Toggle chart-only mode"
          data-testid="axis-btn-chart-only"
        >
          {store.presentation?.chartOnly ? <Icons.minimize /> : <Icons.maximize />}
        </button>

        <button
          type="button"
          class="sc-btn sc-btn-ghost"
          onClick={() =>
            props.onOpenStudio?.() ?? props.onOpenRuntime?.() ?? props.onOpenWorkers?.()
          }
          title="Studio — Runtime, Wire, Settings, Workers, Plugins"
          data-testid="axis-btn-studio"
          aria-label="Open Studio"
        >
          <Icons.studio />
          <span class="axis-tb-btn-label">Studio</span>
        </button>
        {/* Hidden hooks — e2e / palette / docs still open a specific studio page */}
        <button
          type="button"
          class="sr-only"
          tabindex={-1}
          data-testid="axis-btn-architecture"
          aria-label="Open Architecture"
          onClick={() => props.onOpenArchitecture?.()}
        />
        <button
          type="button"
          class="sr-only"
          tabindex={-1}
          data-testid="axis-btn-runtimes"
          aria-label="Open Runtime"
          onClick={() => props.onOpenRuntime?.() ?? props.onOpenWorkers?.()}
        />
        <button
          type="button"
          class="sr-only"
          tabindex={-1}
          data-testid="axis-btn-settings"
          aria-label="Open settings"
          onClick={() => props.onOpenSettings()}
        />
        <button
          type="button"
          class="sr-only"
          tabindex={-1}
          data-testid="axis-btn-workers"
          aria-hidden="true"
          onClick={() => props.onOpenWorkers?.()}
        />
        <button
          type="button"
          class="sr-only"
          tabindex={-1}
          data-testid="axis-btn-plugins"
          aria-label="Open Plugins"
          onClick={() => props.onOpenPlugins?.()}
        />

        <button
          type="button"
          class="sc-btn sc-btn-ghost sc-btn-icon"
          onClick={toggleTheme}
          title={store.theme === 'dark' ? 'Switch to light (soft void lift)' : 'Switch to dark void'}
          aria-label="Toggle color theme"
          data-testid="axis-btn-theme"
        >
          {store.theme === 'dark' ? <Icons.sun /> : <Icons.moon />}
        </button>
      </div>
      </Show>
    </header>
  );
};

function ccxtExchangeFromStore(): string {
  return activeCcxtExchange();
}

function CcxtKeyChip(props: { onOpen: () => void }) {
  const [rev, setRev] = createSignal(0);
  onMount(() => {
    const unsub = subscribeCredentials(() => setRev((n) => n + 1));
    onCleanup(unsub);
  });
  const saved = createMemo(() => {
    rev();
    void store.pluginsConfig;
    const ex = ccxtExchangeFromStore();
    return !!ex && hasCcxtCredential(ex);
  });
  const label = () => {
    const ex = ccxtExchangeFromStore();
    if (saved()) return ex ? `Key · ${ex}` : 'Key saved';
    return 'API key';
  };
  return (
    <button
      type="button"
      class="sc-btn sc-btn-ghost"
      data-testid="axis-cfg-ccxt-key"
      title={
        saved()
          ? 'Session API key saved for this CCXT exchange — click to edit in Settings → Data'
          : 'Add a session API key + secret for this CCXT exchange (optional for public candles)'
      }
      onClick={props.onOpen}
    >
      <Icons.key />
      <span class="axis-tb-btn-label">{label()}</span>
    </button>
  );
}
