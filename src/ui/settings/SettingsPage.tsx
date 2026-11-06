// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings studio canvas — product chrome. Engine / endpoint / exec mode
 * live on Runtime. Script storage (local / cloud Worker / git) lives here.
 *
 * @module ui/settings/SettingsPage
 */

import { For, Show, batch, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  store,
  setStore,
  flushPersist,
  persist,
  DEFAULTS,
  setStatus,
  clampUiScale,
  clampHistoryBars,
  clampRollingWindowBars,
  ROLLING_WINDOW_DEFAULT,
  ROLLING_WINDOW_MIN,
  ROLLING_WINDOW_MAX,
  resetUiLayout,
  HISTORY_BARS_MIN,
  HISTORY_BARS_MAX,
  HISTORY_BARS_DEFAULT,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_STEP,
  applyUiScale,
  toggleOnchainPanel,
  toggleDataSourcePanel,
} from '../../store';
import type { TopbarSettings } from '../../store/types';
import { Icons } from '../icons';
import { WATCHLIST_INTERVALS, WATCHLIST_REFRESH_OPTIONS } from '../../data/watchlist-tickers';
import { loadSymbolData, reloadChart } from '../../data/load-symbol';
import { flushLocalAndEngine } from '../../data/engine-flush';
import { syncLiveToPreference } from '../../streams/multiplex';
import { getManager } from '../../chart/manager-access';
import { UI_SCALE_PRESETS, formatUiScalePct } from '../ui-scale';
import { WorkspaceSnapshotMenu } from '../WorkspaceSnapshotMenu';
import { ThemePanel } from '../ThemePanel';
import { EffectsPanel } from '../effects/EffectsPanel';
import { PluginConfigRow } from '../PluginConfigRow';
import { listStorages } from '../../storage/catalog';
import { promptStorageChange } from '../../storage/service';
import { getActiveSourceId, getActiveStorageId, getActiveStreamId } from '../../plugins/active';
import {
  generateDemoApiKey,
  resolveCloudConfig,
  writeStoredCloudConfig,
} from '../../storage/cloud-config';
import { probeCloudStorage } from '../../storage/cloud';
import { EditorIntelPanel, ExchangeCredentialsPanel } from './panels';
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
  AppButton,
  StudioChip,
  StudioField,
  StudioFooter,
  StudioHint,
  StudioInput,
  StudioRange,
  StudioSection,
  StudioSelect,
  StudioStatus,
  StudioTabs,
  StudioToggle,
  useMicrofeedback,
  type StudioHealth,
} from '../studio';

const SETTINGS_TABS: { id: SettingsTabId; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'Scale · chart data · live · cloud' },
  { id: 'data', label: 'Data', hint: 'Exchange keys · plugins · datasets' },
  { id: 'editor', label: 'Editor', hint: 'Lint · hover · complete' },
  { id: 'theme', label: 'Theme', hint: 'Palettes · bar coloring · motion' },
  { id: 'topbar', label: 'Topbar', hint: 'Groups and panel buttons' },
  { id: 'keyboard', label: 'Keyboard', hint: 'Shortcut chords · conflicts' },
  { id: 'notifications', label: 'Notifications', hint: 'Browser alerts · toasts · flood control' },
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
    hint: 'Symbol · interval · chart type · compare.',
  },
  {
    key: 'data',
    id: 'topbar-data',
    label: 'Data',
    hint: 'Venue · plugin config · Load / Reload.',
  },
  {
    key: 'compute',
    id: 'topbar-compute',
    label: 'Compute',
    hint: 'Engine · stream · Run · Live · Replay.',
  },
  { key: 'layout', id: 'topbar-layout', label: 'Layout', hint: 'Multi-chart layout menu.' },
  {
    key: 'panels',
    id: 'topbar-panels',
    label: 'Panels',
    hint: 'Module-bar panel buttons (tune each on the right).',
  },
  {
    key: 'system',
    id: 'topbar-system',
    label: 'System',
    hint: 'Fullscreen · chart-only · Studio · theme.',
  },
];

