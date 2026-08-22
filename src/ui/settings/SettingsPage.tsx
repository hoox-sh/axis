// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings studio canvas — product chrome. Engine / endpoint / exec mode
 * live on Runtime. Storage is a Wire slot.
 *
 * @module ui/settings/SettingsPage
 */

import { For, Show, createEffect, createSignal, untrack } from 'solid-js';
import {
  store,
  setStore,
  flushPersist,
  setStatus,
  setUiScale,
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
import { Icons } from '../icons';
import { HooxLoader } from '../HooxLoader';
import {
  WATCHLIST_INTERVALS,
  WATCHLIST_REFRESH_OPTIONS,
} from '../../data/watchlist-tickers';
import { loadSymbolData, reloadChart } from '../../data/load-symbol';
import { getManager } from '../../chart/manager-access';
import { UI_SCALE_PRESETS, formatUiScalePct } from '../ui-scale';
import { WorkspaceSnapshotMenu } from '../WorkspaceSnapshotMenu';
import { ThemePanel } from '../ThemePanel';
import { PluginConfigRow } from '../PluginConfigRow';
import { EditorIntelPanel, ExchangeCredentialsPanel } from '../SettingsDialog';
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
  StudioTabs,
  StudioToggle,
} from '../studio';

const SETTINGS_TABS: { id: SettingsTabId; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'Density · chart · live' },
  { id: 'data', label: 'Data', hint: 'Exchange keys · provider' },
  { id: 'editor', label: 'Editor', hint: 'Lint · hover · complete' },
  { id: 'theme', label: 'Theme', hint: 'Bars · canvas · chart.bg_color' },
];

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
  const [reloading, setReloading] = createSignal(false);
  const [tab, setTab] = createSignal<SettingsTabId>(
    isSettingsTabId(props.initialTab) ? props.initialTab : 'general',
  );

  createEffect((was?: boolean) => {
    const open = true;
    if (open && !was) {
      untrack(() => {
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
        setTab(isSettingsTabId(props.initialTab) ? props.initialTab : 'general');
      });
    }
    return open;
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
    applyUiScale(nextUiScale);
    flushPersist();
    setStatus(
      'ready',
      `Settings saved · ${nextInterval} · ${nextHistoryBars} bars · refresh ${nextRefresh}s · live re-run=${rerunOn()}`,
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

  const footerStatus =
    tab() === 'theme'
      ? 'Theme applies live · Save not required'
      : tab() === 'editor'
        ? 'Editor intel applies live · Save not required'
        : tab() === 'data'
          ? 'Keys stay in this session · not written to disk'
          : `AXIS · scale ${formatUiScalePct(uiScale())}`;

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
        <Show when={tab() === 'general'}>
          <div
            id="axis-settings-panel-general"
            role="tabpanel"
            aria-labelledby="axis-settings-tab-general"
            data-testid="axis-settings-general"
          >
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
                        onClick={() => {
                          previewScale(p.value);
                          setUiScale(p.value);
                        }}
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

            <StudioSection title="Live stream">
              <StudioToggle
                id="axis-prefer-live"
                checked={preferAfterLoad()}
                onChange={setPreferAfterLoad}
                label="Auto-start live after Load"
                hint="Prefer WebSocket feed immediately after historical REST load."
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
            </StudioSection>

            <StudioSection
              title="Workspace"
              lead="Chart reload refetches OHLCV. UI reset restores panel layout and density only. Engine and endpoint live on Runtime."
              testId="axis-settings-workspace"
            >
              <div class="ax-chip-row">
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
        </Show>

        <Show when={tab() === 'data'}>
          <div
            id="axis-settings-panel-data"
            role="tabpanel"
            aria-labelledby="axis-settings-tab-data"
            data-testid="axis-settings-data"
          >
            <StudioSection
              title="Source & stream plugins"
              lead="Advanced fields hidden from the topbar. How many bars to load is under General → Historical bars."
              testId="axis-settings-plugins"
            >
              <PluginConfigRow layout="stacked" showAdvanced />
            </StudioSection>
            <ExchangeCredentialsPanel />
          </div>
        </Show>

        <Show when={tab() === 'editor'}>
          <div
            id="axis-settings-panel-editor"
            role="tabpanel"
            aria-labelledby="axis-settings-tab-editor"
            data-testid="axis-settings-editor"
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
          >
            <StudioSection
              title="Chart theme"
              lead="Presets and per-group colors. Pine host: chart.bg_color / chart.fg_color. Changes apply live."
            >
              <ThemePanel />
            </StudioSection>
          </div>
        </Show>
      </div>
      <StudioFooter status={footerStatus}>
        <StudioButton variant="ghost" onClick={closeWithoutSave}>
          {tab() === 'theme' || tab() === 'editor' || tab() === 'data' ? 'Close' : 'Cancel'}
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
