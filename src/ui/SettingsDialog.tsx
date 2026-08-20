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
 * Application Settings modal — four tabs:
 * - **General**: engine, on-chain proxy note, storage, density, chart interval, live prefs, workspace
 * - **Data**: per-venue exchange API key / secret / passphrase (session vault)
 * - **Editor**: lint / hover / completions / marks / timings (applies live, no Save)
 * - **Theme**: chart Theme Manager (bar colors, chart.bg_color / chart.fg_color, …)
 *
 * Local form state is seeded from `store` when the dialog opens (not on every
 * store mutation while open). Save snapshots form fields, writes
 * `pluginsConfig` / `activePlugins` / layout prefs, then `flushPersist()`.
 * Editor and Theme apply live (no Save). Data tab Save writes the session
 * vault only — never `persist()` with secrets. Endpoint **Probe** uses
 * `probeEndpoint` without committing form values.
 *
 * Optional `initialTab` focuses General, Data, Editor, or Theme when opening
 * (e.g. command palette).
 */

import {
  Component,
  For,
  createEffect,
  createSignal,
  Show,
  createMemo,
  untrack,
  onCleanup,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { installFocusTrap } from './focus-trap';
import {
  store,
  setStore,
  flushPersist,
  setStatus,
  setActivePlugin,
  setUiScale,
  clampUiScale,
  clampHistoryBars,
  resetUiLayout,
  patchEditorIntel,
  resetEditorIntel,
  getEditorIntel,
  HISTORY_BARS_MIN,
  HISTORY_BARS_MAX,
  HISTORY_BARS_DEFAULT,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_STEP,
  applyUiScale,
  toggleOnchainPanel,
} from '../store';
import { Icons } from './icons';
import { HooxLoader } from './HooxLoader';
import { probeEndpoint } from '../indicators/runner';
import { listEngines } from '../engines/catalog';
import { listStorages } from '../storage/catalog';
import { CapabilityBadges, engineOptionLabel } from './plugin-badges';
import { getEngine } from '../engines/catalog';
import { pluginKey } from '../plugins/types';
import {
  WATCHLIST_INTERVALS,
  WATCHLIST_REFRESH_OPTIONS,
} from '../data/watchlist-tickers';
import { loadSymbolData, reloadChart } from '../data/load-symbol';
import { getManager } from '../chart/manager-access';
import { UI_SCALE_PRESETS, formatUiScalePct } from './ui-scale';
import { WorkspaceSnapshotMenu } from './WorkspaceSnapshotMenu';
import { ThemePanel } from './ThemePanel';
import {
  INTEL_HOVER_MS_MAX,
  INTEL_HOVER_MS_MIN,
  INTEL_IDLE_MS_MAX,
  INTEL_IDLE_MS_MIN,
  INTEL_MAX_OPTIONS_MAX,
  INTEL_MAX_OPTIONS_MIN,
  INTEL_TAB_SWITCH_MS_MAX,
  INTEL_TAB_SWITCH_MS_MIN,
  INTEL_TIMEOUT_MS_MAX,
  INTEL_TIMEOUT_MS_MIN,
  type EditorIntelSettings,
} from '../editor/editor-intel';
import * as cred from '../data/credentials';
import { fetchSignedJson, hasSignedCreds } from '../data/signed-fetch';
import type { VenueId } from '../data/venues/types';
import {
  EXCHANGE_CREDENTIAL_VENUES,
  EXCHANGE_CREDENTIAL_VENUE_LABELS,
  defaultExchangeCredentialVenue,
  isExchangeCredentialVenue,
  venueNeedsPassphrase,
  type ExchangeCredentialVenue,
} from './exchange-credentials-form';

/** PYNE Runtime modes for the server/worker engine plugin config. */
export type EngineExecMode = 'interpret' | 'compile' | 'auto';

const EXEC_MODE_OPTIONS: { value: EngineExecMode; label: string; hint: string }[] = [
  {
    value: 'interpret',
    label: 'Interpreter',
    hint: 'AST walk — full language surface, slower on large history',
  },
  {
    value: 'compile',
    label: 'Compiler',
    hint: 'Numba/numpy path — faster; some constructs stay object-mode',
  },
  {
    value: 'auto',
    label: 'Auto',
    hint: 'Try compile first; fall back to interpret on failure',
  },
];

function normalizeExecMode(raw: unknown, fallback: EngineExecMode = 'interpret'): EngineExecMode {
  const s = String(raw || fallback);
  if (s === 'compile' || s === 'auto' || s === 'interpret') return s;
  return fallback;
}

function readEnginePluginConfig(engineId: string): Record<string, unknown> {
  const pc = store.pluginsConfig || {};
  return (pc[pluginKey('engine', engineId)] || pc[engineId] || {}) as Record<string, unknown>;
}

export type SettingsTabId = 'general' | 'data' | 'editor' | 'theme';

function isSettingsTabId(v: unknown): v is SettingsTabId {
  return v === 'general' || v === 'data' || v === 'editor' || v === 'theme';
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which tab to show when the dialog opens (default general). */
  initialTab?: SettingsTabId;
}

const SETTINGS_TABS: { id: SettingsTabId; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'Engine · density · chart · live' },
  { id: 'data', label: 'Data', hint: 'Exchange keys · provider' },
  { id: 'editor', label: 'Editor', hint: 'Lint · hover · complete · marks · timings' },
  { id: 'theme', label: 'Theme', hint: 'Bars · canvas · Pine chart.bg_color' },
];

