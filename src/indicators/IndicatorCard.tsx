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
 * Single applied-script row in the Scripts panel.
 *
 * Icon actions (visibility, settings, re-run, remove) + meta badges for
 * kind, pane, engine, live re-run policy, and last-run status — tooltips
 * carry the detail so the card stays dense. Live-policy badge is clickable
 * (cycles every-tick ↔ bar-close).
 *
 * @module indicators/IndicatorCard
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import type { Indicator } from '../store/types';
import {
  toggleIndicator,

  setIndicatorColor,
  openScriptSettings,
  store,
  setStore,
  setResultsFocusId,
  persist,
  setStatus,
} from '../store';
import { getManager } from '../chart/manager-access';
import { PLOT_PALETTE } from '../chart/series-factory';
import { Icons } from '../ui/icons';
import {
  activeChartContext,
  cycleLiveRerunOn,
  detectDeclaredOverlay,
  detectScriptKind,
  engineFamily,
  engineFamilyLabel,
  isPricePane,
  lastRunStatus,
  lastRunStatusTitle,
  liveRerunTitle,
  panePlacementLabel,
} from './script-meta';

interface Props {
  indicator: Indicator;
}

const iconBtn =
  'inline-flex items-center justify-center w-6 h-6 text-text-faint hover:text-accent border border-transparent hover:border-border/60 bg-transparent disabled:opacity-40 rounded-[var(--radius-chip)]';

const badgeShell =
  'inline-flex items-center justify-center w-[1.35rem] h-[1.35rem] border border-border/45 bg-bg/40 rounded-[var(--radius-chip)]';

/** One meta badge — icon only, full explanation in `title`. Optional click. */
const MetaBadge: Component<{
  title: string;
  testId?: string;
  class?: string;
  onClick?: () => void;
  children: import('solid-js').JSX.Element;
}> = (props) => {
  const cls = () =>
    `${badgeShell} ${props.class || 'text-text-dim'} ${
      props.onClick
        ? 'cursor-pointer hover:border-accent/50 hover:bg-accent/10'
        : ''
    }`;
  if (props.onClick) {
    return (
      <button
        type="button"
        class={cls()}
        title={props.title}
        data-testid={props.testId}
        aria-label={props.title}
        onClick={(e) => {
          e.stopPropagation();
          props.onClick?.();
        }}
      >
        {props.children}
      </button>
    );
  }
  return (
    <span
      class={cls()}
      title={props.title}
      data-testid={props.testId}
      role="img"
      aria-label={props.title}
    >
      {props.children}
    </span>
  );
};