const TOPBAR_PANELS: TopbarToggle[] = [
  {
    key: 'panelsWatchlist',
    id: 'topbar-panels-watchlist',
    label: 'Watchlist',
    hint: 'Symbol list.',
  },
  { key: 'panelsEditor', id: 'topbar-panels-editor', label: 'Editor', hint: 'Pine editor dock.' },
  { key: 'panelsLibrary', id: 'topbar-panels-library', label: 'Library', hint: 'Script library.' },
  { key: 'panelsScripts', id: 'topbar-panels-scripts', label: 'Scripts', hint: 'Running scripts.' },
  { key: 'panelsLayers', id: 'topbar-panels-layers', label: 'Layers', hint: 'Drawings and plots.' },
  { key: 'panelsDsm', id: 'topbar-panels-dsm', label: 'Data', hint: 'Data Source Manager (DSM).' },
  {
    key: 'panelsOnchain',
    id: 'topbar-panels-onchain',
    label: 'On-Chain',
    hint: 'Protocol metrics.',
  },
  {
    key: 'panelsAlerts',
    id: 'topbar-panels-alerts',
    label: 'Alerts',
    hint: 'Price and script alerts.',
  },
  {
    key: 'panelsAi',
    id: 'topbar-panels-ai',
    label: 'AI',
    hint: 'PYNE Agent chat panel.',
  },
  { key: 'panelsValues', id: 'topbar-panels-values', label: 'Values', hint: 'Data window.' },
  {
    key: 'panelsResults',
    id: 'topbar-panels-results',
    label: 'Results',
    hint: 'Strategy results.',
  },
  {
    key: 'panelsExtra',
    id: 'topbar-panels-extra',
    label: 'Extra',
    hint: 'Price card, ticker tape, fullscreen alerts.',
  },
  {
    key: 'panelsSystemLogs',
    id: 'topbar-panels-systemlogs',
    label: 'System Logs',
    hint: 'Boot, data, and engine log.',
  },
  {
    key: 'panelsStatus',
    id: 'topbar-panels-status',
    label: 'Status',
    hint: 'Connection status strip.',
  },
];

const TOPBAR_KEYS = [...TOPBAR_GROUPS, ...TOPBAR_PANELS].map((item) => item.key);

function countTopbarOn(items: TopbarToggle[]): number {
  return items.reduce((n, item) => n + (store.topbar[item.key] ? 1 : 0), 0);
}

function writeTopbarKey(key: keyof TopbarSettings, value: boolean) {
  setStore('topbar', key, value);
  persist();
}

function applyTopbarDefaults() {
  batch(() => {
    for (const key of TOPBAR_KEYS) {
      setStore('topbar', key, DEFAULTS.topbar[key]);
    }
  });
  persist();
}

function setTopbarKeys(items: TopbarToggle[], value: boolean) {
  batch(() => {
    for (const item of items) {
      setStore('topbar', item.key, value);
    }
  });
  persist();
}

function settingsFooterStatus(tab: SettingsTabId, scaleLabel: string): string {
  switch (tab) {
    case 'theme':
      return 'Live apply · presets, saved themes, and motion';
    case 'editor':
      return 'Live apply · lint, hover, complete, and marks';
    case 'topbar':
      return 'Live apply · groups and panel buttons';
    case 'keyboard':
      return 'Live apply · chords and conflicts';
    case 'notifications':
      return 'Live apply · browser alerts, toasts, and flood control';
    case 'data':
      return 'Live apply · keys stay in this session · not written to disk';
    default:
      return `Save to keep · scale ${scaleLabel} · Worker key saves as you type`;
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
            onChange={(v) => writeTopbarKey(item.key, v)}
          />
        )}
      </For>
    </div>
  );
}

/**
 * Settings studio page: tabbed general/data/editor/theme/topbar/keyboard/
 * notifications sections. Local signals seed from the store so edits can be
 * validated (history-bar clamps) before they are written back.
 *
 * @param props - Close handler and the tab to open first (deep link / palette).
 * @returns The settings page body rendered inside the studio shell.
 */
