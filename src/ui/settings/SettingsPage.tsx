// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings studio canvas — product chrome. Engine / endpoint / exec mode
 * live on Runtime. Script storage (local / cloud Worker / git) lives here.
 *
 * @module ui/settings/SettingsPage
 */

import { For, Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  store,
  setStore,
  flushPersist,
  setStatus,
  clampUiScale,
  clampHistoryBars,
  resetUiLayout,
  HISTORY_BARS_MIN,
  HISTORY_BARS_MAX,
  HISTORY_BARS_DEFAULT,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_STEP,
  applyUiScale,
  toggleOnchainPanel,
} from '../../store';
import type { TopbarSettings } from '../../store/types';
import { Icons } from '../icons';
import { HooxLoader } from '../HooxLoader';
import {
  WATCHLIST_INTERVALS,
  WATCHLIST_REFRESH_OPTIONS,
} from '../../data/watchlist-tickers';
import { loadSymbolData, reloadChart } from '../../data/load-symbol';
import { syncLiveToPreference } from '../../streams/multiplex';
import { getManager } from '../../chart/manager-access';
import { UI_SCALE_PRESETS, formatUiScalePct } from '../ui-scale';
import { WorkspaceSnapshotMenu } from '../WorkspaceSnapshotMenu';
import { ThemePanel } from '../ThemePanel';
import { PluginConfigRow } from '../PluginConfigRow';
import { listStorages } from '../../storage/catalog';
import { promptStorageChange } from '../../storage/service';
import { getActiveStorageId } from '../../plugins/active';
import {
  generateDemoApiKey,
  resolveCloudConfig,
  writeStoredCloudConfig,
} from '../../storage/cloud-config';
import { probeCloudStorage } from '../../storage/cloud';
import { EditorIntelPanel, ExchangeCredentialsPanel } from '../SettingsDialog';
import { NotificationsPanel } from './NotificationsPanel';
import { KeyboardSettingsPanel } from '../shortcuts/Settings';
import {
  connectMcpBridge,
  disconnectMcpBridge,
  loadMcpPrefs,
  mcpBridgeState,
  onMcpBridge,
  rotateMcpBridge,
  saveMcpPrefs,
  type McpBridgeState,
} from '../../mcp';
import type { SettingsTabId } from '../studio/types';
import { isSettingsTabId } from '../studio/types';
import {
  StudioButton,
  StudioChip,
  StudioField,
  StudioFooter,
  StudioHint,
  StudioInput,
  StudioSection,
  StudioSelect,
  StudioStatus,
  StudioTabs,
  StudioToggle,
  type StudioHealth,
} from '../studio';

const SETTINGS_TABS: { id: SettingsTabId; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'Chart chrome · live · storage' },
  { id: 'data', label: 'Data', hint: 'Exchange keys · provider' },
  { id: 'editor', label: 'Editor', hint: 'Lint · hover · complete' },
  { id: 'theme', label: 'Theme', hint: 'Bars · canvas · chart.bg_color' },
  { id: 'topbar', label: 'Topbar', hint: 'Show or hide topbar groups' },
  { id: 'keyboard', label: 'Keyboard', hint: 'Shortcut chords · conflicts' },
  { id: 'notifications', label: 'Notifications', hint: 'Toasts · categories · flood control' },
];

/** Tabs that write as you edit. General is the only tab with Save / Cancel. */
const LIVE_TABS = new Set<SettingsTabId>([
  'data',
  'editor',
  'theme',
  'topbar',
  'keyboard',
  'notifications',
]);

type ProbeTone = 'ok' | 'err' | 'info';

type TopbarToggle = {
  key: keyof TopbarSettings;
  id: string;
  label: string;
  hint: string;
};

