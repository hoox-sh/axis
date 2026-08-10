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
 * Floatable **Scripts** panel listing all scripts applied via {@link runAndApply}.
 *
 * Header strip summarizes the global composition (source · stream · engine ·
 * live policy) so card badges stay scannable. Live policy chip is clickable.
 * Each {@link IndicatorCard} uses icon actions + hover tooltips.
 *
 * @module indicators/IndicatorPanel
 */

import { Component, For, Show, createMemo } from 'solid-js';
import { store, isPanelOpen, setStore, persist, setStatus } from '../store';
import { IndicatorCard } from './IndicatorCard';
import { FloatableShell } from '../ui/panels/FloatableShell';
import { Icons } from '../ui/icons';
import {
  activeChartContext,
  cycleLiveRerunOn,
  engineFamily,
  engineFamilyLabel,
  liveRerunTitle,
} from './script-meta';

/** Compact composition chip for the panel header. */
const CompChip: Component<{
  title: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
}> = (props) => {
  const base =
    'inline-flex items-center max-w-full truncate px-1 py-px border font-mono text-[9px] uppercase tracking-wide';
  const tone = () =>
    props.active
      ? 'border-accent/50 text-accent bg-accent/10'
      : 'border-border/40 text-text-faint';
  if (props.onClick) {
    return (
      <button
        type="button"
        class={`${base} ${tone()} cursor-pointer hover:border-accent/50 hover:text-accent`}
        title={props.title}
        onClick={() => props.onClick?.()}
      >
        {props.label}
      </button>
    );
  }
  return (
    <span class={`${base} ${tone()}`} title={props.title}>
      {props.label}
    </span>
  );
};

/** Shell + composition strip + list of {@link IndicatorCard}. */
export const IndicatorPanel: Component = () => {
  const streamId = () =>
    store.live?.streamId || store.activePlugins?.stream || '—';
  const eng = () => store.engine || store.activePlugins?.engine || 'server';
  const engFam = createMemo(() => engineFamily(eng()));

  const chartCtx = createMemo(() =>
    activeChartContext({
      symbol: store.symbol,
      interval: store.interval,
      slotCount: store.chartLayout?.slots?.length ?? 1,
      activeSlotId: store.chartLayout?.activeId,
    }),
  );

  const liveChip = createMemo(() => {
    if (!store.live.active) {
      return {
        label:
          store.live.rerunOn === 'bar-close' ? 'Off · close' : 'Off · tick',
        title: liveRerunTitle(false, store.live.rerunOn, true),
        active: false,
      };
    }
    if (store.live.rerunOn === 'bar-close') {
      return {
        label: 'Bar close',
        title: liveRerunTitle(true, 'bar-close', true),
        active: true,
      };
    }
    return {
      label: 'Every tick',
      title: liveRerunTitle(true, 'every-tick', true),
      active: true,
    };
  });

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

  return (
    <Show when={isPanelOpen('indicators') || store.indicatorPanel.open}>
      <FloatableShell id="indicators" testId="axis-indicators">
        <div class="flex flex-col flex-1 min-h-0">
          {/* Global composition — clarifies the many axes */}
          <div
            class="flex-shrink-0 border-b border-border/40 px-2 py-1.5 space-y-1"
            data-testid="axis-scripts-composition"
          >
            <div class="flex items-center justify-between gap-1">
              <div class="text-[9px] uppercase tracking-wider text-text-faint">
                Composition
              </div>
              <div
                class="text-[9px] font-mono text-text-faint truncate max-w-[55%]"
                title={chartCtx().title}
                data-testid="axis-scripts-chart-ctx"
              >
                {chartCtx().line}
              </div>
            </div>
            <div class="flex flex-wrap gap-0.5">
              <CompChip
                label={store.source || 'source'}
                title={`Historical source: ${store.source} — where OHLCV bars load from`}
              />
              <CompChip
                label={streamId()}
                title={`Live stream: ${streamId()} — tick feed when Live is on`}
              />
              <CompChip
                label={eng()}
                title={engineFamilyLabel(engFam(), eng())}
              />
              <CompChip
                label={liveChip().label}
                title={liveChip().title}
                active={liveChip().active}
                onClick={cycleRerun}
              />
            </div>
            <div class="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] text-text-faint">
              <span class="inline-flex items-center gap-0.5" title="Indicator">
                <Icons.activity size={9} class="text-accent" /> ind
              </span>
              <span class="text-border">·</span>
              <span class="inline-flex items-center gap-0.5" title="Strategy">
                <Icons.trend size={9} class="text-accent-2" /> strat
              </span>
              <span class="text-border">·</span>
              <span
                class="inline-flex items-center gap-0.5"
                title="Price overlay"
              >
                <Icons.layers size={9} /> overlay
              </span>
              <span class="text-border">·</span>
              <span class="inline-flex items-center gap-0.5" title="Sub-pane">
                <Icons.panelBottom size={9} /> pane
              </span>
              <span class="text-border">·</span>
              <span
                class="inline-flex items-center gap-0.5"
                title="Server engine"
              >
                <Icons.server size={9} /> srv
              </span>
              <span class="text-border">·</span>
              <span
                class="inline-flex items-center gap-0.5"
                title="Click Live chip or card clock/zap to switch tick ↔ bar close"
              >
                <Icons.zap size={9} />/
                <Icons.clock size={9} /> policy
              </span>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-2 min-h-0">
            <Show
              when={store.scripts.length > 0}
              fallback={
                <div class="text-text-faint text-[0.85em] italic p-2">
                  No scripts on the chart.
                  <div class="mt-2 not-italic text-text-dim normal-case tracking-normal leading-relaxed">
                    Run Pine from the editor. Cards show{' '}
                    <strong class="text-text font-medium">where</strong> Pine
                    evaluates (engine),{' '}
                    <strong class="text-text font-medium">how</strong> live
                    re-runs (tick vs bar close — click the policy badge), and{' '}
                    <strong class="text-text font-medium">which pane</strong>{' '}
                    (overlay vs sub-pane). Hover icons for detail.
                  </div>
                </div>
              }
            >
              <For each={store.scripts}>
                {(ind) => <IndicatorCard indicator={ind} />}
              </For>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