export function SettingsPage(props: {
  onClose: () => void;
  initialTab?: SettingsTabId;
}): JSX.Element {
  const [chartInterval, setChartInterval] = createSignal(store.interval);
  const [historyBars, setHistoryBars] = createSignal(
    clampHistoryBars(store.historyBars ?? HISTORY_BARS_DEFAULT),
  );
  const [rollingWindowBars, setRollingWindowBars] = createSignal(
    clampRollingWindowBars(store.rollingWindowBars ?? ROLLING_WINDOW_DEFAULT),
  );
  const [refreshSec, setRefreshSec] = createSignal(store.watchlist.refreshSec || 15);
  const [preferAfterLoad, setPreferAfterLoad] = createSignal(!!store.live.preferAfterLoad);
  const [rerunOn, setRerunOn] = createSignal<'every-tick' | 'bar-close'>(
    store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick',
  );
  const [hudCompact, setHudCompact] = createSignal(!!store.telemetry?.hud?.compact);
  const [hudDiagnostics, setHudDiagnostics] = createSignal(
    store.telemetry?.hud?.diagnostics === true,
  );
  createEffect(() => setHudDiagnostics(store.telemetry?.hud?.diagnostics === true));
  const [shareOnError, setShareOnError] = createSignal(!!store.telemetry?.shareOnError);
  const [uiScale, setUiScaleLocal] = createSignal(clampUiScale(store.uiScale ?? 1));
  const [priceScaleLabels, setPriceScaleLabels] = createSignal(
    store.priceScaleLabelsVisible !== false,
  );
  const [lastValueLabels, setLastValueLabels] = createSignal(
    store.lastValueLabelsVisible !== false,
  );
  const [lastValueNames, setLastValueNames] = createSignal(store.lastValueNamesVisible !== false);
  const [slippageNextOpen, setSlippageNextOpen] = createSignal(
    !!store.strategyUi?.slippageNextOpen,
  );
  const [invertTradeLabels, setInvertTradeLabels] = createSignal(
    !!store.strategyUi?.invertTradeLabels,
  );
  const [exactOnCandle, setExactOnCandle] = createSignal(store.strategyUi?.exactOnCandle !== false);
  const [resultsAutoOpen, setResultsAutoOpen] = createSignal(store.resultsAutoOpen !== false);
  const [autoload, setAutoload] = createSignal(store.autoload !== false);
  const [mcpConnect, setMcpConnect] = createSignal(loadMcpPrefs().connect);
  const [mcpBridge, setMcpBridge] = createSignal(mcpBridgeState());
  const [storage, setStorage] = createSignal(store.activePlugins?.storage || 'local');
  const [cloudEndpoint, setCloudEndpoint] = createSignal(resolveCloudConfig().endpoint);
  const [cloudApiKey, setCloudApiKey] = createSignal(resolveCloudConfig().apiKey);
  const [cloudProbeMsg, setCloudProbeMsg] = createSignal('');
  const [cloudProbeTone, setCloudProbeTone] = createSignal<ProbeTone | ''>('');
  const [datasetFlushMsg, setDatasetFlushMsg] = createSignal('');
  const [datasetFlushTone, setDatasetFlushTone] = createSignal<'ok' | 'err'>('ok');
  const storages = () => listStorages();
  const [tab, setTab] = createSignal<SettingsTabId>(
    isSettingsTabId(props.initialTab) ? props.initialTab : 'general',
  );

  // Close after the success hold so the footer shows Done briefly.
  const saveFb = useMicrofeedback({
    successHoldMs: 550,
    afterSuccess: () => props.onClose(),
  });
  const reloadFb = useMicrofeedback({ successHoldMs: 700 });
  const resetFb = useMicrofeedback({ successHoldMs: 700 });
  const generateKeyFb = useMicrofeedback({ successHoldMs: 700 });
  const probeFb = useMicrofeedback({ successHoldMs: 700, errorHoldMs: 1100 });
  const flushFb = useMicrofeedback({ successHoldMs: 800, errorHoldMs: 1100 });
  const topbarShowAllFb = useMicrofeedback({ successHoldMs: 700 });
  const topbarResetFb = useMicrofeedback({ successHoldMs: 700 });

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

  const persistSettings = async () => {
    const prevInterval = store.interval;
    const prevHistoryBars = clampHistoryBars(store.historyBars);
    const prevRollingWindow = clampRollingWindowBars(store.rollingWindowBars);
    const nextInterval = chartInterval().trim() || prevInterval;
    const nextHistoryBars = clampHistoryBars(historyBars());
    const nextRollingWindow = clampRollingWindowBars(rollingWindowBars());
    const nextRefresh = Math.min(120, Math.max(5, Math.round(Number(refreshSec()) || 15)));
    const nextUiScale = clampUiScale(uiScale());

    setStore('interval', nextInterval);
    setStore('historyBars', nextHistoryBars);
    setStore('rollingWindowBars', nextRollingWindow);
    setStore('watchlist', 'refreshSec', nextRefresh);
    setStore('live', 'preferAfterLoad', preferAfterLoad());
    setStore('live', 'rerunOn', rerunOn());
    syncLiveToPreference();
    setStore('telemetry', 'hud', 'compact', hudCompact());
    setStore('telemetry', 'hud', 'diagnostics', hudDiagnostics());
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
    if (store.symbol && (nextInterval !== prevInterval || nextHistoryBars !== prevHistoryBars)) {
      void loadSymbolData(store.symbol, nextInterval, store.source);
    } else if (nextRollingWindow !== prevRollingWindow) {
      // The Rolling window changed — re-slice the painted chart so it matches
      // the new setting instead of keeping the old window until the next load.
      void (async () => {
        try {
          const { applyChartWindow } = await import('../../data/data-source-manager');
          await applyChartWindow(nextRollingWindow);
        } catch {
          /* re-slice is best-effort */
        }
      })();
    }
  };

  const closeWithoutSave = () => {
    applyUiScale(store.uiScale);
    props.onClose();
  };

  const onReloadChart = () => reloadFb.run(() => reloadChart());

  const onProbeCloud = () =>
    probeFb.run(async () => {
      writeStoredCloudConfig(cloudEndpoint(), cloudApiKey());
      setCloudProbeMsg('');
      setCloudProbeTone('');
      const r = await probeCloudStorage({
        endpoint: cloudEndpoint(),
        apiKey: cloudApiKey(),
      });
      setCloudProbeTone(r.ok ? 'ok' : 'err');
      setCloudProbeMsg(r.message);
      if (!r.ok) throw new Error(r.message);
      rotateMcpBridge({ immediate: true });
    });

  const onFlushDatasets = () => {
    if (flushFb.state() === 'loading') return;
    const ok =
      typeof window !== 'undefined'
        ? window.confirm(
            'Flush the dataset manager?\n\n' +
              'Deletes every cached OHLCV dataset (bars + metadata) from memory, ' +
              'the local IndexedDB cache, and the remote dataset stores (git / cloud) — ' +
              "and the engine's own copy of the venue data (per series).\n\n" +
              'The chart keeps the bars it already shows until you reload the symbol.',
          )
        : true;
    if (!ok) return;
    void flushFb.run(async () => {
      setDatasetFlushMsg('');
      const flushed = await flushLocalAndEngine();
      const removed = flushed.local;
      const engine = flushed.engine;
      const engineNote = engine.failed.length
        ? ` · engine: ${engine.keys.length} series flushed, ${engine.failed.length} could not be dropped`
        : ` · engine: ${engine.keys.length} series flushed`;
      const msg =
        `Dataset manager flushed · ${removed} dataset${removed === 1 ? '' : 's'} removed` +
        `${engineNote}.`;
      setDatasetFlushTone(engine.failed.length ? 'err' : 'ok');
      setDatasetFlushMsg(msg);
      setStatus('ready', msg, { toast: true, source: 'settings' });
      if (engine.failed.length) throw new Error(msg);
    });
  };

  const onResetUi = () => {
    if (resetFb.state() === 'loading') return;
    const ok =
      typeof window !== 'undefined'
        ? window.confirm(
            'Reset UI layout to defaults?\n\n' +
              'Restores panel docks, sizes, open/closed state, and UI scale.\n' +
              'Does not clear chart data, scripts, drawings, or plugins.',
          )
        : true;
    if (!ok) return;
    void resetFb.run(async () => {
      resetUiLayout();
      setUiScaleLocal(1);
      setHudCompact(false);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          try {
            getManager()?.resizeAll?.();
          } catch {
            /* ignore */
          }
          resolve();
        });
      });
    });
  };

  const onGenerateDemoKey = () =>
    generateKeyFb.run(async () => {
      const key = generateDemoApiKey();
      setCloudApiKey(key);
      writeStoredCloudConfig(cloudEndpoint(), key);
      setCloudProbeTone('info');
      setCloudProbeMsg('Demo key ready · Test connection, then Save if you changed other fields.');
      rotateMcpBridge({ immediate: true });
    });

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
            {/* ── Left: chart chrome & workspace ─────────────────────── */}
            <div class="ax-split-col">
              <StudioSection
                title="Appearance"
                lead="UI density for the shell. Chart candles stay pixel-sharp."
                testId="axis-ui-scale-field"
                headerEnd={
                  <span class="ax-chip ax-chip--tag" data-testid="axis-ui-scale-value">
                    {formatUiScalePct(uiScale())}
                  </span>
                }
              >
                <StudioField
                  label="UI scale"
                  for="axis-ui-scale"
                  hint="Live preview of text, icons, and spacing. Save to keep."
                >
                  <span hidden>{formatUiScalePct(uiScale())}</span>
                  <StudioRange
                    id="axis-ui-scale"
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={UI_SCALE_STEP}
                    value={uiScale()}
                    testId="axis-ui-scale"
                    ariaLabel="UI scale"
                    format={formatUiScalePct}
                    onInput={previewScale}
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
                title="Chart data"
                lead="What loads into the dataset and what the engine evaluates."
              >
                <StudioField
                  label="Default interval"
                  for="axis-default-interval"
                  hint="Used on Load / Reload and when opening a watchlist symbol."
                >
                  <StudioSelect
                    id="axis-default-interval"
                    value={chartInterval()}
                    icon={<Icons.clock />}
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
                  hint={`Dataset depth on Load (${HISTORY_BARS_MIN}–${HISTORY_BARS_MAX}, default ${HISTORY_BARS_DEFAULT}). DSM pages venue requests until this depth.`}
                >
                  <StudioInput
                    id="axis-history-bars"
                    type="number"
                    mono
                    icon={<Icons.database />}
                    selectOnFocus
                    min={HISTORY_BARS_MIN}
                    max={HISTORY_BARS_MAX}
                    step={50}
                    suffix="bars"
                    value={historyBars()}
                    onInput={(v) => setHistoryBars(Number(v))}
                    onChange={(v) => setHistoryBars(clampHistoryBars(v))}
                  />
                </StudioField>
                <StudioField
                  label="Rolling window"
                  for="axis-rolling-window-bars"
                  hint={`Newest bars on the chart and in each run (${ROLLING_WINDOW_MIN}–${ROLLING_WINDOW_MAX}, default ${ROLLING_WINDOW_DEFAULT}). Dataset keeps full history; lower this to cut payload size. Status-bar bar count edits inline.`}
                >
                  <StudioInput
                    id="axis-rolling-window-bars"
                    type="number"
                    mono
                    icon={<Icons.activity />}
                    selectOnFocus
                    min={ROLLING_WINDOW_MIN}
                    max={ROLLING_WINDOW_MAX}
                    step={500}
                    suffix="bars"
                    value={rollingWindowBars()}
                    onInput={(v) => setRollingWindowBars(Number(v))}
                    onChange={(v) => setRollingWindowBars(clampRollingWindowBars(v))}
                  />
                </StudioField>
                <StudioField
                  label="Watchlist REST fallback"
                  for="axis-watchlist-refresh"
                  hint="Poll interval when WebSocket quotes fail."
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
                <StudioToggle
                  id="axis-autoload"
                  testId="axis-settings-autoload"
                  checked={autoload()}
                  onChange={setAutoload}
                  label="Autoload chart"
                  hint="On: symbol / interval / venue changes fetch immediately (Load hidden). Off: edit fields, then click Load."
                />
              </StudioSection>

              <StudioSection
                title="Chart labels"
                lead="Matches the chart [$] [N] [T] controls on the price scale."
              >
                <div class="ax-toggle-grid">
                  <StudioToggle
                    id="axis-price-scale-labels"
                    testId="axis-settings-price-scale-labels"
                    checked={priceScaleLabels()}
                    onChange={setPriceScaleLabels}
                    label="Right price scale"
                    hint="Price numbers on the right axis. Off collapses the gutter."
                  />
                  <StudioToggle
                    id="axis-last-value-labels"
                    testId="axis-settings-last-value-labels"
                    checked={lastValueLabels()}
                    onChange={setLastValueLabels}
                    label="Last-value badges"
                    hint="Last prices for plots, volume, and hlines."
                  />
                  <StudioToggle
                    id="axis-last-value-names"
                    testId="axis-settings-last-value-names"
                    checked={lastValueNames()}
                    onChange={setLastValueNames}
                    label="Names on badges"
                    hint="Show plot titles (RSI, Overbought) beside the value."
                  />
                </div>
              </StudioSection>

              <StudioSection
                title="Strategy & results"
                lead="Fill marks default to signal-bar close. Same controls appear on Results → Strategy."
              >
                <div class="ax-toggle-grid">
                  <StudioToggle
                    id="axis-strategy-slippage"
                    testId="axis-settings-strategy-slippage"
                    checked={slippageNextOpen()}
                    onChange={setSlippageNextOpen}
                    label="Slippage → next open"
                    hint="Off: fill at signal close. On: fill at next bar open."
                  />
                  <StudioToggle
                    id="axis-strategy-invert-labels"
                    testId="axis-settings-strategy-invert-labels"
                    checked={invertTradeLabels()}
                    onChange={setInvertTradeLabels}
                    label="Invert long / short"
                    hint="Default: long below, short above."
                  />
                  <StudioToggle
                    id="axis-strategy-exact-marks"
                    testId="axis-settings-strategy-exact-marks"
                    checked={exactOnCandle()}
                    onChange={setExactOnCandle}
                    label="Exact marks on candle"
                    hint="Body circle plus directional side arrows."
                  />
                  <StudioToggle
                    id="axis-results-auto-open"
                    testId="axis-settings-results-auto-open"
                    checked={resultsAutoOpen()}
                    onChange={setResultsAutoOpen}
                    label="Auto-open Results"
                    hint="Open Results after strategy() runs. Indicators never auto-open."
                  />
                </div>
              </StudioSection>

              <StudioSection
                title="Workspace"
                lead="Local actions. Engine and endpoint stay on Runtime."
                testId="axis-settings-workspace"
              >
                <div class="ax-toolbar">
                  <AppButton
                    design="soft"
                    tone="ghost"
                    size="sm"
                    testId="axis-settings-reload-chart"
                    feedback={reloadFb.state()}
                    icon={<Icons.refresh />}
                    title="Refetch OHLCV for the active symbol"
                    onClick={() => void onReloadChart()}
                  >
                    Reload chart
                  </AppButton>
                  <AppButton
                    design="soft"
                    tone="ghost"
                    size="sm"
                    testId="axis-settings-reset-ui"
                    feedback={resetFb.state()}
                    icon={<Icons.reset />}
                    title="Restore docks, sizes, and UI scale"
                    onClick={onResetUi}
                  >
                    Reset layout
                  </AppButton>
                  <WorkspaceSnapshotMenu />
                </div>
              </StudioSection>
            </div>

            {/* ── Right: live, status, cloud ──────────────────────────── */}
            <div class="ax-split-col">
              <StudioSection
                title="Live stream"
                lead="Venue WebSocket after history loads. Turn off for replay-only or offline."
              >
                <StudioToggle
                  id="axis-prefer-live"
                  testId="axis-settings-live-enabled"
                  checked={preferAfterLoad()}
                  onChange={setPreferAfterLoad}
                  label="Enable live stream"
                  hint="Connects after bars load, and on boot when history is already present."
                />
                <StudioField
                  label="Indicator re-run"
                  for="axis-rerun-on"
                  hint="Bar-close uses venue closed flags or bar time advance."
                >
                  <StudioSelect
                    id="axis-rerun-on"
                    value={rerunOn()}
                    icon={<Icons.zap />}
                    onChange={(v) => setRerunOn(v === 'bar-close' ? 'bar-close' : 'every-tick')}
                  >
                    <option value="every-tick">Every tick (responsive)</option>
                    <option value="bar-close">Bar close only (lighter)</option>
                  </StudioSelect>
                </StudioField>
              </StudioSection>

              <StudioSection
                title="Status HUD"
                lead="Connection strip under the chart. Diagnostics expand engine, path, and storage chips."
              >
                <div class="ax-toggle-grid">
                  <StudioToggle
                    id="axis-hud-diagnostics"
                    testId="axis-settings-hud-diagnostics"
                    checked={hudDiagnostics()}
                    onChange={(v) => {
                      setHudDiagnostics(v);
                      setStore('telemetry', 'hud', 'diagnostics', v);
                      flushPersist();
                    }}
                    label="Connection diagnostics"
                    hint="Show engine, path, source, stream, and storage chips."
                  />
                  <StudioToggle
                    id="axis-hud-compact"
                    checked={hudCompact()}
                    onChange={setHudCompact}
                    label="Compact chips"
                    hint="When diagnostics are on, hide source / stream / storage."
                  />
                  <StudioToggle
                    id="axis-share-on-error"
                    testId="axis-settings-share-on-error"
                    checked={shareOnError()}
                    onChange={setShareOnError}
                    label="Ask to share on errors"
                    hint="Telemetry prompt only · nothing uploads automatically."
                  />
                </div>
              </StudioSection>

              <StudioSection
                title="Script library"
                lead="Where scripts persist. Switching copies the library and never deletes the source."
                testId="axis-settings-storage"
              >
                <StudioField
                  label="Storage"
                  for="axis-studio-storage"
                  hint="Cloud uses the Worker URL and key below (shared with MCP). Git credentials stay in Script Library."
                >
                  <StudioSelect
                    id="axis-studio-storage"
                    value={storage()}
                    icon={<Icons.database />}
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
                title="Cloud Worker & MCP"
                lead="One browser-stored key unlocks /api/scripts and the MCP bridge (Authorization: Bearer)."
                testId="axis-settings-worker"
                headerEnd={
                  <>
                    <StudioStatus
                      status={bridgeHealth(mcpBridge().status)}
                      label={`Bridge ${mcpBridge().status}`}
                    />
                    <AppButton
                      design="soft"
                      tone="ghost"
                      size="sm"
                      testId="axis-studio-cloud-probe"
                      feedback={probeFb.state()}
                      title="Probe Worker health with the URL and key below"
                      onClick={() => void onProbeCloud()}
                    >
                      Test
                    </AppButton>
                  </>
                }
              >
                <StudioField
                  label="Worker URL"
                  for="axis-studio-cloud-endpoint"
                  hint="Production Worker or local wrangler (e.g. http://127.0.0.1:8787)."
                >
                  <StudioInput
                    id="axis-studio-cloud-endpoint"
                    mono
                    icon={<Icons.server />}
                    value={cloudEndpoint()}
                    placeholder="https://worker.axis.hoox.sh"
                    spellcheck={false}
                    copyable
                    testId="axis-studio-cloud-endpoint"
                    onInput={setCloudEndpoint}
                    onBlur={() => writeStoredCloudConfig(cloudEndpoint(), cloudApiKey())}
                  />
                </StudioField>
                <StudioField
                  label="Worker API key"
                  for="axis-studio-cloud-apikey"
                  hint="pn_… from /api/keys, or Generate demo key with ALLOW_OPEN_KEYS=1. Saved in this browser as you type."
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
                      writeStoredCloudConfig(cloudEndpoint(), v);
                      rotateMcpBridge();
                    }}
                  />
                </StudioField>
                <div class="ax-toolbar">
                  <AppButton
                    design="soft"
                    tone="ghost"
                    size="sm"
                    testId="axis-studio-cloud-generate"
                    feedback={generateKeyFb.state()}
                    onClick={() => void onGenerateDemoKey()}
                  >
                    Generate demo key
                  </AppButton>
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
                  hint="Answers app_invoke / app_get / app_set. Worker-only tools work without a tab."
                />
                <Show when={bridgeDetail(mcpBridge(), !!cloudApiKey())}>
                  <StudioHint>{bridgeDetail(mcpBridge(), !!cloudApiKey())}</StudioHint>
                </Show>
              </StudioSection>

              <StudioSection
                title="On-Chain"
                lead="Public TVL / DEX metrics via the Worker proxy — not a wallet."
                testId="axis-settings-onchain"
                headerEnd={
                  <AppButton
                    design="soft"
                    tone="ghost"
                    size="sm"
                    testId="axis-settings-open-onchain"
                    onClick={() => {
                      toggleOnchainPanel();
                      props.onClose();
                    }}
                  >
                    Open panel
                  </AppButton>
                }
              >
                <StudioHint>
                  <code>…/api/onchain/llama</code>
                  {' · '}
                  <code>…/api/onchain/gecko</code>
                  {' · '}
                  local <code>http://127.0.0.1:8787</code>
                </StudioHint>
              </StudioSection>
            </div>
          </div>
        </SettingsTabPanel>

        <SettingsTabPanel id="data" active={tab()}>
          <div class="ax-split">
            {/* ── Left: credentials (primary) ─────────────────────────── */}
            <div class="ax-split-col">
              <ExchangeCredentialsPanel />
            </div>

            {/* ── Right: source config + cache ───────────────────────── */}
            <div class="ax-split-col">
              <StudioSection
                title="Source & stream"
                lead="Advanced plugin fields hidden from the topbar. Historical bars depth stays on General."
                testId="axis-settings-plugins"
                headerEnd={
                  <span class="ax-chip ax-chip--tag" title="Active source · stream">
                    {getActiveSourceId()}
                    {' · '}
                    {getActiveStreamId() || 'no stream'}
                  </span>
                }
              >
                <PluginConfigRow
                  layout="stacked"
                  showAdvanced
                  onApplied={() => {
                    void reloadChart();
                  }}
                />
              </StudioSection>

              <StudioSection
                title="Dataset cache"
                lead="OHLCV bars + metadata in memory, IndexedDB, and remote stores (git / cloud)."
                testId="axis-settings-datasets"
                headerEnd={
                  <>
                    <AppButton
                      design="soft"
                      tone="ghost"
                      size="sm"
                      testId="axis-settings-open-dsm"
                      title="Open Data Source Manager"
                      onClick={() => {
                        toggleDataSourcePanel();
                        props.onClose();
                      }}
                    >
                      Open DSM
                    </AppButton>
                    <AppButton
                      design="soft"
                      tone="danger"
                      size="sm"
                      testId="axis-settings-flush-datasets"
                      feedback={flushFb.state()}
                      icon={<Icons.trash />}
                      title="Delete every cached OHLCV dataset"
                      onClick={onFlushDatasets}
                    >
                      Flush
                    </AppButton>
                  </>
                }
              >
                <Show
                  when={datasetFlushMsg()}
                  fallback={
                    <StudioHint>
                      Flush clears every cached dataset. Chart bars already on screen stay until you
                      reload the symbol.
                    </StudioHint>
                  }
                >
                  <p
                    class={datasetFlushTone() === 'err' ? 'ax-error' : 'ax-hint ax-hint--accent'}
                    role="status"
                    data-testid="axis-settings-flush-datasets-msg"
                  >
                    {datasetFlushMsg()}
                  </p>
                </Show>
              </StudioSection>
            </div>
          </div>
        </SettingsTabPanel>

        <SettingsTabPanel id="editor" active={tab()}>
          <EditorIntelPanel />
        </SettingsTabPanel>

        <SettingsTabPanel id="theme" active={tab()}>
          <div class="ax-stack">
            <ThemePanel />
            <EffectsPanel />
          </div>
        </SettingsTabPanel>

        <SettingsTabPanel id="topbar" active={tab()}>
          <div class="ax-split">
            <div class="ax-split-col">
              <StudioSection
                title="Topbar groups"
                lead="Which chrome clusters stay in the module bar."
                testId="axis-settings-topbar-groups"
                headerEnd={
                  <span class="ax-chip ax-chip--tag" data-testid="axis-topbar-groups-count">
                    {countTopbarOn(TOPBAR_GROUPS)}/{TOPBAR_GROUPS.length}
                  </span>
                }
              >
                <div class="ax-toolbar">
                  <AppButton
                    design="soft"
                    tone="ghost"
                    size="sm"
                    testId="axis-topbar-show-all"
                    feedback={topbarShowAllFb.state()}
                    title="Turn every group and panel button on"
                    onClick={() =>
                      void topbarShowAllFb.run(async () => {
                        setTopbarKeys(TOPBAR_GROUPS, true);
                        setTopbarKeys(TOPBAR_PANELS, true);
                      })
                    }
                  >
                    Show all
                  </AppButton>
                  <AppButton
                    design="soft"
                    tone="ghost"
                    size="sm"
                    testId="axis-topbar-reset"
                    feedback={topbarResetFb.state()}
                    title="Restore the default topbar visibility map"
                    onClick={() =>
                      void topbarResetFb.run(async () => {
                        applyTopbarDefaults();
                      })
                    }
                  >
                    Reset defaults
                  </AppButton>
                </div>
                <TopbarToggleGrid items={TOPBAR_GROUPS} />
              </StudioSection>
            </div>

            <div class="ax-split-col">
              <StudioSection
                title="Panel buttons"
                lead="Buttons inside the Panels group. Prep them here even when that group is off."
                testId="axis-settings-topbar-panels"
                headerEnd={
                  <span class="ax-chip ax-chip--tag" data-testid="axis-topbar-panels-count">
                    {countTopbarOn(TOPBAR_PANELS)}/{TOPBAR_PANELS.length}
                  </span>
                }
              >
                <Show when={!store.topbar.panels}>
                  <StudioHint>
                    Panels group is off — these buttons stay hidden in the topbar until you turn
                    that group back on.
                  </StudioHint>
                </Show>
                <TopbarToggleGrid items={TOPBAR_PANELS} columns={3} />
              </StudioSection>
            </div>
          </div>
        </SettingsTabPanel>

        <SettingsTabPanel id="keyboard" active={tab()}>
          <KeyboardSettingsPanel />
        </SettingsTabPanel>

        <SettingsTabPanel id="notifications" active={tab()}>
          <NotificationsPanel onClose={props.onClose} />
        </SettingsTabPanel>
      </div>
      <StudioFooter status={footerStatus()}>
        <AppButton design="soft" tone="ghost" size="sm" onClick={closeWithoutSave}>
          {LIVE_TABS.has(tab()) ? 'Close' : 'Cancel'}
        </AppButton>
        <Show when={tab() === 'general'}>
          <AppButton
            design="soft"
            tone="primary"
            size="sm"
            testId="axis-settings-save"
            feedback={saveFb.state()}
            icon={<Icons.check />}
            onClick={() => void saveFb.run(persistSettings)}
          >
            Save
          </AppButton>
        </Show>
      </StudioFooter>
    </div>
  );
}