const TOPBAR_GROUPS: TopbarToggle[] = [
  { key: 'brand', id: 'topbar-brand', label: 'Brand', hint: 'AXIS wordmark.' },
  {
    key: 'market',
    id: 'topbar-market',
    label: 'Market',
    hint: 'Symbol, interval, chart type, and compare.',
  },
  {
    key: 'data',
    id: 'topbar-data',
    label: 'Data',
    hint: 'Venue, plugin config, Load, and Reload.',
  },
  {
    key: 'compute',
    id: 'topbar-compute',
    label: 'Compute',
    hint: 'Engine, stream, Run, Live, and Replay.',
  },
  { key: 'layout', id: 'topbar-layout', label: 'Layout', hint: 'Chart layout menu.' },
  {
    key: 'panels',
    id: 'topbar-panels',
    label: 'Panels',
    hint: 'Panel buttons. Turn individual buttons on below.',
  },
  {
    key: 'system',
    id: 'topbar-system',
    label: 'System',
    hint: 'Fullscreen, chart-only, Studio, and theme.',
  },
];

const TOPBAR_PANELS: TopbarToggle[] = [
  { key: 'panelsWatchlist', id: 'topbar-panels-watchlist', label: 'Watchlist', hint: 'Symbol list.' },
  { key: 'panelsEditor', id: 'topbar-panels-editor', label: 'Editor', hint: 'Pine editor dock.' },
  { key: 'panelsLibrary', id: 'topbar-panels-library', label: 'Library', hint: 'Script library.' },
  { key: 'panelsScripts', id: 'topbar-panels-scripts', label: 'Scripts', hint: 'Running scripts.' },
  { key: 'panelsLayers', id: 'topbar-panels-layers', label: 'Layers', hint: 'Drawings and plots.' },
  { key: 'panelsDsm', id: 'topbar-panels-dsm', label: 'DSM', hint: 'Data Source Manager.' },
  { key: 'panelsOnchain', id: 'topbar-panels-onchain', label: 'On-Chain', hint: 'Protocol metrics.' },
  { key: 'panelsAlerts', id: 'topbar-panels-alerts', label: 'Alerts', hint: 'Price and script alerts.' },
  { key: 'panelsValues', id: 'topbar-panels-values', label: 'Values', hint: 'Data window.' },
  { key: 'panelsResults', id: 'topbar-panels-results', label: 'Results', hint: 'Strategy results.' },
  {
    key: 'panelsSystemLogs',
    id: 'topbar-panels-systemlogs',
    label: 'System Logs',
    hint: 'Boot, data, and engine log.',
  },
  { key: 'panelsStatus', id: 'topbar-panels-status', label: 'Status', hint: 'Connection status strip.' },
];

function settingsFooterStatus(tab: SettingsTabId, scaleLabel: string): string {
  switch (tab) {
    case 'theme':
      return 'Theme applies live · Save not required';
    case 'editor':
      return 'Editor intel applies live · Save not required';
    case 'topbar':
      return 'Topbar applies live · Save not required';
    case 'keyboard':
      return 'Shortcuts apply live · Save not required';
    case 'notifications':
      return 'Notifications apply live · Save not required';
    case 'data':
      return 'Exchange keys stay in this session · not written to disk';
    default:
      return `AXIS · scale ${scaleLabel}`;
  }
}

function bridgeHealth(status: McpBridgeState['status']): StudioHealth {
  switch (status) {
    case 'open':
      return 'healthy';
    case 'connecting':
      return 'degraded';
    case 'error':
      return 'down';
    default:
      return 'idle';
  }
}

function bridgeDetail(b: McpBridgeState, hasKey: boolean): string {
  const parts: string[] = [];
  if (b.session) parts.push(`session ${b.session.slice(0, 8)}…`);
  if (b.tabs != null) parts.push(`${b.tabs} tab${b.tabs === 1 ? '' : 's'}`);
  if (b.error) parts.push(b.error);
  if (!hasKey) parts.push('set a Worker API key in the section above');
  return parts.join(' · ');
}

function SettingsTabPanel(props: {
  id: SettingsTabId;
  active: SettingsTabId;
  children: JSX.Element;
}) {
  return (
    <Show when={props.active === props.id}>
      <div
        id={`axis-settings-panel-${props.id}`}
        role="tabpanel"
        aria-labelledby={`axis-settings-tab-${props.id}`}
        data-testid={`axis-settings-${props.id}`}
      >
        {props.children}
      </div>
    </Show>
  );
}