/** Modal settings form; parent controls `open` / `onClose`. */
export const SettingsDialog: Component<Props> = (props) => {
  const [endpoint, setEndpoint] = createSignal(store.endpoint);
  const [engine, setEngine] = createSignal(store.engine);
  const [execMode, setExecMode] = createSignal<EngineExecMode>('interpret');
  const [preferWs, setPreferWs] = createSignal(true);
  const [apiKey, setApiKey] = createSignal('');
  const [storage, setStorage] = createSignal(store.activePlugins?.storage || 'local');
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
  const [probing, setProbing] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  const [probeMsg, setProbeMsg] = createSignal('');
  const [tab, setTab] = createSignal<SettingsTabId>('general');

  const engines = createMemo(() => listEngines());
  const storages = createMemo(() => listStorages());

  const selectedEngine = createMemo(() => getEngine(engine()) || engines()[0]);
  /** Show endpoint field only for engines that take a backend URL (not pyodide). */
  const needsEndpoint = createMemo(() => {
    const e = selectedEngine();
    return e?.id === 'server' || !!e?.configSchema?.endpoint;
  });
  /**
   * Execution mode: always for built-in server/pyodide (by id), plus any engine
   * that advertises configSchema.mode. Do not rely only on schema discovery —
   * a dynamic plugin that clobbered `server` used to hide the control.
   */
  const hasExecMode = createMemo(() => {
    const id = engine() || selectedEngine()?.id || '';
    if (id === 'server' || id === 'pyodide' || id === 'pyne-worker') return true;
    const schema = selectedEngine()?.configSchema;
    if (!schema?.mode) return false;
    // Accept select schemas even if type string was lost on a shallow clone
    return schema.mode.type === 'select' || Array.isArray(schema.mode.options);
  });
  const hasPreferWs = createMemo(() => {
    const id = engine() || selectedEngine()?.id || '';
    if (id === 'server') return true;
    return selectedEngine()?.configSchema?.preferWs?.type === 'boolean';
  });
  /** Optional API key (pyne-worker, secured Pro hosts). */
  const hasApiKey = createMemo(() => {
    return selectedEngine()?.configSchema?.apiKey?.type === 'string';
  });
  const execModeOptions = createMemo(() => {
    const opts = selectedEngine()?.configSchema?.mode?.options;
    if (!opts?.length) return EXEC_MODE_OPTIONS;
    const filtered = EXEC_MODE_OPTIONS.filter((o) => opts.includes(o.value));
    return filtered.length ? filtered : EXEC_MODE_OPTIONS;
  });
  const execModeHint = createMemo(
    () => EXEC_MODE_OPTIONS.find((o) => o.value === execMode())?.hint || '',
  );

  const hydrateEngineFields = (engineId: string) => {
    const cfg = readEnginePluginConfig(engineId);
    const schema = getEngine(engineId)?.configSchema;
    const defaultMode = normalizeExecMode(schema?.mode?.default, 'interpret');
    setExecMode(normalizeExecMode(cfg.mode, defaultMode));
    if (typeof cfg.preferWs === 'boolean') setPreferWs(cfg.preferWs);
    else setPreferWs(schema?.preferWs?.default !== false);
    setApiKey(typeof cfg.apiKey === 'string' ? cfg.apiKey : String(schema?.apiKey?.default || ''));
    // Seed pyne-worker URL into the endpoint field when switching engines
    if (engineId === 'pyne-worker') {
      const def =
        String(schema?.endpoint?.default || 'https://pyne-worker.cryptolinx.workers.dev').replace(
          /\/$/,
          '',
        );
      const cur = endpoint().trim();
      if (!cur || /127\.0\.0\.1|localhost|:5002/i.test(cur)) {
        setEndpoint(def);
      }
    }
  };

  /**
   * Seed form only when the dialog *opens*. Do not re-read the store on every
   * store mutation while open — Save calls setStore many times and a reactive
   * hydrate would reset local signals mid-save (wrong values persisted).
   */
  createEffect((wasOpen?: boolean) => {
    const isOpen = props.open;
    if (isOpen && !wasOpen) {
      untrack(() => {
        setEndpoint(store.endpoint);
        setEngine(store.engine);
        hydrateEngineFields(store.engine);
        setStorage(store.activePlugins?.storage || 'local');
        setChartInterval(store.interval);
        setHistoryBars(clampHistoryBars(store.historyBars ?? HISTORY_BARS_DEFAULT));
        setRefreshSec(store.watchlist.refreshSec || 15);
        setPreferAfterLoad(!!store.live.preferAfterLoad);
        setRerunOn(store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick');
        setHudCompact(!!store.telemetry?.hud?.compact);
        setShareOnError(!!store.telemetry?.shareOnError);
        setUiScaleLocal(clampUiScale(store.uiScale ?? 1));
        setPriceScaleLabels(store.priceScaleLabelsVisible !== false);
        setLastValueLabels(store.lastValueLabelsVisible !== false);
        setLastValueNames(store.lastValueNamesVisible !== false);
        setSlippageNextOpen(!!store.strategyUi?.slippageNextOpen);
        setInvertTradeLabels(!!store.strategyUi?.invertTradeLabels);
        setExactOnCandle(store.strategyUi?.exactOnCandle !== false);
        setProbeMsg('');
        setTab(isSettingsTabId(props.initialTab) ? props.initialTab : 'general');
      });
    }
    return isOpen;
  });

  // Live-switch tab when parent changes initialTab while already open
  createEffect(() => {
    if (!props.open) return;
    const t = props.initialTab;
    if (isSettingsTabId(t)) setTab(t);
  });

  /** Live density preview while dragging (persists on Save or preset click). */
  const previewScale = (raw: number) => {
    const s = clampUiScale(raw);
    setUiScaleLocal(s);
    applyUiScale(s);
  };

  const save = async () => {
    // Snapshot every form field *before* any setStore. Mid-save store updates
    // must not re-enter the hydrate effect or re-read stale signals.
    const prevInterval = store.interval;
    const prevHistoryBars = clampHistoryBars(store.historyBars);
    const nextInterval = chartInterval().trim() || prevInterval;
    const nextHistoryBars = clampHistoryBars(historyBars());
    const nextRefresh = Math.min(120, Math.max(5, Math.round(Number(refreshSec()) || 15)));
    const nextEngine = engine();
    const nextEndpoint = endpoint().trim();
    const nextStorage = storage();
    const nextPreferAfterLoad = preferAfterLoad();
    const nextRerunOn = rerunOn();
    const nextHudCompact = hudCompact();
    const nextShareOnError = shareOnError();
    const nextUiScale = clampUiScale(uiScale());
    const nextPriceScaleLabels = priceScaleLabels();
    const nextLastValueLabels = lastValueLabels();
    const nextLastValueNames = lastValueNames();
    const nextSlippage = slippageNextOpen();
    const nextInvertLabels = invertTradeLabels();
    const nextExactMarks = exactOnCandle();
    const nextExecMode = execMode();
    const nextPreferWs = preferWs();
    const writeEndpoint = needsEndpoint();
    const writeExecMode = hasExecMode();
    const writePreferWs = hasPreferWs();
    const writeApiKey = hasApiKey();
    const nextApiKey = apiKey().trim();

    // Batch all durable fields before persist so one flush sees full state
    setStore('endpoint', nextEndpoint);
    setStore('interval', nextInterval);
    setStore('historyBars', nextHistoryBars);
    setStore('watchlist', 'refreshSec', nextRefresh);
    setStore('live', 'preferAfterLoad', nextPreferAfterLoad);
    setStore('live', 'rerunOn', nextRerunOn);
    setStore('telemetry', 'hud', 'compact', nextHudCompact);
    setStore('telemetry', 'shareOnError', nextShareOnError);
    setStore('uiScale', nextUiScale);
    setStore('priceScaleLabelsVisible', nextPriceScaleLabels);
    setStore('lastValueLabelsVisible', nextLastValueLabels);
    setStore('lastValueNamesVisible', nextLastValueNames);
    setStore('strategyUi', {
      slippageNextOpen: nextSlippage,
      invertTradeLabels: nextInvertLabels,
      exactOnCandle: nextExactMarks,
    });
    applyUiScale(nextUiScale);
    // setActivePlugin keeps flat engine/source fields + telemetry planes aligned
    setActivePlugin('engine', nextEngine);
    setActivePlugin('storage', nextStorage);

    // Always merge engine plugin config when any engine field is shown — include
    // endpoint so pluginsConfig cannot keep a stale URL over store.endpoint.
    if (writeEndpoint || writeExecMode || writePreferWs || writeApiKey) {
      const key = pluginKey('engine', nextEngine);
      const prev = readEnginePluginConfig(nextEngine);
      const nextCfg: Record<string, unknown> = { ...prev };
      if (writeEndpoint) nextCfg.endpoint = nextEndpoint;
      if (writeExecMode) nextCfg.mode = nextExecMode;
      if (writePreferWs) nextCfg.preferWs = nextPreferWs;
      if (writeApiKey) nextCfg.apiKey = nextApiKey;
      // reconcile replaces nested keys (Solid merges plain objects / function returns)
      setStore('pluginsConfig', key, reconcile(nextCfg));
    }

    // Write immediately so a quick reload cannot race the 200ms debounce
    flushPersist();
    const modePart = writeExecMode ? ` · mode=${nextExecMode}` : '';
    setStatus(
      'ready',
      `Settings saved · ${nextInterval} · ${nextHistoryBars} bars · refresh ${nextRefresh}s · engine=${nextEngine}${modePart} · live re-run=${nextRerunOn}`,
    );
    // Reload chart when interval or history depth changes
    if (
      store.symbol &&
      (nextInterval !== prevInterval || nextHistoryBars !== prevHistoryBars)
    ) {
      void loadSymbolData(store.symbol, nextInterval, store.source);
    }
    props.onClose();
  };

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      // Restore committed scale if user closed without Save after preview
      applyUiScale(store.uiScale);
      props.onClose();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      applyUiScale(store.uiScale);
      props.onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && tab() === 'general') save();
  };

  const closeWithoutSave = () => {
    applyUiScale(store.uiScale);
    props.onClose();
  };

  const testEndpoint = async () => {
    setProbing(true);
    setProbeMsg('Probing…');
    const r = await probeEndpoint(endpoint().trim());
    setProbing(false);
    setProbeMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
    if (r.ok) setStatus('ready', `Endpoint OK · ${endpoint().trim()}`);
    else setStatus('error', `Endpoint failed · ${r.message}`);
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
    // Chart panes may reflow after dock columns change
    requestAnimationFrame(() => {
      try {
        getManager()?.resizeAll?.();
      } catch {
        /* ignore */
      }
    });
  };

  return (
    <Show when={props.open}>
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        onKeyDown={onKey}
        role="presentation"
      >
        <div
          class={`sc-dialog ${
            tab() === 'theme' || tab() === 'editor' || tab() === 'data'
              ? 'w-[min(640px,calc(100vw-2*var(--ui-dialog-margin)))]'
              : 'w-[min(560px,calc(100vw-2*var(--ui-dialog-margin)))]'
          }`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-settings-title"
          data-testid="axis-settings"
          tabIndex={-1}
          ref={(el) => {
            if (!el) return;
            const dispose = installFocusTrap(el, { autoFocus: true });
            onCleanup(dispose);
          }}
        >
          <div class="sc-dialog-accent" />

          <div class="sc-dialog-header">
            <div class="min-w-0">
              <div
                id="axis-settings-title"
                class="text-[0.95em] font-semibold text-text tracking-tight"
              >
                Settings
              </div>
              <div class="sc-hint">
                {SETTINGS_TABS.find((t) => t.id === tab())?.hint ||
                  'Engine · density · chart · theme'}
              </div>
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2"
              onClick={closeWithoutSave}
              aria-label="Close"
            >
              <Icons.x />
            </button>
          </div>

          {/* Tab strip — General / Data / Editor / Theme */}
          <div
            class="sc-dialog-tabs sc-chip-row"
            role="tablist"
            aria-label="Settings sections"
            data-testid="axis-settings-tabs"
          >
            <For each={SETTINGS_TABS}>
              {(t) => (
                <button
                  type="button"
                  role="tab"
                  id={`axis-settings-tab-${t.id}`}
                  aria-selected={tab() === t.id}
                  aria-controls={`axis-settings-panel-${t.id}`}
                  data-testid={`axis-settings-tab-${t.id}`}
                  class={`sc-chip ${tab() === t.id ? 'is-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              )}
            </For>
          </div>

          <div class="sc-dialog-body">
            {/* ── Theme tab ─────────────────────────────────────────── */}
            <Show when={tab() === 'data'}>
              <div
                id="axis-settings-panel-data"
                role="tabpanel"
                aria-labelledby="axis-settings-tab-data"
                data-testid="axis-settings-data"
                class="flex flex-col gap-2"
              >
                <ExchangeCredentialsPanel />
              </div>
            </Show>
            <Show when={tab() === 'editor'}>
              <div
                id="axis-settings-panel-editor"
                role="tabpanel"
                aria-labelledby="axis-settings-tab-editor"
                data-testid="axis-settings-editor"
                class="flex flex-col gap-2"
              >
                <EditorIntelPanel />
              </div>
            </Show>
            <Show when={tab() === 'theme'}>
              <div
                id="axis-settings-panel-theme"
                role="tabpanel"
                aria-labelledby="axis-settings-tab-theme"
                data-testid="axis-settings-theme"
                class="flex flex-col gap-2"
              >
                <div class="sc-section-title">Chart theme</div>
                <p class="sc-hint mt-0">
                  Presets and per-group colors (bars, grid, scales, volume). Pine host:{' '}
                  <code class="font-mono text-[0.9em]">chart.bg_color</code> /{' '}
                  <code class="font-mono text-[0.9em]">chart.fg_color</code>
                  {' · '}
                  aliases color_background / color_foreground. Changes apply live (no Save).
                </p>
                <ThemePanel />
              </div>
            </Show>

            {/* ── General tab ───────────────────────────────────────── */}
            <Show when={tab() === 'general'}>
            <div
              id="axis-settings-panel-general"
              role="tabpanel"
              aria-labelledby="axis-settings-tab-general"
              data-testid="axis-settings-general"
              class="flex flex-col gap-2"
            >
            {/* ── Appearance / density ─────────────────────────────── */}
            <div class="flex flex-col gap-2" data-testid="axis-ui-scale-field">
              <div class="sc-section-title">Appearance</div>
              <div class="flex items-center justify-between gap-2">
                <label class="sc-label" for="axis-ui-scale">
                  UI scale
                </label>
                <span
                  class="font-mono text-[0.85em] tabular-nums text-accent"
                  data-testid="axis-ui-scale-value"
                >
                  {formatUiScalePct(uiScale())}
                </span>
              </div>
              <input
                id="axis-ui-scale"
                class="sc-range"
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
              <div class="flex justify-between text-[0.72em] text-text-faint font-mono tabular-nums">
                <span>{formatUiScalePct(UI_SCALE_MIN)}</span>
                <span>100%</span>
                <span>{formatUiScalePct(UI_SCALE_MAX)}</span>
              </div>
              <div class="sc-chip-row" role="group" aria-label="Scale presets">
                <For each={UI_SCALE_PRESETS}>
                  {(p) => (
                    <button
                      type="button"
                      class={`sc-chip ${Math.abs(uiScale() - p.value) < 0.01 ? 'is-active' : ''}`}
                      aria-pressed={Math.abs(uiScale() - p.value) < 0.01}
                      title={p.hint}
                      onClick={() => {
                        previewScale(p.value);
                        // Preset click commits scale immediately (Save still needed for other fields)
                        setUiScale(p.value);
                      }}
                    >
                      {p.label}
                    </button>
                  )}
                </For>
              </div>
              <p class="sc-hint">
                Scales text, icons, inputs, padding, and gaps. Chart candles stay sharp (canvas not
                zoomed). Live preview — Save to keep.
              </p>
              <div
                class="flex items-center gap-2 mt-0.5 p-2.5 bg-bg-elev border border-border-soft rounded-[var(--radius-sc)]"
                aria-hidden="true"
              >
                <button type="button" class="sc-btn sc-btn-primary">
                  <Icons.play />
                  Run
                </button>
                <button type="button" class="sc-btn sc-btn-ghost">
                  <Icons.layers />
                  Layers
                </button>
                <input class="sc-input min-w-0 flex-1 font-mono" value="BTCUSDT" readOnly />
              </div>
            </div>

            <div class="sc-section">
              <div class="sc-section-title">Engine</div>
            <div class="sc-field">
              <label class="sc-label" for="axis-engine">
                Calculation engine
              </label>
              <select
                id="axis-engine"
                class="sc-input w-full"
                value={engine()}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  setEngine(id);
                  hydrateEngineFields(id);
                }}
              >
                <For each={engines()}>
                  {(en) => <option value={en.id}>{engineOptionLabel(en)}</option>}
                </For>
              </select>
              <Show when={selectedEngine()}>
                {(en) => (
                  <div class="mt-0.5">
                    <CapabilityBadges
                      capabilities={en().capabilities}
                      builtIn={en().builtIn}
                    />
                    <p class="text-[10px] text-text-faint mt-0.5">{en().description}</p>
                  </div>
                )}
              </Show>
            </div>

            <Show when={hasExecMode()}>
              <div class="sc-field" data-testid="axis-exec-mode-field">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-exec-mode"
                >
                  Execution mode
                </label>
                <select
                  id="axis-exec-mode"
                  class="sc-input w-full"
                  data-testid="axis-exec-mode"
                  value={execMode()}
                  onChange={(e) => setExecMode(normalizeExecMode(e.currentTarget.value))}
                >
                  <For each={execModeOptions()}>
                    {(o) => <option value={o.value}>{o.label}</option>}
                  </For>
                </select>
                <p class="text-[10px] text-text-faint mt-0.5">
                  {engine() === 'pyodide'
                    ? `HUD: ENG local · RUN browser. ${execModeHint()} Numba compile needs RUN server (CPython).`
                    : `HUD: ENG local|remote (from Backend URL) · RUN server (or worker if edge URL). ${execModeHint()}`}
                </p>
              </div>
            </Show>

            <Show when={hasPreferWs()}>
              <label class="flex items-start gap-2 cursor-pointer" for="axis-prefer-ws">
                <input
                  id="axis-prefer-ws"
                  type="checkbox"
                  class="mt-0.5"
                  data-testid="axis-prefer-ws"
                  checked={preferWs()}
                  onChange={(e) => setPreferWs(e.currentTarget.checked)}
                />
                <span>
                  <span class="text-[12px] text-text">Prefer WebSocket run</span>
                  <span class="block text-[10px] text-text-faint mt-0.5">
                    Use <code class="font-mono">/ws/run</code> when the backend advertises it;
                    fall back to REST <code class="font-mono">POST /run</code>.
                  </span>
                </span>
              </label>
            </Show>

            <Show when={hasApiKey()}>
              <div class="sc-field" data-testid="axis-engine-api-key-field">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-engine-api-key"
                >
                  Engine API key
                </label>
                <input
                  id="axis-engine-api-key"
                  type="password"
                  class="sc-input font-mono text-[12px] w-full"
                  data-testid="axis-engine-api-key"
                  value={apiKey()}
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                  placeholder="X-API-Key (pyne-worker / secured backends)"
                  spellcheck={false}
                  autocomplete="off"
                />
                <p class="text-[10px] text-text-faint mt-0.5">
                  Sent as <code class="font-mono">X-API-Key</code> and Bearer on{' '}
                  <code class="font-mono">POST /run</code>. Leave empty for open local backends.
                </p>
              </div>
            </Show>

            <Show when={needsEndpoint()}>
              <div class="sc-field">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-endpoint"
                >
                  Backend Endpoint
                </label>
                <div class="flex gap-1.5">
                  <input
                    id="axis-endpoint"
                    class="sc-input font-mono text-[12px] flex-1 min-w-0"
                    value={endpoint()}
                    onInput={(e) => setEndpoint(e.currentTarget.value)}
                    placeholder="http://host:5002 or Worker URL"
                    spellcheck={false}
                  />
                  <button
                    type="button"
                    class="sc-btn inline-flex items-center gap-1 flex-shrink-0"
                    disabled={probing()}
                    onClick={testEndpoint}
                    title="GET / health probe"
                  >
                    {probing() ? <HooxLoader size="xs" /> : <Icons.activity size={13} />}
                    Test
                  </button>
                </div>
                <div class="flex flex-wrap gap-1 mt-0.5">
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1.5 py-0.5 text-[10px] font-mono"
                    data-testid="axis-endpoint-preset-local"
                    title="VPS (or any remote) AXIS UI + pyne on this PC — for Numba compile"
                    onClick={() => {
                      setEndpoint('http://127.0.0.1:5002');
                      setEngine('server');
                      setExecMode('compile');
                      setPreferWs(true);
                      setProbeMsg('');
                    }}
                  >
                    Local pyne · compile
                  </button>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1.5 py-0.5 text-[10px] font-mono"
                    data-testid="axis-endpoint-preset-vps"
                    title="Same-origin Pro API on axis.hoox.sh (nginx → pyne :5002)"
                    onClick={() => {
                      setEndpoint('https://axis.hoox.sh');
                      setEngine('server');
                      setProbeMsg('');
                    }}
                  >
                    axis.hoox.sh API
                  </button>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1.5 py-0.5 text-[10px] font-mono"
                    data-testid="axis-endpoint-preset-pyne-worker"
                    title="HOOX pyne-worker edge evaluator (POST /run)"
                    onClick={() => {
                      setEndpoint('https://pyne-worker.cryptolinx.workers.dev');
                      setEngine('pyne-worker');
                      setPreferWs(false);
                      setProbeMsg('');
                    }}
                  >
                    pyne-worker edge
                  </button>
                </div>
                <Show
                  when={(() => {
                    const ep = endpoint().trim().toLowerCase();
                    const loop =
                      ep.includes('localhost') ||
                      ep.includes('127.0.0.1') ||
                      ep.includes('0.0.0.0');
                    const remotePage =
                      typeof location !== 'undefined' &&
                      location.hostname !== 'localhost' &&
                      location.hostname !== '127.0.0.1';
                    return loop && remotePage;
                  })()}
                >
                  <p
                    class="text-[10px] text-orange font-mono mt-0.5 leading-relaxed"
                    data-testid="axis-endpoint-loopback-warn"
                  >
                    <strong class="text-orange">VPS UI → local compile:</strong> Browser calls{' '}
                    <em>this PC</em> at 127.0.0.1:5002 (not the VPS API). Checklist:
                    <br />
                    1) On PC: <code class="text-text-dim">pip install numba && make run</code> (pyne :5002)
                    <br />
                    2) Local CORS must allow this page origin (
                    <code class="text-text-dim">
                      {typeof location !== 'undefined' ? location.origin : '…'}
                    </code>
                    ) — latest pyne allows demo host by default, or{' '}
                    <code class="text-text-dim">ALLOWED_ORIGINS=*</code>
                    <br />
                    3) Engine server · Mode compile · Test → then Save
                  </p>
                </Show>
                <Show when={probeMsg()}>
                  <p
                    class={`text-[10px] font-mono mt-0.5 break-words ${
                      probeMsg().startsWith('✓') ? 'text-accent-2' : 'text-red'
                    }`}
                  >
                    {probeMsg()}
                  </p>
                </Show>
                <p class="text-[10px] text-text-faint mt-0.5">
                  Server engine + LSP (completion/hover) use this URL. Cross-origin needs CORS on
                  pyne (page origin must be allowed).
                </p>
              </div>
            </Show>

            <div class="sc-field">
              <label class="text-[10px] text-text-dim uppercase tracking-wider" for="axis-storage">
                Script storage
              </label>
              <select
                id="axis-storage"
                class="sc-input w-full"
                value={storage()}
                onChange={(e) => setStorage(e.currentTarget.value)}
              >
                <For each={storages()}>
                  {(s) => (
                    <option value={s.id}>
                      {s.name}
                      {s.builtIn ? '' : ' (plugin)'}
                    </option>
                  )}
                </For>
              </select>
              <p class="text-[10px] text-text-faint mt-0.5">
                Where saved Pine scripts live (local browser, cloud Worker, or git). Configure
                credentials under Manager → Script Library.
              </p>
            </div>

            </div>

            {/* ── On-Chain (dedicated Worker proxy; Pro API endpoint stays for Pine) ── */}
            <div class="sc-section" data-testid="axis-settings-onchain">
              <div class="sc-section-title">On-Chain</div>
              <p class="sc-hint mt-0">
                TVL / DEX traffic uses the <strong class="text-text-dim font-normal">AXIS Worker</strong>{' '}
                allowlisted proxy by default (not the Pro API host). Backend URL above stays for
                Pine <code class="font-mono text-text-dim">/run</code> / LSP.
              </p>
              <p class="sc-hint mt-1 font-mono text-[0.9em]">
                <code class="text-text-dim">…/api/onchain/llama</code>
                {' · '}
                <code class="text-text-dim">…/api/onchain/gecko</code>
                {' · '}
                local <code class="text-text-dim">http://127.0.0.1:8787</code>
              </p>
              <p class="sc-hint mt-0.5">
                <strong class="text-text-dim font-normal">Not a wallet</strong> — no MetaMask,
                Ledger, or signing; public metrics only.
              </p>
              <div class="mt-1.5">
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost px-2 py-0.5 text-[11px]"
                  data-testid="axis-settings-open-onchain"
                  title="Open the On-Chain panel"
                  onClick={() => {
                    toggleOnchainPanel();
                    props.onClose();
                  }}
                >
                  Open On-Chain panel
                </button>
              </div>
            </div>

            <div class="sc-section">
              <div class="sc-section-title">Chart &amp; watchlist</div>

              <div class="sc-field">
                <label class="sc-label" for="axis-default-interval">
                  Default interval
                </label>
                <select
                  id="axis-default-interval"
                  class="sc-input w-full"
                  value={chartInterval()}
                  onChange={(e) => setChartInterval(e.currentTarget.value)}
                >
                  <For each={[...WATCHLIST_INTERVALS]}>
                    {(i) => <option value={i}>{i}</option>}
                  </For>
                </select>
                <p class="text-[10px] text-text-faint mt-0.5">
                  Used when loading symbols from the watchlist and top bar. Changing this reloads
                  the active chart.
                </p>
              </div>

              <div class="sc-field">
                <label class="sc-label" for="axis-history-bars">
                  Historical bars
                </label>
                <input
                  id="axis-history-bars"
                  type="number"
                  class="sc-input w-full font-mono"
                  min={HISTORY_BARS_MIN}
                  max={HISTORY_BARS_MAX}
                  step={50}
                  value={historyBars()}
                  onInput={(e) => setHistoryBars(Number(e.currentTarget.value))}
                  onChange={(e) =>
                    setHistoryBars(clampHistoryBars(e.currentTarget.value))
                  }
                />
                <p class="text-[10px] text-text-faint mt-0.5">
                  Bars requested on Load / symbol change ({HISTORY_BARS_MIN}–{HISTORY_BARS_MAX}).
                  Default {HISTORY_BARS_DEFAULT}. Venues may return fewer (e.g. OKX max 300,
                  Binance max 1000). Saved with your other settings.
                </p>
              </div>

              <label
                class="flex items-start gap-2 cursor-pointer mb-3"
                for="axis-price-scale-labels"
              >
                <input
                  id="axis-price-scale-labels"
                  type="checkbox"
                  class="mt-0.5"
                  checked={priceScaleLabels()}
                  onChange={(e) => setPriceScaleLabels(e.currentTarget.checked)}
                  data-testid="axis-settings-price-scale-labels"
                />
                <span>
                  <span class="text-[12px] text-text">Right price scale labels</span>
                  <span class="block text-[10px] text-text-faint mt-0.5">
                    Show price numbers on the right axis. Same as the chart [$] control.
                    Off collapses the gutter for more plot width.
                  </span>
                </span>
              </label>

              <label
                class="flex items-start gap-2 cursor-pointer mb-3"
                for="axis-last-value-labels"
              >
                <input
                  id="axis-last-value-labels"
                  type="checkbox"
                  class="mt-0.5"
                  checked={lastValueLabels()}
                  onChange={(e) => setLastValueLabels(e.currentTarget.checked)}
                  data-testid="axis-settings-last-value-labels"
                />
                <span>
                  <span class="text-[12px] text-text">Series last-value labels</span>
                  <span class="block text-[10px] text-text-faint mt-0.5">
                    Show last prices on the right scale (plots, volume, hlines).
                    Same as the chart [N] control. Independent of [$].
                  </span>
                </span>
              </label>

              <label
                class="flex items-start gap-2 cursor-pointer mb-3"
                for="axis-last-value-names"
              >
                <input
                  id="axis-last-value-names"
                  type="checkbox"
                  class="mt-0.5"
                  checked={lastValueNames()}
                  onChange={(e) => setLastValueNames(e.currentTarget.checked)}
                  data-testid="axis-settings-last-value-names"
                />
                <span>
                  <span class="text-[12px] text-text">Plot names on last-value labels</span>
                  <span class="block text-[10px] text-text-faint mt-0.5">
                    Show RSI / Overbought titles next to the last value. Off
                    keeps the number only. Same as the chart [T] control.
                  </span>
                </span>
              </label>

              <div class="sc-section !mt-0 !border-t-0 !pt-0 mb-3">
                <div class="sc-section-title">Strategy fills & marks</div>
                <p class="text-[10px] text-text-faint mb-2">
                  Historical and live default: execute on signal bar close. Slippage
                  shifts the fill to the next bar open. Marker options also live on the
                  Results → Strategy tab.
                </p>
                <label
                  class="flex items-start gap-2 cursor-pointer mb-2"
                  for="axis-strategy-slippage"
                >
                  <input
                    id="axis-strategy-slippage"
                    type="checkbox"
                    class="mt-0.5"
                    checked={slippageNextOpen()}
                    onChange={(e) => setSlippageNextOpen(e.currentTarget.checked)}
                    data-testid="axis-settings-strategy-slippage"
                  />
                  <span>
                    <span class="text-[12px] text-text">Slippage → next bar open</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Off = fill at signal candle close. On = fill at next candle open
                      (mark moves to that bar).
                    </span>
                  </span>
                </label>
                <label
                  class="flex items-start gap-2 cursor-pointer mb-2"
                  for="axis-strategy-invert-labels"
                >
                  <input
                    id="axis-strategy-invert-labels"
                    type="checkbox"
                    class="mt-0.5"
                    checked={invertTradeLabels()}
                    onChange={(e) => setInvertTradeLabels(e.currentTarget.checked)}
                    data-testid="axis-settings-strategy-invert-labels"
                  />
                  <span>
                    <span class="text-[12px] text-text">Invert long / short labels</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Default: long entry below, short above. Invert puts long above and
                      short below.
                    </span>
                  </span>
                </label>
                <label
                  class="flex items-start gap-2 cursor-pointer mb-2"
                  for="axis-strategy-exact-marks"
                >
                  <input
                    id="axis-strategy-exact-marks"
                    type="checkbox"
                    class="mt-0.5"
                    checked={exactOnCandle()}
                    onChange={(e) => setExactOnCandle(e.currentTarget.checked)}
                    data-testid="axis-settings-strategy-exact-marks"
                  />
                  <span>
                    <span class="text-[12px] text-text">Exact marks on candle</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Circle on the fill bar body plus directional side arrows.
                    </span>
                  </span>
                </label>
              </div>

              <div class="sc-section !mt-0 !border-t-0 !pt-0">
                <div class="sc-section-title">Live stream</div>

                <label class="flex items-start gap-2 cursor-pointer" for="axis-prefer-live">
                  <input
                    id="axis-prefer-live"
                    type="checkbox"
                    class="mt-0.5"
                    checked={preferAfterLoad()}
                    onChange={(e) => setPreferAfterLoad(e.currentTarget.checked)}
                  />
                  <span>
                    <span class="text-[12px] text-text">Auto-start live after Load</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Prefer WebSocket feed immediately after historical REST load. On by default
                      (live mode preferred).
                    </span>
                  </span>
                </label>

                <div class="sc-field">
                  <label
                    class="text-[10px] text-text-dim uppercase tracking-wider"
                    for="axis-rerun-on"
                  >
                    Indicator re-run on live bars
                  </label>
                  <select
                    id="axis-rerun-on"
                    class="sc-input w-full"
                    value={rerunOn()}
                    onChange={(e) =>
                      setRerunOn(
                        e.currentTarget.value === 'bar-close' ? 'bar-close' : 'every-tick',
                      )
                    }
                  >
                    <option value="every-tick">Every tick (responsive)</option>
                    <option value="bar-close">Bar close only (lighter)</option>
                  </select>
                  <p class="text-[10px] text-text-faint mt-0.5">
                    Bar-close uses venue closed flags (Binance/OKX/Bybit) or bar time advance.
                  </p>
                </div>

                <label class="flex items-start gap-2 cursor-pointer" for="axis-hud-compact">
                  <input
                    id="axis-hud-compact"
                    type="checkbox"
                    class="mt-0.5"
                    checked={hudCompact()}
                    onChange={(e) => setHudCompact(e.currentTarget.checked)}
                  />
                  <span>
                    <span class="text-[12px] text-text">Compact connection HUD</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Hide SRC/STR/ENG/STO plane chips; keep Live · Tick · Engine latency.
                    </span>
                  </span>
                </label>

                <label
                  class="flex items-start gap-2 cursor-pointer mt-2"
                  for="axis-share-on-error"
                >
                  <input
                    id="axis-share-on-error"
                    type="checkbox"
                    class="mt-0.5"
                    checked={shareOnError()}
                    onChange={(e) => setShareOnError(e.currentTarget.checked)}
                    data-testid="axis-settings-share-on-error"
                  />
                  <span>
                    <span class="text-[12px] text-text">Ask to share data on errors</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Telemetry · off by default. When enabled, UI errors show a prompt to
                      copy/download a redacted diagnostic (no bars, scripts, or secrets).
                      Nothing is uploaded automatically.
                    </span>
                  </span>
                </label>
              </div>

              <div class="sc-field">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-watchlist-refresh"
                >
                  Watchlist REST fallback
                </label>
                <select
                  id="axis-watchlist-refresh"
                  class="sc-input w-full"
                  value={String(refreshSec())}
                  onChange={(e) => setRefreshSec(Number(e.currentTarget.value))}
                >
                  <For each={[...WATCHLIST_REFRESH_OPTIONS]}>
                    {(o) => <option value={o.value}>{o.label}</option>}
                  </For>
                </select>
                <p class="text-[10px] text-text-faint mt-0.5">
                  Used only when WebSocket quotes fail. While live, prices update on every exchange
                  ticker tick (Binance / OKX / Bybit / Coinbase).
                </p>
              </div>
            </div>

            {/* ── Workspace actions ─────────────────────────────────── */}
            <div class="flex flex-col gap-2 mt-3" data-testid="axis-settings-workspace">
              <div class="sc-section-title">Workspace</div>
              <p class="text-[10px] text-text-faint -mt-1">
                Chart reload refetches OHLCV for the current symbol. UI reset restores panel layout
                and density only. Export / import captures a full chrome + drawings + scripts
                snapshot (bars omitted).
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class={`sc-btn ${reloading() ? 'opacity-50' : ''}`}
                  data-testid="axis-settings-reload-chart"
                  disabled={reloading()}
                  title="Refetch bars for the current symbol / interval / source"
                  onClick={() => void onReloadChart()}
                >
                  {reloading() ? <HooxLoader size="xs" /> : <Icons.refresh />}
                  {reloading() ? 'Reloading…' : 'Reload chart'}
                </button>
                <button
                  type="button"
                  class="sc-btn"
                  data-testid="axis-settings-reset-ui"
                  title="Reset docks, panel sizes, and UI scale to factory defaults"
                  onClick={onResetUi}
                >
                  <Icons.reset />
                  Reset UI layout
                </button>
              </div>
              <WorkspaceSnapshotMenu />
            </div>
            </div>
            </Show>
          </div>

          <div class="sc-dialog-footer">
            <div class="flex-1 text-[0.72em] text-text-faint font-mono truncate">
              {tab() === 'theme'
                ? 'Theme applies live · Save not required'
                : tab() === 'editor'
                  ? 'Editor intel applies live · Save not required'
                  : tab() === 'data'
                    ? 'Keys stay in this session · not written to disk'
                    : `AXIS · scale ${formatUiScalePct(uiScale())}`}
            </div>
            <button type="button" class="sc-btn" onClick={closeWithoutSave}>
              {tab() === 'theme' || tab() === 'editor' || tab() === 'data'
                ? 'Close'
                : 'Cancel'}
            </button>
            <Show when={tab() === 'general'}>
              <button type="button" class="sc-btn sc-btn-primary" onClick={save}>
                <Icons.check />
                Save
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

type CredentialMetaRow = {
  id: string;
  venue: string;
  label?: string;
  hasKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
};

/** Per-venue API key/secret/passphrase — session vault, never persist() secrets. */
const ExchangeCredentialsPanel: Component = () => {
  const [venue, setVenue] = createSignal<ExchangeCredentialVenue>(
    defaultExchangeCredentialVenue(store.provider?.venue),
  );
  const [apiKey, setApiKey] = createSignal('');
  const [secret, setSecret] = createSignal('');
  const [passphrase, setPassphrase] = createSignal('');
  const [msg, setMsg] = createSignal('');
  const [rev, setRev] = createSignal(0);

  const unsub = cred.subscribeCredentials(() => setRev((n) => n + 1));
  onCleanup(unsub);

  const meta = createMemo((): CredentialMetaRow | null => {
    rev();
    const v = venue();
    const rows = cred.listCredentialMeta() as CredentialMetaRow[];
    return rows.find((m) => m.venue === v) ?? null;
  });

  const hasSaved = createMemo(() => {
    rev();
    try {
      return cred.hasCredentialForVenue(venue());
    } catch {
      const m = meta();
      return !!(m && (m.hasKey || m.hasSecret || m.hasPassphrase));
    }
  });

  const needsPass = createMemo(() => venueNeedsPassphrase(venue()));

  const clearSecrets = () => {
    setApiKey('');
    setSecret('');
    setPassphrase('');
  };

  const onVenueChange = (raw: string) => {
    if (!isExchangeCredentialVenue(raw)) return;
    setVenue(raw);
    clearSecrets();
    setMsg('');
  };

  const onSave = () => {
    const v = venue();
    const key = apiKey().trim();
    const sec = secret().trim();
    const pass = passphrase().trim();
    if (!key || !sec) {
      setMsg('API key and secret are required');
      return;
    }
    if (needsPass() && !pass) {
      setMsg('Passphrase is required for this venue');
      return;
    }
    try {
      cred.putCredential({
        venue: v,
        apiKey: key,
        secret: sec,
        passphrase: needsPass() ? pass : undefined,
      });
      clearSecrets();
      setMsg('');
      setStatus('ready', `Exchange key saved · ${v} · session only`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const onRemove = () => {
    const v = venue();
    const row = meta();
    const id = row?.id;
    if (!id) {
      setMsg('No saved key for this venue');
      return;
    }
    cred.deleteCredential(id);
    clearSecrets();
    setMsg('');
    setStatus('ready', `Exchange key removed · ${v}`);
  };

  const [testing, setTesting] = createSignal(false);

  const onTestKey = async () => {
    const v = venue();
    if (!hasSignedCreds(v as VenueId)) {
      setMsg('Save a key first, then test');
      return;
    }
    setTesting(true);
    setMsg('');
    try {
      await fetchSignedJson({
        venue: v as VenueId,
        path: '/api/v3/klines',
        query: { symbol: 'BTCUSDT', interval: '1d', limit: 1 },
        skipWorkerProxy: true,
      });
      setMsg('');
      setStatus('ready', `${v} key verified · signed fetch OK`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403/.test(msg)) {
        setMsg(`Key rejected (${v}): ${msg}`);
      } else if (/CORS|network|fetch/i.test(msg)) {
        setMsg(`Network/CORS error — key may be valid but direct fetch blocked`);
      } else {
        setMsg(`Test failed: ${msg}`);
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div class="sc-section-title">Exchange API keys</div>
      <p class="sc-hint mt-0" data-testid="axis-exchange-session-note">
        Saved in this session only (not written to disk). AXIS never puts key, secret, or
        passphrase into localStorage.
      </p>

      <div class="sc-field">
        <label
          class="text-[10px] text-text-dim uppercase tracking-wider"
          for="axis-exchange-venue"
        >
          Venue
        </label>
        <select
          id="axis-exchange-venue"
          class="sc-input w-full"
          data-testid="axis-exchange-venue"
          value={venue()}
          onChange={(e) => onVenueChange(e.currentTarget.value)}
        >
          <For each={[...EXCHANGE_CREDENTIAL_VENUES]}>
            {(v) => <option value={v}>{EXCHANGE_CREDENTIAL_VENUE_LABELS[v]}</option>}
          </For>
        </select>
      </div>

      <div class="sc-field">
        <label
          class="text-[10px] text-text-dim uppercase tracking-wider"
          for="axis-exchange-api-key"
        >
          API key
        </label>
        <input
          id="axis-exchange-api-key"
          type="password"
          class="sc-input font-mono text-[12px] w-full"
          data-testid="axis-exchange-api-key"
          value={apiKey()}
          onInput={(e) => setApiKey(e.currentTarget.value)}
          placeholder={meta()?.hasKey ? '••••••••  saved' : 'API key'}
          spellcheck={false}
          autocomplete="off"
        />
        <Show when={meta()?.hasKey && !apiKey()}>
          <p class="text-[10px] text-accent mt-0.5">saved</p>
        </Show>
      </div>

      <div class="sc-field">
        <label
          class="text-[10px] text-text-dim uppercase tracking-wider"
          for="axis-exchange-secret"
        >
          Secret
        </label>
        <input
          id="axis-exchange-secret"
          type="password"
          class="sc-input font-mono text-[12px] w-full"
          data-testid="axis-exchange-secret"
          value={secret()}
          onInput={(e) => setSecret(e.currentTarget.value)}
          placeholder={meta()?.hasSecret ? '••••••••  saved' : 'API secret'}
          spellcheck={false}
          autocomplete="off"
        />
        <Show when={meta()?.hasSecret && !secret()}>
          <p class="text-[10px] text-accent mt-0.5">saved · ••••••••</p>
        </Show>
      </div>

      <Show when={needsPass()}>
        <div class="sc-field">
          <label
            class="text-[10px] text-text-dim uppercase tracking-wider"
            for="axis-exchange-passphrase"
          >
            Passphrase
          </label>
          <input
            id="axis-exchange-passphrase"
            type="password"
            class="sc-input font-mono text-[12px] w-full"
            data-testid="axis-exchange-passphrase"
            value={passphrase()}
            onInput={(e) => setPassphrase(e.currentTarget.value)}
            placeholder={meta()?.hasPassphrase ? '••••••••  saved' : 'Passphrase'}
            spellcheck={false}
            autocomplete="off"
          />
          <Show when={meta()?.hasPassphrase && !passphrase()}>
            <p class="text-[10px] text-accent mt-0.5">saved</p>
          </Show>
        </div>
      </Show>

      <div class="flex flex-wrap gap-2 mt-1">
        <button
          type="button"
          class="sc-btn sc-btn-primary"
          data-testid="axis-exchange-key-save"
          onClick={onSave}
        >
          <Icons.check />
          Save
        </button>
        <button
          type="button"
          class="sc-btn"
          data-testid="axis-exchange-key-remove"
          disabled={!hasSaved()}
          onClick={onRemove}
        >
          <Icons.trash />
          Remove
        </button>
        <button
          type="button"
          class="sc-btn"
          data-testid="axis-exchange-key-test"
          disabled={!hasSaved() || testing()}
          onClick={onTestKey}
        >
          {testing() ? 'Testing…' : 'Test key'}
        </button>
      </div>
      <Show when={msg()}>
        <p class="text-[10px] text-red font-mono mt-0.5">{msg()}</p>
      </Show>
      <p class="text-[10px] text-text-faint mt-1">
        Used when the active provider is authenticated. Public REST/WebSocket needs no key.
      </p>
    </>
  );
};

function IntelCheck(props: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="flex items-start gap-2 cursor-pointer mb-2" for={props.id}>
      <input
        id={props.id}
        type="checkbox"
        class="mt-0.5"
        checked={props.checked}
        onChange={(e) => {
          if (!e.isTrusted) return;
          props.onChange(e.currentTarget.checked);
        }}
        data-testid={props.id}
      />
      <span>
        <span class="text-[12px] text-text">{props.label}</span>
        <span class="block text-[10px] text-text-faint mt-0.5">{props.hint}</span>
      </span>
    </label>
  );
}

function IntelNum(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = createSignal(String(props.value));
  createEffect(() => {
    setDraft(String(props.value));
  });
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setDraft(String(props.value));
      return;
    }
    const clamped = Math.min(props.max, Math.max(props.min, Math.round(n)));
    if (clamped !== props.value) props.onChange(clamped);
    setDraft(String(clamped));
  };
  return (
    <label class="flex flex-col gap-0.5 mb-2" for={props.id}>
      <span class="flex items-baseline justify-between gap-2">
        <span class="text-[12px] text-text">{props.label}</span>
        <span class="font-mono text-[11px] tabular-nums text-text-faint">
          {props.value}
          {props.suffix || ''}
        </span>
      </span>
      <input
        id={props.id}
        type="number"
        class="sc-input font-mono text-[12px] w-full"
        min={props.min}
        max={props.max}
        step={props.step ?? 50}
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onChange={(e) => commit(e.currentTarget.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        data-testid={props.id}
      />
      <span class="text-[10px] text-text-faint">
        {props.hint} ({props.min}–{props.max}
        {props.suffix || ''})
      </span>
    </label>
  );
}

/** Live-applied editor intelligence (lint / hover / complete / marks). */
const EditorIntelPanel: Component = () => {
  const intel = () => getEditorIntel();
  const set = (partial: Partial<EditorIntelSettings>) => patchEditorIntel(partial);

  return (
    <>
      <div class="flex items-center justify-between gap-2 mb-1">
        <div>
          <div class="sc-section-title !mb-0">Editor intelligence</div>
          <p class="sc-hint mt-0.5">
            Pre-eval, hover cards, completions, underlines, and inline chips.
            Changes apply immediately.
          </p>
        </div>
        <button
          type="button"
          class="sc-btn sc-btn-ghost text-[11px]"
          data-testid="axis-settings-editor-reset"
          onClick={() => resetEditorIntel()}
        >
          Reset defaults
        </button>
      </div>

      <div class="sc-section !mt-2">
        <div class="sc-section-title">Pre-eval / lint</div>
        <IntelCheck
          id="axis-intel-preeval"
          label="Enable pre-eval"
          hint="Parse/lint after idle, Save, and Run. Off skips all static checks."
          checked={intel().preevalEnabled}
          onChange={(v) => set({ preevalEnabled: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-local"
          label="Local structural checks"
          hint="Brackets, strings, missing indicator()/strategy()/library()."
          checked={intel().preevalLocal}
          onChange={(v) => set({ preevalLocal: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-remote"
          label="Remote Pro API diagnostics"
          hint="POST /lsp/diagnostics when Backend URL is set (merged with local)."
          checked={intel().preevalRemote}
          onChange={(v) => set({ preevalRemote: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-typos"
          label="Unknown builtin / typo hints"
          hint="plt() → plot, strategy.etry → strategy.entry (violet, non-blocking)."
          checked={intel().preevalTypos}
          onChange={(v) => set({ preevalTypos: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-version"
          label="Warn if //@version is missing"
          checked={intel().preevalVersionWarn}
          hint="Suggests //@version=6 at the top of the script."
          onChange={(v) => set({ preevalVersionWarn: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-study"
          label="Warn on study()"
          hint="Pine v3 name — use indicator() or strategy()."
          checked={intel().preevalStudyWarn}
          onChange={(v) => set({ preevalStudyWarn: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-security"
          label="Warn on bare security()"
          hint="Prefer request.security (v4+)."
          checked={intel().preevalSecurityWarn}
          onChange={(v) => set({ preevalSecurityWarn: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-dup"
          label="Warn on duplicate declarations"
          hint="Only one indicator() / strategy() / library() per script."
          checked={intel().preevalDuplicateDecl}
          onChange={(v) => set({ preevalDuplicateDecl: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-block"
          label="Block Run on errors"
          hint="Severity error disables Run. Typos and warnings never block."
          checked={intel().preevalBlockRun}
          onChange={(v) => set({ preevalBlockRun: v })}
        />
        <IntelCheck
          id="axis-intel-preeval-clear"
          label="Clear marks while typing"
          hint="On: hide underlines until idle. Off: keep last marks until the next check lands."
          checked={intel().preevalClearOnEdit}
          onChange={(v) => set({ preevalClearOnEdit: v })}
        />
        <IntelNum
          id="axis-intel-idle-ms"
          label="Idle delay"
          hint="Quiet time after the last keystroke before lint runs"
          value={intel().preevalIdleMs}
          min={INTEL_IDLE_MS_MIN}
          max={INTEL_IDLE_MS_MAX}
          suffix=" ms"
          onChange={(v) => set({ preevalIdleMs: v })}
        />
        <IntelNum
          id="axis-intel-tab-ms"
          label="Tab-switch delay"
          hint="Lint shortly after switching editor tabs"
          value={intel().preevalTabSwitchMs}
          min={INTEL_TAB_SWITCH_MS_MIN}
          max={INTEL_TAB_SWITCH_MS_MAX}
          suffix=" ms"
          onChange={(v) => set({ preevalTabSwitchMs: v })}
        />
      </div>

      <div class="sc-section">
        <div class="sc-section-title">Error marking</div>
        <IntelCheck
          id="axis-intel-underlines"
          label="Underlines + line tint"
          hint="Wavy/dotted marks in the buffer."
          checked={intel().diagUnderlines}
          onChange={(v) => set({ diagUnderlines: v })}
        />
        <IntelCheck
          id="axis-intel-gutter"
          label="Gutter markers"
          hint="● / ▲ / ✦ in the left gutter."
          checked={intel().diagGutter}
          onChange={(v) => set({ diagGutter: v })}
        />
        <IntelCheck
          id="axis-intel-diag-hover"
          label="Diagnostic hover"
          hint="Tooltip when the cursor rests on a mark."
          checked={intel().diagHover}
          onChange={(v) => set({ diagHover: v })}
        />
        <IntelCheck
          id="axis-intel-err"
          label="Show errors"
          checked={intel().diagErrors}
          hint="Blocking parse / structural errors."
          onChange={(v) => set({ diagErrors: v })}
        />
        <IntelCheck
          id="axis-intel-warn"
          label="Show warnings"
          checked={intel().diagWarnings}
          hint="study(), missing version, bare security()."
          onChange={(v) => set({ diagWarnings: v })}
        />
        <IntelCheck
          id="axis-intel-typo"
          label="Show typos"
          checked={intel().diagTypos}
          hint="Unknown builtin members (violet)."
          onChange={(v) => set({ diagTypos: v })}
        />
        <IntelCheck
          id="axis-intel-info"
          label="Show info"
          checked={intel().diagInfo}
          hint="Hints and informational engine notes."
          onChange={(v) => set({ diagInfo: v })}
        />
      </div>

      <div class="sc-section">
        <div class="sc-section-title">Hover cards &amp; hints</div>
        <IntelCheck
          id="axis-intel-hover"
          label="Builtin / symbol hover cards"
          hint="Docs for ta.sma, plot, input.*, user annotations."
          checked={intel().hoverEnabled}
          onChange={(v) => set({ hoverEnabled: v })}
        />
        <IntelCheck
          id="axis-intel-hover-remote"
          label="Remote hover"
          hint="Ask Pro API /lsp/hover when local catalog has no card."
          checked={intel().hoverRemote}
          onChange={(v) => set({ hoverRemote: v })}
        />
        <IntelCheck
          id="axis-intel-sig"
          label="Signature / param checklist"
          hint="In-call hint lists every parameter (used / current / unused)."
          checked={intel().signatureHints}
          onChange={(v) => set({ signatureHints: v })}
        />
        <IntelNum
          id="axis-intel-hover-ms"
          label="Hover delay"
          hint="How long to rest the pointer before a card opens"
          value={intel().hoverTimeMs}
          min={INTEL_HOVER_MS_MIN}
          max={INTEL_HOVER_MS_MAX}
          step={25}
          suffix=" ms"
          onChange={(v) => set({ hoverTimeMs: v })}
        />
      </div>

      <div class="sc-section">
        <div class="sc-section-title">Suggestions / autocomplete</div>
        <IntelCheck
          id="axis-intel-ac"
          label="Enable completions"
          hint="Typing + ⌘/Ctrl-Space. Off removes the list entirely."
          checked={intel().autocompleteEnabled}
          onChange={(v) => set({ autocompleteEnabled: v })}
        />
        <IntelCheck
          id="axis-intel-ac-type"
          label="Activate while typing"
          hint="Off = only open on ⌘/Ctrl-Space."
          checked={intel().activateOnTyping}
          onChange={(v) => set({ activateOnTyping: v })}
        />
        <IntelCheck
          id="axis-intel-ac-params"
          label="Named parameter suggestions"
          hint="After ( or , offer remaining title= / minval= args."
          checked={intel().paramCompletions}
          onChange={(v) => set({ paramCompletions: v })}
        />
        <IntelCheck
          id="axis-intel-ac-enums"
          label="Enum value lists"
          hint="plot.style_*, shape.*, size.*, location.*, color.* after name=."
          checked={intel().enumCompletions}
          onChange={(v) => set({ enumCompletions: v })}
        />
        <IntelCheck
          id="axis-intel-ac-remote"
          label="Remote completions"
          hint="Merge Pro API /lsp/completion when local has no hit."
          checked={intel().remoteCompletions}
          onChange={(v) => set({ remoteCompletions: v })}
        />
        <IntelNum
          id="axis-intel-ac-max"
          label="Max rendered options"
          hint="Cap the suggestion popup"
          value={intel().maxRenderedOptions}
          min={INTEL_MAX_OPTIONS_MIN}
          max={INTEL_MAX_OPTIONS_MAX}
          step={8}
          onChange={(v) => set({ maxRenderedOptions: v })}
        />
      </div>

      <div class="sc-section">
        <div class="sc-section-title">Remote LSP timings</div>
        <IntelCheck
          id="axis-intel-remote-master"
          label="Use remote LSP"
          hint="Master switch for hover / complete / diagnostics against Backend URL."
          checked={intel().remoteLspEnabled}
          onChange={(v) => set({ remoteLspEnabled: v })}
        />
        <IntelNum
          id="axis-intel-to-hover"
          label="Hover timeout"
          hint="Give up on /lsp/hover and show local (or nothing)"
          value={intel().hoverTimeoutMs}
          min={INTEL_TIMEOUT_MS_MIN}
          max={INTEL_TIMEOUT_MS_MAX}
          suffix=" ms"
          onChange={(v) => set({ hoverTimeoutMs: v })}
        />
        <IntelNum
          id="axis-intel-to-ac"
          label="Completion timeout"
          hint="Give up on /lsp/completion"
          value={intel().completionTimeoutMs}
          min={INTEL_TIMEOUT_MS_MIN}
          max={INTEL_TIMEOUT_MS_MAX}
          suffix=" ms"
          onChange={(v) => set({ completionTimeoutMs: v })}
        />
        <IntelNum
          id="axis-intel-to-diag"
          label="Diagnostics timeout"
          hint="Local marks already show; this only waits for remote parse"
          value={intel().diagnosticsTimeoutMs}
          min={INTEL_TIMEOUT_MS_MIN}
          max={INTEL_TIMEOUT_MS_MAX}
          suffix=" ms"
          onChange={(v) => set({ diagnosticsTimeoutMs: v })}
        />
      </div>

      <div class="sc-section">
        <div class="sc-section-title">Inline markers</div>
        <IntelCheck
          id="axis-intel-color-chips"
          label="Color chips"
          hint="Swatches before hex / color.* tokens."
          checked={intel().colorChips}
          onChange={(v) => set({ colorChips: v })}
        />
        <IntelCheck
          id="axis-intel-inline-chips"
          label="Debug chips (end of line)"
          hint="Also requires the editor Debug toggle. Last-run logs / errors."
          checked={intel().inlineChips}
          onChange={(v) => set({ inlineChips: v })}
        />
        <IntelCheck
          id="axis-intel-pin-gutter"
          label="Debug pin gutter"
          hint="Also requires chart Pins. Lines with bar_index / time."
          checked={intel().inlinePinGutter}
          onChange={(v) => set({ inlinePinGutter: v })}
        />
      </div>
    </>
  );
};