/** Card for one entry in `store.scripts`. */
export const IndicatorCard: Component<Props> = (props) => {
  const [editingColor, setEditingColor] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const kind = createMemo(() => detectScriptKind(props.indicator.code));
  const declaredOverlay = createMemo(() =>
    detectDeclaredOverlay(props.indicator.code),
  );
  const engId = () => store.engine || store.activePlugins?.engine || 'server';
  const engFam = createMemo(() => engineFamily(engId()));
  const runStatus = createMemo(() =>
    lastRunStatus(store.runResults?.[props.indicator.id]),
  );
  const plotCount = createMemo(
    () => Object.keys(props.indicator.plots || {}).length,
  );

  const chartCtx = createMemo(() => {
    const slots = store.chartLayout?.slots?.length ?? 1;
    return activeChartContext({
      symbol: store.symbol,
      interval: store.interval,
      slotCount: slots,
      activeSlotId: store.chartLayout?.activeId,
    });
  });

  const kindTitle = () => {
    switch (kind()) {
      case 'strategy':
        return 'Pine strategy() — trades / equity in Results';
      case 'library':
        return 'Pine library() — usually not a chart study';
      case 'indicator':
        return 'Pine indicator() — study / plots';
      default:
        return 'Script kind not detected (missing indicator()/strategy()?)';
    }
  };

  const paneTitle = () => {
    const place = panePlacementLabel(props.indicator);
    const decl = declaredOverlay();
    const declBit =
      decl === true
        ? ' · source declares overlay=true'
        : decl === false
          ? ' · source declares overlay=false'
          : '';
    return `${place}${declBit}`;
  };

  const cycleRerun = () => {
    const next = cycleLiveRerunOn(store.live.rerunOn);
    setStore('live', 'rerunOn', next);
    persist();
    setStatus(
      'ready',
      next === 'bar-close'
        ? 'Live re-run: bar close only'
        : 'Live re-run: every tick',
    );
  };

  const toggle = () => toggleIndicator(props.indicator.id);

  const remove = () => {
    void import('./detach').then(({ detachIndicatorFromChart }) => {
      detachIndicatorFromChart(props.indicator.id);
    });
  };

  const reRun = () => {
    const code = props.indicator.code?.trim();
    if (!code || busy()) return;
    setBusy(true);
    void import('./runner')
      .then(({ runAndApply }) =>
        runAndApply(code, props.indicator.id, {
          silent: false,
          openResults: false,
          inputs: props.indicator.inputValues,
        }),
      )
      .finally(() => setBusy(false));
  };

  const focusResults = () => {
    setResultsFocusId(props.indicator.id);
    setStore('resultsPanel', 'open', true);
  };

  const changeColor = (plotName: string, color: string) => {
    setIndicatorColor(props.indicator.id, plotName, color);
    setEditingColor(null);
    const manager = getManager();
    if (!manager) return;
    const applied = manager.setOverlayLineColor(
      props.indicator.paneId,
      plotName,
      color,
    );
    if (!applied && props.indicator.paneId !== 'price') {
      manager.setOverlayLineColor('price', plotName, color);
    }
  };

  return (
    <div
      class="bg-bg-elev border border-border-soft p-2 mb-2 rounded-[var(--radius-chip)] data-[hidden=true]:opacity-55"
      data-testid="axis-indicator-card"
      data-hidden={!props.indicator.visible || undefined}
    >
      {/* Title row */}
      <div class="flex items-start justify-between gap-1 mb-1">
        <div class="min-w-0 flex-1">
          <div
            class="text-xs font-semibold text-text truncate"
            title={props.indicator.name}
          >
            {props.indicator.name}
          </div>
          <div
            class="text-[10px] text-text-faint font-mono truncate mt-0.5"
            title={chartCtx().title}
            data-testid="axis-indicator-chart-ctx"
          >
            {chartCtx().line}
            <Show when={plotCount() > 0}>
              <span class="text-text-dim">
                {' '}
                · {plotCount()} plot{plotCount() === 1 ? '' : 's'}
              </span>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            class={iconBtn}
            onClick={toggle}
            title={props.indicator.visible ? 'Hide on chart' : 'Show on chart'}
            aria-label={props.indicator.visible ? 'Hide' : 'Show'}
            data-testid="axis-indicator-visibility"
          >
            {props.indicator.visible ? (
              <Icons.eye size={12} />
            ) : (
              <Icons.eyeOff size={12} />
            )}
          </button>
          <button
            type="button"
            class={iconBtn}
            onClick={() => openScriptSettings(props.indicator.id)}
            title="Script settings (Pine inputs)"
            aria-label="Settings"
            data-testid="axis-indicator-settings"
          >
            <Icons.settings size={12} />
          </button>
          <button
            type="button"
            class={iconBtn}
            onClick={() => reRun()}
            disabled={busy()}
            title="Re-run this script on current bars / engine"
            aria-label="Re-run"
            data-testid="axis-indicator-rerun"
          >
            {busy() ? (
              <Icons.loader size={12} class="animate-spin" />
            ) : (
              <Icons.refresh size={12} />
            )}
          </button>
          <button
            type="button"
            class={`${iconBtn} hover:text-red`}
            onClick={remove}
            title="Remove script from chart"
            aria-label="Remove"
            data-testid="axis-indicator-remove"
          >
            <Icons.trash size={12} />
          </button>
        </div>
      </div>

      {/* Meta badges — icon-only, hover for detail */}
      <div
        class="flex flex-wrap items-center gap-0.5 mb-1.5"
        data-testid="axis-indicator-badges"
      >
        <MetaBadge title={kindTitle()} testId="axis-badge-kind">
          {kind() === 'strategy' ? (
            <Icons.trend size={11} class="text-accent-2" />
          ) : kind() === 'library' ? (
            <Icons.folder size={11} />
          ) : (
            <Icons.activity size={11} class="text-accent" />
          )}
        </MetaBadge>

        <MetaBadge title={paneTitle()} testId="axis-badge-pane">
          {isPricePane(props.indicator) ? (
            <Icons.layers size={11} class="text-accent-3" />
          ) : (
            <Icons.panelBottom size={11} />
          )}
        </MetaBadge>

        <MetaBadge
          title={engineFamilyLabel(engFam(), engId())}
          testId="axis-badge-engine"
        >
          {engFam() === 'pyodide' ? (
            <Icons.cpu size={11} class="text-accent-2" />
          ) : engFam() === 'worker' ? (
            <Icons.wifi size={11} class="text-accent" />
          ) : (
            <Icons.server size={11} class="text-text-dim" />
          )}
        </MetaBadge>

        <MetaBadge
          title={liveRerunTitle(store.live.active, store.live.rerunOn, true)}
          testId="axis-badge-live-policy"
          class={
            store.live.active
              ? 'text-accent border-accent/40'
              : 'text-text-faint'
          }
          onClick={cycleRerun}
        >
          {!store.live.active ? (
            <Icons.wifiOff size={11} />
          ) : store.live.rerunOn === 'bar-close' ? (
            <Icons.clock size={11} class="text-amber-300/90" />
          ) : (
            <Icons.zap size={11} class="text-accent" />
          )}
        </MetaBadge>

        <MetaBadge
          title={`${lastRunStatusTitle(runStatus())} · click to open Results`}
          testId="axis-badge-run"
          class={
            runStatus() === 'ok'
              ? 'text-emerald-400/90 border-emerald-500/30'
              : runStatus() === 'error'
                ? 'text-red border-red/40'
                : 'text-text-faint'
          }
          onClick={focusResults}
        >
          {runStatus() === 'ok' ? (
            <Icons.check size={11} />
          ) : runStatus() === 'error' ? (
            <Icons.alert size={11} />
          ) : (
            <Icons.circle size={8} />
          )}
        </MetaBadge>
      </div>

      {/* Plot colors */}
      <Show when={plotCount() > 0}>
        <div class="flex flex-col gap-0.5 border-t border-border/30 pt-1.5">
          <For each={Object.entries(props.indicator.plots)}>
            {([name, { color }]) => (
              <div class="flex items-center gap-2 text-[11px] text-text-dim">
                <button
                  type="button"
                  class="inline-block w-2.5 h-2.5 flex-shrink-0 cursor-pointer border border-border"
                  style={{ background: color }}
                  title={`Color for "${name}"`}
                  onClick={() =>
                    setEditingColor(editingColor() === name ? null : name)
                  }
                />
                <span class="truncate font-mono text-[10px]">{name}</span>
                <Show when={editingColor() === name}>
                  <div class="flex gap-1 ml-auto flex-wrap">
                    <For each={PLOT_PALETTE}>
                      {(c) => (
                        <button
                          type="button"
                          class="w-3 h-3 cursor-pointer border-2 border-border hover:border-accent"
                          style={{ background: c }}
                          title={c}
                          onClick={() => changeColor(name, c)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
