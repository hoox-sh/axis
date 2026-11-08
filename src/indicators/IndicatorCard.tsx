// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
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

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { Indicator } from '../store/types';
import {
  setIndicatorColor,
  setIndicatorPlotDisplay,
  setIndicatorPlotLineStyle,
  setIndicatorPlotWidth,
  setIndicatorPlotVisible,
  openScriptSettings,
  store,
  setStore,
  setResultsFocusId,
  moveIndicator,
  persist,
  setStatus,
} from '../store';
import { getManager } from '../chart/manager-access';
import { toggleScriptChartVisible } from './visibility';
import { PLOT_PALETTE } from '../chart/series-factory';
import {
  PLOT_LINE_STYLES,
  PLOT_LINE_STYLE_LABELS,
  effectivePlotDisplay,
  effectivePlotLineStyle,
  effectivePlotWidth,
  formatPlotDisplay,
  formatPlotDisplayCompact,
  hasDisplayOverride,
  pinePlotDisplay,
  plotDisplayTargets,
  togglePlotDisplayBit,
  type PlotLineStyle,
} from './plot-prefs';
import { PLOT_DISPLAY } from '../results/plot-visuals';
import { Icons } from '../ui/icons';
import { Spinner } from '../ui/Spinner';
import {
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
import { copyToClipboard } from '../ui/clipboard';
import { dismissOnOutside } from '../ui/dismiss-on-outside';

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
      props.onClick ? 'cursor-pointer hover:border-accent/50 hover:bg-accent/10' : ''
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

/** Small inline preview of a line type (panel picker + row glyph). */
const PlotStyleGlyph: Component<{ style: PlotLineStyle; width?: number }> = (props) => {
  const w = () => props.width ?? 14;
  const dash = () =>
    props.style === 'dotted'
      ? '0.6 2'
      : props.style === 'dashed'
        ? '3 2'
        : props.style === 'large_dashed'
          ? '5 2.5'
          : undefined;
  return (
    <svg width={w()} height={8} aria-hidden="true" class="flex-shrink-0">
      <line
        x1={0}
        y1={4}
        x2={w()}
        y2={4}
        stroke="currentColor"
        stroke-width={1.5}
        stroke-linecap="round"
        stroke-dasharray={dash()}
      />
    </svg>
  );
};

/** One toggle row in the `display.*` popover. */
const DisplayTargetToggle: Component<{
  label: string;
  active: boolean;
  bit: number;
  onToggle: (bit: number) => void;
}> = (props) => (
  <button
    type="button"
    aria-pressed={props.active}
    class={`flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-left rounded-[var(--radius-chip)] ${
      props.active ? 'text-text' : 'text-text-faint hover:text-text'
    } hover:bg-bg`}
    onClick={() => props.onToggle(props.bit)}
    data-display-target={props.label.toLowerCase().replace(/\s+/g, '-')}
  >
    <span
      class={`inline-flex items-center justify-center w-3 h-3 border rounded-[2px] ${
        props.active ? 'border-accent bg-accent/20 text-accent' : 'border-border'
      }`}
    >
      {props.active ? '✓' : ''}
    </span>
    {props.label}
  </button>
);

/** Which plot's style / display popover is open (module-level so a store
 * update — which re-creates the card — does not close it). One at a time. */
const [plotStylePopover, setPlotStylePopover] = createSignal<{
  id: string;
  plot: string;
} | null>(null);
const [plotDisplayPopover, setPlotDisplayPopover] = createSignal<{
  id: string;
  plot: string;
} | null>(null);

/** Card for one entry in `store.scripts`. */
export const IndicatorCard: Component<Props> = (props) : JSX.Element => {
  const [editingColor, setEditingColor] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const colorPopoverRef = createSignal<HTMLDivElement | null>(null);
  const stylePopoverRef = createSignal<HTMLDivElement | null>(null);
  const displayPopoverRef = createSignal<HTMLDivElement | null>(null);
  let styleTriggerEl: HTMLButtonElement | undefined;
  let displayTriggerEl: HTMLButtonElement | undefined;

  const kind = createMemo(() => detectScriptKind(props.indicator.code));
  const declaredOverlay = createMemo(() => detectDeclaredOverlay(props.indicator.code));
  const engId = () => store.engine || store.activePlugins?.engine || 'server';
  const engFam = createMemo(() => engineFamily(engId()));
  const runStatus = createMemo(() => lastRunStatus(store.runResults?.[props.indicator.id]));
  /** Engine-owned stream runtime status — present only on the stream path. */
  const streamStatus = createMemo(() => store.live.scriptStatus?.[props.indicator.id]);
  const plotCount = createMemo(() => Object.keys(props.indicator.plots || {}).length);
  const [moreOpen, setMoreOpen] = createSignal(false);
  /** Controls stay open for small studies; long plot lists start compact. */
  const [plotsOpen, setPlotsOpen] = createSignal(
    Object.keys(props.indicator.plots || {}).length <= 2,
  );

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
      next === 'bar-close' ? 'Live re-run: bar close only' : 'Live re-run: every tick',
    );
  };

  const toggle = () => toggleScriptChartVisible(props.indicator.id);

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

  const scriptIndex = () => store.scripts.findIndex((s) => s.id === props.indicator.id);

  const move = (delta: -1 | 1) => {
    if (moveIndicator(props.indicator.id, delta)) {
      setStatus('ready', delta < 0 ? 'Moved script up' : 'Moved script down');
    }
  };

  const copyCode = async () => {
    if (await copyToClipboard(props.indicator.code ?? '')) {
      setStatus('ready', `Copied ${props.indicator.name} Pine`);
    }
  };

  const changeColor = (plotName: string, color: string) => {
    setIndicatorColor(props.indicator.id, plotName, color);
    setEditingColor(null);
    const manager = getManager();
    if (!manager) return;
    const applied = manager.setOverlayLineColor(props.indicator.paneId, plotName, color);
    if (!applied && props.indicator.paneId !== 'price') {
      manager.setOverlayLineColor('price', plotName, color);
    }
  };

  const changeWidth = (plotName: string, width: number) => {
    setIndicatorPlotWidth(props.indicator.id, plotName, width);
    const manager = getManager();
    if (!manager) return;
    manager.setOverlayLineWidth(props.indicator.paneId, plotName, width);
  };

  const changeLineStyle = (plotName: string, style: PlotLineStyle | null) => {
    setIndicatorPlotLineStyle(props.indicator.id, plotName, style);
    setPlotStylePopover(null);
    const manager = getManager();
    if (!manager) return;
    manager.setOverlayLineStyle?.(props.indicator.paneId, plotName, style);
  };

  const changeDisplay = (plotName: string, next: number | null) => {
    setIndicatorPlotDisplay(props.indicator.id, plotName, next);
    const manager = getManager();
    if (!manager) return;
    const plot = props.indicator.plots[plotName];
    // The popover only opens for a rendered series, so `plot` exists; passing
    // `undefined` through keeps the fallback path total for a stale name.
    const base = plot ? { ...plot, display: undefined } : undefined;
    manager.setOverlayLineDisplay?.(
      props.indicator.paneId,
      plotName,
      next != null ? next : effectivePlotDisplay(base),
      undefined,
      plot?.visible !== false,
    );
  };

  const toggleDisplayTarget = (plotName: string, bit: number) => {
    const plot = props.indicator.plots[plotName];
    changeDisplay(plotName, togglePlotDisplayBit(plot, bit));
  };

  const togglePlotVisible = (plotName: string, visible: boolean) => {
    setIndicatorPlotVisible(props.indicator.id, plotName, visible);
    const manager = getManager();
    if (!manager) return;
    manager.setOverlayLineVisible?.(props.indicator.paneId, plotName, visible);
  };

  // Color popover — dismiss on outside click (registered while open).
  createEffect(() => {
    if (editingColor() == null) return;
    const dispose = dismissOnOutside({
      inside: () => [
        colorPopoverRef[0](),
        document.querySelector(
          `[data-color-trigger="${props.indicator.id}"]`,
        ) as HTMLElement | null,
      ],
      onDismiss: () => setEditingColor(null),
    });
    onCleanup(dispose);
  });

  // Line-type / display popovers — one at a time across all cards.
  const styleOpen = () => {
    const cur = plotStylePopover();
    return cur != null && cur.id === props.indicator.id;
  };
  const displayOpen = () => {
    const cur = plotDisplayPopover();
    return cur != null && cur.id === props.indicator.id;
  };
  createEffect(() => {
    if (!styleOpen()) return;
    const dispose = dismissOnOutside({
      inside: () => [stylePopoverRef[0](), styleTriggerEl],
      onDismiss: () => setPlotStylePopover(null),
    });
    onCleanup(dispose);
  });
  createEffect(() => {
    if (!displayOpen()) return;
    const dispose = dismissOnOutside({
      inside: () => [displayPopoverRef[0](), displayTriggerEl],
      onDismiss: () => setPlotDisplayPopover(null),
    });
    onCleanup(dispose);
  });

  return (
    <div
      class="ax-scripts-card"
      classList={{ 'is-hidden': !props.indicator.visible }}
      data-testid="axis-indicator-card"
      data-hidden={!props.indicator.visible || undefined}
      data-script-kind={kind()}
    >
      <span class="ax-scripts-card-rail" aria-hidden="true" />
      <div class="ax-scripts-card-head">
        <button
          type="button"
          class={`ax-scripts-status is-${runStatus()}`}
          title={`${lastRunStatusTitle(runStatus())} · click to open Results`}
          aria-label={lastRunStatusTitle(runStatus())}
          data-testid="axis-indicator-status"
          onClick={focusResults}
        />
        <span class="ax-scripts-card-name" title={props.indicator.name}>
          {props.indicator.name}
        </span>
        <div class="ax-scripts-card-actions">
          <button
            type="button"
            class={iconBtn}
            onClick={toggle}
            title={
              props.indicator.visible
                ? 'Hide — pause live execution and remove plots'
                : 'Show — run this script on the chart'
            }
            aria-label={props.indicator.visible ? 'Hide' : 'Show'}
            data-testid="axis-indicator-visibility"
          >
            {props.indicator.visible ? <Icons.eye size={12} /> : <Icons.eyeOff size={12} />}
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
            {busy() ? <Spinner size={12} /> : <Icons.refresh size={12} />}
          </button>
          <button
            type="button"
            class={iconBtn}
            classList={{ 'text-accent': moreOpen() }}
            onClick={() => setMoreOpen((v) => !v)}
            title="More script actions"
            aria-label="More script actions"
            aria-expanded={moreOpen()}
            data-testid="axis-indicator-more"
          >
            <Icons.menu size={12} />
          </button>
        </div>
      </div>
      <div class="ax-scripts-card-sub" title={paneTitle()}>
        {isPricePane(props.indicator) ? 'overlay' : 'pane'}
        <Show when={plotCount() > 0}>
          <span class="ax-scripts-card-sub-dim">
            {' '}
            · {plotCount()} plot{plotCount() === 1 ? '' : 's'}
          </span>
        </Show>
      </div>

      <Show when={moreOpen()}>
        <div class="ax-scripts-card-more" data-testid="axis-indicator-more-row">
          <button type="button" onClick={() => void copyCode()}>
            <Icons.copy size={10} /> Copy Pine
          </button>
          <button type="button" disabled={scriptIndex() <= 0} onClick={() => move(-1)}>
            <Icons.chevronUp size={10} /> Up
          </button>
          <button
            type="button"
            disabled={scriptIndex() < 0 || scriptIndex() >= store.scripts.length - 1}
            onClick={() => move(1)}
          >
            <Icons.chevronDown size={10} /> Down
          </button>
          <button type="button" onClick={focusResults}>
            <Icons.results size={10} /> Results
          </button>
          <button type="button" class="is-danger" onClick={remove}>
            <Icons.trash size={10} /> Remove
          </button>
        </div>
      </Show>

      {/* Meta badges — icon-only, hover for detail */}
      <div class="flex flex-wrap items-center gap-0.5 mb-1.5" data-testid="axis-indicator-badges">
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

        <MetaBadge title={engineFamilyLabel(engFam(), engId())} testId="axis-badge-engine">
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
          class={store.live.active ? 'text-accent border-accent/40' : 'text-text-faint'}
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

        <Show when={streamStatus()}>
          {(s) => (
            <MetaBadge
              title={`Stream: ${s().status}${s().message ? ` · ${s().message}` : ''}${s().verified ? ` · verified:${s().verified}` : ''}`}
              testId="axis-badge-stream"
              class={
                s().status === 'live' && s().verified !== 'engine' && s().verified !== 'none'
                  ? 'text-emerald-400/90 border-emerald-500/30'
                  : s().status === 'error'
                    ? 'text-red border-red/40'
                    : s().status === 'degraded'
                      ? 'text-amber-300/90 border-amber-500/30'
                      : 'text-text-faint'
              }
            >
              <Icons.zap size={11} />
            </MetaBadge>
          )}
        </Show>
      </div>

      {/* Plot colors, width, visibility */}
      <Show when={plotCount() > 0}>
        <div class="ax-scripts-plots">
          <button
            type="button"
            class="ax-scripts-plots-head"
            aria-expanded={plotsOpen()}
            title={plotsOpen() ? 'Collapse plot controls' : 'Expand plot controls'}
            onClick={() => setPlotsOpen((v) => !v)}
            data-testid="axis-plots-toggle"
          >
            <Icons.chevronDown
              size={10}
              class={`ax-scripts-chevron${plotsOpen() ? ' is-open' : ''}`}
            />
            <span>Plots</span>
            <span class="ax-scripts-plot-count">{plotCount()}</span>
            <span class="ax-scripts-swatches" aria-hidden="true">
              <For each={Object.values(props.indicator.plots)}>
                {(plot) => <span class="ax-scripts-swatch" style={{ background: plot.color }} />}
              </For>
            </span>
          </button>
          <Show when={plotsOpen()}>
            <div class="ax-scripts-plot-list">
              <For each={Object.entries(props.indicator.plots)}>
                {([name, plot]) => {
                  const plotColor = plot.color;
                  // Default width is 1 (Pine plot lines are 1 px). Using 2 here made
                  // the first “+” jump the label from 1 → 3.
                  const plotWidth = effectivePlotWidth(plot);
                  const plotVisible = plot.visible !== false;
                  const lineStyle = effectivePlotLineStyle(plot);
                  const displayBits = effectivePlotDisplay(plot);
                  const displayTargets = plotDisplayTargets(displayBits);
                  const pineDisplay = pinePlotDisplay(plot);
                  return (
                    <div class="ax-scripts-plot-row">
                      <div class="ax-scripts-plot-top">
                        <button
                          type="button"
                          class="ax-scripts-plot-swatch"
                          style={{ background: plotColor }}
                          title={`Color for "${name}"`}
                          data-color-trigger={props.indicator.id}
                          onClick={() => setEditingColor(editingColor() === name ? null : name)}
                        />
                        <span class="ax-scripts-plot-name" title={name}>
                          {name}
                        </span>
                      </div>
                      <div class="ax-scripts-plot-controls">
                        {/* Width buttons */}
                        <div class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-faint hover:text-text border border-transparent hover:border-border/60 rounded-[var(--radius-chip)]">
                          <button
                            type="button"
                            class="inline-flex items-center justify-center w-5 h-5 text-text-faint hover:text-accent border border-border rounded-[var(--radius-chip)] hover:bg-bg"
                            title={`Decrease line width for "${name}"`}
                            onClick={() => changeWidth(name, Math.max(1, plotWidth - 1))}
                            aria-label={`Decrease line width for ${name}`}
                          >
                            <Icons.minus size={9} />
                          </button>
                          <span
                            class="font-mono w-5 text-center text-text"
                            data-testid="axis-plot-width"
                            data-width={plotWidth}
                          >
                            {plotWidth}
                          </span>
                          <button
                            type="button"
                            class="inline-flex items-center justify-center w-5 h-5 text-text-faint hover:text-accent border border-border rounded-[var(--radius-chip)] hover:bg-bg"
                            title={`Increase line width for "${name}"`}
                            onClick={() => changeWidth(name, Math.min(4, plotWidth + 1))}
                            aria-label={`Increase line width for ${name}`}
                          >
                            <Icons.plus size={9} />
                          </button>
                        </div>
                        {/* Line type (AXIS platform override — Pine plot() has no line style) */}
                        <button
                          type="button"
                          ref={(el) => {
                            styleTriggerEl = el;
                          }}
                          class="inline-flex items-center justify-center w-5 h-5 text-text-faint hover:text-accent border border-transparent hover:border-border/60 bg-transparent rounded-[var(--radius-chip)]"
                          title={`Line type for "${name}" — ${
                            lineStyle ? PLOT_LINE_STYLE_LABELS[lineStyle] : 'Solid'
                          }${plot.linestyle ? '' : ' (follows script)'}. AXIS override: Pine plot() lines are solid.`}
                          aria-label={`Line type for ${name}`}
                          data-style-trigger={props.indicator.id}
                          onClick={() => {
                            setPlotDisplayPopover(null);
                            setEditingColor(null);
                            const cur = plotStylePopover();
                            setPlotStylePopover(
                              cur?.id === props.indicator.id && cur?.plot === name
                                ? null
                                : { id: props.indicator.id, plot: name },
                            );
                          }}
                        >
                          <PlotStyleGlyph style={lineStyle ?? 'solid'} />
                        </button>
                        {/* display.* targets (Pine `plot(..., display=)` + override) */}
                        <button
                          type="button"
                          ref={(el) => {
                            displayTriggerEl = el;
                          }}
                          class="inline-flex items-center justify-center w-5 h-5 text-text-faint hover:text-accent border border-transparent hover:border-border/60 bg-transparent rounded-[var(--radius-chip)]"
                          title={`Display for "${name}" — ${formatPlotDisplay(displayBits)}${
                            hasDisplayOverride(plot) ? ' (panel override)' : ' (from script)'
                          }`}
                          aria-label={`Display targets for ${name}`}
                          data-display-trigger={props.indicator.id}
                          onClick={() => {
                            setPlotStylePopover(null);
                            setEditingColor(null);
                            const cur = plotDisplayPopover();
                            setPlotDisplayPopover(
                              cur?.id === props.indicator.id && cur?.plot === name
                                ? null
                                : { id: props.indicator.id, plot: name },
                            );
                          }}
                        >
                          <span
                            class="font-mono text-[10px] leading-none"
                            data-testid="axis-plot-display"
                          >
                            {formatPlotDisplayCompact(displayBits)}
                          </span>
                        </button>
                        {/* Visibility toggle */}
                        <button
                          type="button"
                          class="inline-flex items-center justify-center w-5 h-5 text-text-faint hover:text-accent border border-transparent hover:border-border/60 bg-transparent rounded-[var(--radius-chip)]"
                          title={plotVisible ? `Hide "${name}"` : `Show "${name}"`}
                          onClick={() => togglePlotVisible(name, !plotVisible)}
                          aria-label={plotVisible ? 'Hide plot' : 'Show plot'}
                        >
                          {plotVisible ? <Icons.eye size={10} /> : <Icons.eyeOff size={10} />}
                        </button>
                      </div>
                      {/* Line-type popover */}
                      <Show when={styleOpen() && plotStylePopover()?.plot === name}>
                        <div
                          ref={stylePopoverRef[1]}
                          class="absolute z-20 flex flex-col gap-0.5 ml-auto px-1 py-1 bg-bg-elev border border-border rounded-[var(--radius-chip)] shadow-lg"
                          data-testid="axis-plot-style-popover"
                        >
                          <For each={PLOT_LINE_STYLES}>
                            {(style) => (
                              <button
                                type="button"
                                class={`flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-left rounded-[var(--radius-chip)] ${
                                  (lineStyle ?? 'solid') === style
                                    ? 'text-accent bg-accent/10'
                                    : 'text-text-dim hover:text-text hover:bg-bg'
                                }`}
                                onClick={() => changeLineStyle(name, style)}
                                data-line-style={style}
                              >
                                <PlotStyleGlyph style={style} width={22} />
                                {PLOT_LINE_STYLE_LABELS[style]}
                              </button>
                            )}
                          </For>
                          <button
                            type="button"
                            class="px-1 py-0.5 text-[10px] text-text-faint hover:text-accent text-left"
                            onClick={() => changeLineStyle(name, null)}
                            data-line-style="reset"
                            disabled={plot.linestyle == null}
                          >
                            Follow script
                          </button>
                        </div>
                      </Show>
                      {/* Display popover */}
                      <Show when={displayOpen() && plotDisplayPopover()?.plot === name}>
                        <div
                          ref={displayPopoverRef[1]}
                          class="absolute z-20 flex flex-col gap-0.5 ml-auto px-1 py-1 bg-bg-elev border border-border rounded-[var(--radius-chip)] shadow-lg"
                          data-testid="axis-plot-display-popover"
                        >
                          <DisplayTargetToggle
                            label="Pane"
                            active={displayTargets.pane}
                            bit={PLOT_DISPLAY.pane}
                            onToggle={(bit) => toggleDisplayTarget(name, bit)}
                          />
                          <DisplayTargetToggle
                            label="Data window"
                            active={displayTargets.dataWindow}
                            bit={PLOT_DISPLAY.data_window}
                            onToggle={(bit) => toggleDisplayTarget(name, bit)}
                          />
                          <DisplayTargetToggle
                            label="Price scale"
                            active={displayTargets.priceScale}
                            bit={PLOT_DISPLAY.price_scale}
                            onToggle={(bit) => toggleDisplayTarget(name, bit)}
                          />
                          <div class="flex items-center justify-between gap-2 px-1 pt-0.5 border-t border-border/40">
                            <span
                              class="text-[10px] font-mono text-text-faint"
                              title="Declared in the script"
                            >
                              Pine: {pineDisplay != null ? formatPlotDisplay(pineDisplay) : 'all'}
                            </span>
                            <button
                              type="button"
                              class="text-[10px] text-text-faint hover:text-accent disabled:opacity-40"
                              onClick={() => changeDisplay(name, null)}
                              disabled={!hasDisplayOverride(plot)}
                              data-display-action="reset"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      </Show>
                      {/* Color popover */}
                      <Show when={editingColor() === name}>
                        <div
                          ref={colorPopoverRef[1]}
                          class="absolute z-20 flex gap-1 ml-auto flex-wrap px-1 py-1 bg-bg-elev border border-border rounded-[var(--radius-chip)] shadow-lg"
                        >
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
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