function TopbarToggleGrid(props: { items: TopbarToggle[]; columns?: 2 | 3 }) {
  return (
    <div class={props.columns === 3 ? 'ax-toggle-grid ax-toggle-grid--3' : 'ax-toggle-grid'}>
      <For each={props.items}>
        {(item) => (
          <StudioToggle
            id={item.id}
            testId={item.id}
            checked={!!store.topbar[item.key]}
            label={item.label}
            hint={item.hint}
            onChange={(v) => setStore('topbar', item.key, v)}
          />
        )}
      </For>
    </div>
  );
}

export function SettingsPage(props: {
  onClose: () => void;
  initialTab?: SettingsTabId;
}) {
  const [chartInterval, setChartInterval] = createSignal(store.interval);
  const [historyBars, setHistoryBars] = createSignal(
    clampHistoryBars(store.historyBars ?? HISTORY_BARS_DEFAULT),
  );
  const [refreshSec, setRefreshSec] = createSignal(store.watchlist.refreshSec || 15);
  const [preferAfterLoad, setPreferAfterLoad] = createSignal(!!store.live.preferAfterLoad);
  const [rerunOn, setRerunOn] = createSignal<'every-tick' | 'bar-close'>(
    store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick',
  );
  const [hudCompact, setHudCompact] = createSignal(!!store.telemetry?.hud?.compact);
  const [shareOnError, setShareOnError] = createSignal(!!store.telemetry?.shareOnError);
  const [uiScale, setUiScaleLocal] = createSignal(clampUiScale(store.uiScale ?? 1));
  const [priceScaleLabels, setPriceScaleLabels] = createSignal(
    store.priceScaleLabelsVisible !== false,
  );
  const [lastValueLabels, setLastValueLabels] = createSignal(
    store.lastValueLabelsVisible !== false,
  );
  const [lastValueNames, setLastValueNames] = createSignal(
    store.lastValueNamesVisible !== false,
  );
  const [slippageNextOpen, setSlippageNextOpen] = createSignal(
    !!store.strategyUi?.slippageNextOpen,
  );
  const [invertTradeLabels, setInvertTradeLabels] = createSignal(
    !!store.strategyUi?.invertTradeLabels,
  );
  const [exactOnCandle, setExactOnCandle] = createSignal(
    store.strategyUi?.exactOnCandle !== false,
  );
  const [resultsAutoOpen, setResultsAutoOpen] = createSignal(
    store.resultsAutoOpen !== false,
  );
  const [autoload, setAutoload] = createSignal(store.autoload !== false);
  const [mcpConnect, setMcpConnect] = createSignal(loadMcpPrefs().connect);
  const [mcpBridge, setMcpBridge] = createSignal(mcpBridgeState());
  const [storage, setStorage] = createSignal(store.activePlugins?.storage || 'local');
  const [cloudEndpoint, setCloudEndpoint] = createSignal(resolveCloudConfig().endpoint);
  const [cloudApiKey, setCloudApiKey] = createSignal(resolveCloudConfig().apiKey);
  const [cloudProbeMsg, setCloudProbeMsg] = createSignal('');
  const [cloudProbeTone, setCloudProbeTone] = createSignal<ProbeTone | ''>('');
  const [cloudProbing, setCloudProbing] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  const storages = () => listStorages();
  const [tab, setTab] = createSignal<SettingsTabId>(
    isSettingsTabId(props.initialTab) ? props.initialTab : 'general',
  );

  const unsubMcp = onMcpBridge((s) => setMcpBridge(s));
  // Scale is a live preview. Leaving the page (Cancel, Escape, rail) puts
  // the document back on the saved value. Save writes the store first.
  onCleanup(() => {
    unsubMcp();
    applyUiScale(store.uiScale);
  });

  createEffect(() => {
    const t = props.initialTab;
    if (isSettingsTabId(t)) setTab(t);
  });

  const previewScale = (raw: number) => {
    const s = clampUiScale(raw);
    setUiScaleLocal(s);
    applyUiScale(s);
  };

  const save = () => {
    const prevInterval = store.interval;
    const prevHistoryBars = clampHistoryBars(store.historyBars);
    const nextInterval = chartInterval().trim() || prevInterval;
    const nextHistoryBars = clampHistoryBars(historyBars());
    const nextRefresh = Math.min(120, Math.max(5, Math.round(Number(refreshSec()) || 15)));
    const nextUiScale = clampUiScale(uiScale());

    setStore('interval', nextInterval);
    setStore('historyBars', nextHistoryBars);
    setStore('watchlist', 'refreshSec', nextRefresh);
    setStore('live', 'preferAfterLoad', preferAfterLoad());
    setStore('live', 'rerunOn', rerunOn());
    syncLiveToPreference();
    setStore('telemetry', 'hud', 'compact', hudCompact());
    setStore('telemetry', 'shareOnError', shareOnError());
    setStore('uiScale', nextUiScale);
    setStore('priceScaleLabelsVisible', priceScaleLabels());
    setStore('lastValueLabelsVisible', lastValueLabels());
    setStore('lastValueNamesVisible', lastValueNames());
    setStore('strategyUi', {
      slippageNextOpen: slippageNextOpen(),
      invertTradeLabels: invertTradeLabels(),
      exactOnCandle: exactOnCandle(),
    });
    setStore('resultsAutoOpen', resultsAutoOpen());
    setStore('autoload', autoload());
    applyUiScale(nextUiScale);
    const nextStorage = storage();
    // Single source of truth for the Worker Bearer (pn_…): cloud script
    // storage (/api/scripts) and the MCP server (/mcp + bridge) share it.
    // Persist always — not only when the cloud engine is active — so MCP
    // can attach while local/git storage is selected.
    writeStoredCloudConfig(cloudEndpoint(), cloudApiKey());
    promptStorageChange(getActiveStorageId(), nextStorage);
    flushPersist();
    // Pick up a fresh Worker key for the MCP bridge without a reload.
    rotateMcpBridge({ immediate: true });
    setStatus(
      'ready',
      `Settings saved · ${nextInterval} · ${nextHistoryBars} bars · refresh ${nextRefresh}s · live ${preferAfterLoad() ? 'on' : 'off'} · re-run=${rerunOn()}`,
      { toast: true, source: 'settings' },
    );
    if (
      store.symbol &&
      (nextInterval !== prevInterval || nextHistoryBars !== prevHistoryBars)
    ) {
      void loadSymbolData(store.symbol, nextInterval, store.source);
    }
    props.onClose();
  };

  const closeWithoutSave = () => {
    applyUiScale(store.uiScale);
    props.onClose();
  };

  const onReloadChart = async () => {
    if (reloading()) return;
    setReloading(true);
    try {
      await reloadChart();
    } finally {
      setReloading(false);
    }
  };

  const onResetUi = () => {
    const ok =
      typeof window !== 'undefined'
        ? window.confirm(
            'Reset UI layout to defaults?\n\n' +
              'Restores panel docks, sizes, open/closed state, and UI scale.\n' +
              'Does not clear chart data, scripts, drawings, or plugins.',
          )
        : true;
    if (!ok) return;
    resetUiLayout();
    setUiScaleLocal(1);
    setHudCompact(false);
    requestAnimationFrame(() => {
      try {
        getManager()?.resizeAll?.();
      } catch {
        /* ignore */
      }
    });
  };

  const footerStatus = () => settingsFooterStatus(tab(), formatUiScalePct(uiScale()));

  return (
    <div class="ax-page-stack">
      <StudioTabs
        tabs={SETTINGS_TABS}
        value={tab()}
        onChange={setTab}
        ariaLabel="Settings sections"
        idPrefix="axis-settings"
        testId="axis-settings-tabs"
      />
      <div class="ax-page-canvas">
        <SettingsTabPanel id="general" active={tab()}>
            <div class="ax-split">
            <div class="ax-split-col">
            <StudioSection title="Appearance" testId="axis-ui-scale-field">
              <StudioField
                label={`UI scale · ${formatUiScalePct(uiScale())}`}
                for="axis-ui-scale"
                hint="Scales text, icons, inputs, padding, and gaps. Chart candles stay sharp. Live preview — Save to keep."
              >
                <span data-testid="axis-ui-scale-value" hidden>
                  {formatUiScalePct(uiScale())}
                </span>
                <input
                  id="axis-ui-scale"
                  class="ax-range"
                  type="range"
                  min={UI_SCALE_MIN}
                  max={UI_SCALE_MAX}
                  step={UI_SCALE_STEP}
                  value={uiScale()}
                  data-testid="axis-ui-scale"
                  aria-valuemin={UI_SCALE_MIN}
                  aria-valuemax={UI_SCALE_MAX}
                  aria-valuenow={uiScale()}
                  aria-label="UI scale"
                  onInput={(e) => previewScale(Number(e.currentTarget.value))}
                />
                <div class="ax-chip-row">
                  <For each={UI_SCALE_PRESETS}>
                    {(p) => (
                      <StudioChip
                        pressed={Math.abs(uiScale() - p.value) < 0.01}
                        title={p.hint}
                        onClick={() => previewScale(p.value)}
                      >
                        {p.label}
                      </StudioChip>
                    )}
                  </For>
                </div>
              </StudioField>
            </StudioSection>

            <StudioSection
              title="Chart & watchlist"
              lead="Interval and history depth used when loading symbols. Label toggles match the chart [$] [N] [T] controls."
            >
              <StudioField label="Default interval" for="axis-default-interval">
                <StudioSelect
                  id="axis-default-interval"
                  value={chartInterval()}
                  onChange={setChartInterval}
                >
                  <For each={[...WATCHLIST_INTERVALS]}>
                    {(i) => <option value={i}>{i}</option>}
                  </For>
                </StudioSelect>
              </StudioField>
              <StudioField
                label="Historical bars"
                for="axis-history-bars"
                hint={`Bars requested on Load (${HISTORY_BARS_MIN}–${HISTORY_BARS_MAX}). Default ${HISTORY_BARS_DEFAULT}. Venues may return fewer.`}
              >
                <StudioInput
                  id="axis-history-bars"
                  type="number"
                  mono
                  min={HISTORY_BARS_MIN}
                  max={HISTORY_BARS_MAX}
                  step={50}
                  value={historyBars()}
                  onInput={(v) => setHistoryBars(Number(v))}
                  onChange={(v) => setHistoryBars(clampHistoryBars(v))}
                />
              </StudioField>
              <StudioToggle
                id="axis-autoload"
                testId="axis-settings-autoload"
                checked={autoload()}
                onChange={setAutoload}
                label="Autoload chart"
                hint="When on, symbol, interval, and venue changes fetch bars immediately and the topbar Load button is hidden. When off, change fields then click Load."
              />
              <StudioToggle
                id="axis-price-scale-labels"
                testId="axis-settings-price-scale-labels"
                checked={priceScaleLabels()}
                onChange={setPriceScaleLabels}
                label="Right price scale labels"
                hint="Show price numbers on the right axis. Off collapses the gutter."
              />
              <StudioToggle
                id="axis-last-value-labels"
                testId="axis-settings-last-value-labels"
                checked={lastValueLabels()}
                onChange={setLastValueLabels}
                label="Series last-value labels"
                hint="Show last prices on the right scale (plots, volume, hlines)."
              />
              <StudioToggle
                id="axis-last-value-names"
                testId="axis-settings-last-value-names"
                checked={lastValueNames()}
                onChange={setLastValueNames}
                label="Plot names on last-value labels"
                hint="Show RSI / Overbought titles next to the last value."
              />
            </StudioSection>

            <StudioSection
              title="Strategy fills & marks"
              lead="Historical and live default: execute on signal bar close. Marker options also live on Results → Strategy."
            >
              <StudioToggle
                id="axis-strategy-slippage"
                testId="axis-settings-strategy-slippage"
                checked={slippageNextOpen()}
                onChange={setSlippageNextOpen}
                label="Slippage → next bar open"
                hint="Off = fill at signal candle close. On = fill at next candle open."
              />
              <StudioToggle
                id="axis-strategy-invert-labels"
                testId="axis-settings-strategy-invert-labels"
                checked={invertTradeLabels()}
                onChange={setInvertTradeLabels}
                label="Invert long / short labels"
                hint="Default: long entry below, short above."
              />
              <StudioToggle
                id="axis-strategy-exact-marks"
                testId="axis-settings-strategy-exact-marks"
                checked={exactOnCandle()}
                onChange={setExactOnCandle}
                label="Exact marks on candle"
                hint="Circle on the fill bar body plus directional side arrows."
              />
            </StudioSection>

            <StudioSection
              title="Results"
              lead="The fullscreen Results overlay opens from the Topbar, command palette, or a script card. Strategies can open it automatically on run."
            >
              <StudioToggle
                id="axis-results-auto-open"
                testId="axis-settings-results-auto-open"
                checked={resultsAutoOpen()}
                onChange={setResultsAutoOpen}
                label="Auto-open results on strategies"
                hint="When on, running a strategy() script opens the Results overlay. Indicators never auto-open."
              />
            </StudioSection>

            <StudioSection
              title="Workspace"
              lead="Chart reload refetches OHLCV. UI reset restores panel layout and density only. Engine and endpoint live on Runtime."
              testId="axis-settings-workspace"
            >
              <div class="ax-toolbar">
                <StudioButton
                  variant="ghost"
                  testId="axis-settings-reload-chart"
                  disabled={reloading()}
                  onClick={() => void onReloadChart()}
                >
                  {reloading() ? <HooxLoader size="xs" /> : <Icons.refresh />}
                  {reloading() ? 'Reloading…' : 'Reload chart'}
                </StudioButton>
                <StudioButton
                  variant="ghost"
                  testId="axis-settings-reset-ui"
                  onClick={onResetUi}
                >
                  <Icons.reset />
                  Reset UI layout
                </StudioButton>
                <WorkspaceSnapshotMenu />
              </div>
            </StudioSection>
            </div>

            <div class="ax-split-col">
            <StudioSection title="Live stream">
              <StudioToggle
                id="axis-prefer-live"
                testId="axis-settings-live-enabled"
                checked={preferAfterLoad()}
                onChange={setPreferAfterLoad}
                label="Enable live stream"
                hint="On by default. Connects the venue WebSocket after bars load (and on boot when history is already there). Turn off for replay-only or offline work."
              />
              <StudioField
                label="Indicator re-run on live bars"
                for="axis-rerun-on"
                hint="Bar-close uses venue closed flags or bar time advance."
              >
                <StudioSelect
                  id="axis-rerun-on"
                  value={rerunOn()}
                  onChange={(v) => setRerunOn(v === 'bar-close' ? 'bar-close' : 'every-tick')}
                >
                  <option value="every-tick">Every tick (responsive)</option>
                  <option value="bar-close">Bar close only (lighter)</option>
                </StudioSelect>
              </StudioField>
              <StudioToggle
                id="axis-hud-compact"
                checked={hudCompact()}
                onChange={setHudCompact}
                label="Compact connection HUD"
                hint="Hide SRC/STR/ENG/STO plane chips; keep Live · Tick · Engine latency."
              />
              <StudioToggle
                id="axis-share-on-error"
                testId="axis-settings-share-on-error"
                checked={shareOnError()}
                onChange={setShareOnError}
                label="Ask to share data on errors"
                hint="Telemetry · off by default. Nothing is uploaded automatically."
              />
              <StudioField
                label="Watchlist REST fallback"
                for="axis-watchlist-refresh"
                hint="Used only when WebSocket quotes fail."
              >
                <StudioSelect
                  id="axis-watchlist-refresh"
                  value={String(refreshSec())}
                  onChange={(v) => setRefreshSec(Number(v))}
                >
                  <For each={[...WATCHLIST_REFRESH_OPTIONS]}>
                    {(o) => <option value={o.value}>{o.label}</option>}
                  </For>
                </StudioSelect>
              </StudioField>
            </StudioSection>

            <StudioSection
              title="Script storage"
              lead="Local browser, cloud Worker, or git. Switching copies the library and never deletes the source."
              testId="axis-settings-storage"
            >
              <StudioField
                label="Storage"
                for="axis-studio-storage"
                hint="Pick cloud to keep scripts on the Worker. The URL and API key below are shared with MCP. Git credentials stay in Script Library."
              >
                <StudioSelect
                  id="axis-studio-storage"
                  value={storage()}
                  onChange={setStorage}
                  testId="axis-studio-storage"
                >
                  <For each={storages()}>
                    {(s) => (
                      <option value={s.id}>
                        {s.name}
                        {s.builtIn ? '' : ' (plugin)'}
                      </option>
                    )}
                  </For>
                </StudioSelect>
              </StudioField>
            </StudioSection>

            <StudioSection
              title="Worker (cloud + MCP)"
              lead="One key unlocks both: cloud script storage (/api/scripts) and the MCP server (/mcp + tab bridge). Stored in this browser only — sent as Authorization: Bearer."
              testId="axis-settings-worker"
            >
              <StudioField label="Worker URL" for="axis-studio-cloud-endpoint">
                <StudioInput
                  id="axis-studio-cloud-endpoint"
                  mono
                  value={cloudEndpoint()}
                  placeholder="https://worker.axis.hoox.sh"
                  spellcheck={false}
                  testId="axis-studio-cloud-endpoint"
                  onInput={setCloudEndpoint}
                />
              </StudioField>
              <StudioField
                label="Worker API key"
                for="axis-studio-cloud-apikey"
                hint="pn_… from /api/keys (admin), or Generate demo key for local wrangler with ALLOW_OPEN_KEYS=1. Saved in this browser as you type."
              >
                <StudioInput
                  id="axis-studio-cloud-apikey"
                  type="password"
                  mono
                  value={cloudApiKey()}
                  placeholder="pn_…"
                  spellcheck={false}
                  autocomplete="off"
                  testId="axis-studio-cloud-apikey"
                  onInput={(v) => {
                    setCloudApiKey(v);
                    // Live-persist so MCP can attach without waiting for Save.
                    writeStoredCloudConfig(cloudEndpoint(), v);
                    rotateMcpBridge();
                  }}
                />
              </StudioField>
              <div class="ax-toolbar">
                <StudioButton
                  variant="ghost"
                  testId="axis-studio-cloud-generate"
                  onClick={() => {
                    const key = generateDemoApiKey();
                    setCloudApiKey(key);
                    writeStoredCloudConfig(cloudEndpoint(), key);
                    setCloudProbeTone('info');
                    setCloudProbeMsg('Generated a local key. Save, then Test connection.');
                    rotateMcpBridge({ immediate: true });
                  }}
                >
                  Generate demo key
                </StudioButton>
                <StudioButton
                  variant="ghost"
                  testId="axis-studio-cloud-probe"
                  disabled={cloudProbing()}
                  onClick={() => {
                    writeStoredCloudConfig(cloudEndpoint(), cloudApiKey());
                    setCloudProbing(true);
                    setCloudProbeMsg('');
                    setCloudProbeTone('');
                    void probeCloudStorage({
                      endpoint: cloudEndpoint(),
                      apiKey: cloudApiKey(),
                    }).then((r) => {
                      setCloudProbeTone(r.ok ? 'ok' : 'err');
                      setCloudProbeMsg(r.message);
                      setCloudProbing(false);
                      if (r.ok) rotateMcpBridge({ immediate: true });
                    });
                  }}
                >
                  {cloudProbing() ? 'Testing…' : 'Test connection'}
                </StudioButton>
              </div>
              <Show when={cloudProbeMsg()}>
                <p
                  class={
                    cloudProbeTone() === 'ok'
                      ? 'ax-hint ax-hint--accent'
                      : cloudProbeTone() === 'err'
                        ? 'ax-error'
                        : 'ax-hint'
                  }
                  role="status"
                  data-testid="axis-studio-cloud-probe-msg"
                >
                  {cloudProbeMsg()}
                </p>
              </Show>
            </StudioSection>

            <StudioSection
              title="MCP"
              lead="Remote agents (Claude, Cursor, Grok, Inspector) control this tab through the Worker MCP server at POST /mcp. Uses the Worker API key in the section above."
            >
              <StudioToggle
                id="axis-mcp-connect"
                testId="axis-settings-mcp-connect"
                checked={mcpConnect()}
                onChange={(v) => {
                  setMcpConnect(v);
                  saveMcpPrefs({ connect: v });
                  if (v) void connectMcpBridge();
                  else disconnectMcpBridge();
                }}
                label="Connect this tab to MCP"
                hint="When on, this browser session answers app_invoke / app_get / app_set. Worker-only tools (axis_run, scripts, onchain) work without a tab."
              />
              <div class="ax-inline">
                <StudioStatus
                  status={bridgeHealth(mcpBridge().status)}
                  label={`Bridge ${mcpBridge().status}`}
                />
              </div>
              <Show when={bridgeDetail(mcpBridge(), !!cloudApiKey())}>
                <StudioHint>{bridgeDetail(mcpBridge(), !!cloudApiKey())}</StudioHint>
              </Show>
            </StudioSection>

            <StudioSection
              title="On-Chain"
              lead="TVL / DEX traffic uses the AXIS Worker allowlisted proxy. Not a wallet — public metrics only."
              testId="axis-settings-onchain"
            >
              <StudioHint>
                <code>…/api/onchain/llama</code>
                {' · '}
                <code>…/api/onchain/gecko</code>
                {' · '}
                local <code>http://127.0.0.1:8787</code>
              </StudioHint>
              <div class="ax-toolbar">
                <StudioButton
                  variant="ghost"
                  testId="axis-settings-open-onchain"
                  onClick={() => {
                    toggleOnchainPanel();
                    props.onClose();
                  }}
                >
                  Open On-Chain panel
                </StudioButton>
              </div>
            </StudioSection>
            </div>
            </div>
        </SettingsTabPanel>

        <SettingsTabPanel id="data" active={tab()}>
            <div class="ax-split">
              <StudioSection
                title="Source & stream plugins"
                lead="Advanced fields hidden from the topbar. How many bars to load is under General → Historical bars."
                testId="axis-settings-plugins"
              >
                <PluginConfigRow layout="stacked" showAdvanced />
              </StudioSection>
              <ExchangeCredentialsPanel />
            </div>
        </SettingsTabPanel>

        <SettingsTabPanel id="editor" active={tab()}>
            <EditorIntelPanel />
        </SettingsTabPanel>

        <SettingsTabPanel id="theme" active={tab()}>
            <ThemePanel />
        </SettingsTabPanel>

        <SettingsTabPanel id="topbar" active={tab()}>
            <div class="ax-split-col">
              <StudioSection
                title="Topbar groups"
                lead="Choose which groups stay in the top bar. Changes apply immediately."
              >
                <TopbarToggleGrid items={TOPBAR_GROUPS} />
              </StudioSection>
              <Show when={store.topbar.panels}>
                <StudioSection
                  title="Panel buttons"
                  lead="Buttons inside the Panels group. Hidden when that group is off."
                >
                  <TopbarToggleGrid items={TOPBAR_PANELS} columns={3} />
                </StudioSection>
              </Show>
            </div>
        </SettingsTabPanel>

        <SettingsTabPanel id="keyboard" active={tab()}>
            <StudioSection
              title="Keyboard shortcuts"
              lead="Record a chord for any binding. Same-scope conflicts are flagged and still saved."
            >
              <KeyboardSettingsPanel />
            </StudioSection>
        </SettingsTabPanel>

        <SettingsTabPanel id="notifications" active={tab()}>
            <NotificationsPanel />
        </SettingsTabPanel>
      </div>
      <StudioFooter status={footerStatus()}>
        <StudioButton variant="ghost" onClick={closeWithoutSave}>
          {LIVE_TABS.has(tab()) ? 'Close' : 'Cancel'}
        </StudioButton>
        <Show when={tab() === 'general'}>
          <StudioButton variant="primary" onClick={save}>
            <Icons.check />
            Save
          </StudioButton>
        </Show>
      </StudioFooter>
    </div>
  );
}
