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
 * Floatable **Scripts** panel listing all scripts applied via {@link runAndApply}.
 *
 * Header strip summarizes the global composition (source · stream · engine ·
 * live policy) so card badges stay scannable. Live policy chip is clickable.
 * Each {@link IndicatorCard} uses icon actions + hover tooltips.
 *
 * @module indicators/IndicatorPanel
 */

import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { store, isPanelOpen, setStore, persist, setStatus } from '../store';
import { IndicatorCard } from './IndicatorCard';
import { FloatableShell } from '../ui/panels/FloatableShell';
import { Icons } from '../ui/icons';
import {
  applyBuiltinScript,
  builtinCategoryLabel,
  filterBuiltinScripts,
} from './builtins';
import {
  activeChartContext,
  detectScriptKind,
  engineFamily,
  engineFamilyLabel,
  lastRunStatus,
  liveRerunTitle,
} from './script-meta';
import { setScriptChartVisible } from './visibility';
import { getEngineCapabilities } from '../engines/catalog';
import { bindSlashToSearch } from '../ui/focus-search';

type ScriptFilter = 'all' | 'indicator' | 'strategy' | 'errors' | 'hidden';

/** Compact composition chip for the panel header. */
const CompChip: Component<{
  title: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
}> = (props) => {
  const base =
    'inline-flex items-center max-w-full truncate px-1 py-px border font-mono text-[10px] uppercase tracking-wide rounded-[var(--radius-chip)]';
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
export const IndicatorPanel: Component = () : JSX.Element => {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerQuery, setPickerQuery] = createSignal('');
  const pickerHits = createMemo(() => filterBuiltinScripts(pickerQuery()));
  const [query, setQuery] = createSignal('');
  const [filter, setFilter] = createSignal<ScriptFilter>('all');
  const [bulkOpen, setBulkOpen] = createSignal(false);
  const [helpOpen, setHelpOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  const counts = createMemo(() => {
    const c = { all: store.scripts.length, indicator: 0, strategy: 0, errors: 0, hidden: 0 };
    for (const script of store.scripts) {
      const kind = detectScriptKind(script.code);
      if (kind === 'indicator') c.indicator += 1;
      else if (kind === 'strategy') c.strategy += 1;
      if (lastRunStatus(store.runResults?.[script.id]) === 'error') c.errors += 1;
      if (!script.visible) c.hidden += 1;
    }
    return c;
  });

  const summary = createMemo(() => {
    let ok = 0;
    let err = 0;
    let plots = 0;
    for (const script of store.scripts) {
      const status = lastRunStatus(store.runResults?.[script.id]);
      if (status === 'ok') ok += 1;
      else if (status === 'error') err += 1;
      plots += Object.keys(script.plots || {}).length;
    }
    return { ok, err, plots };
  });

  const visibleScripts = createMemo(() => {
    const q = query().trim().toLowerCase();
    const f = filter();
    return store.scripts.filter((script) => {
      if (f === 'hidden' && script.visible) return false;
      if (f === 'errors' && lastRunStatus(store.runResults?.[script.id]) !== 'error') return false;
      if ((f === 'indicator' || f === 'strategy') && detectScriptKind(script.code) !== f) {
        return false;
      }
      if (!q) return true;
      // Name + pane only: Pine code contains tokens like `version` whose
      // substrings would match short queries (`rsi`).
      return `${script.name} ${script.paneId}`.toLowerCase().includes(q);
    });
  });

  const filterChips = createMemo(() => {
    const c = counts();
    const chips: { id: ScriptFilter; label: string; n: number }[] = [
      { id: 'all', label: 'All', n: c.all },
      { id: 'indicator', label: 'Ind', n: c.indicator },
      { id: 'strategy', label: 'Strat', n: c.strategy },
    ];
    if (c.errors) chips.push({ id: 'errors', label: 'Err', n: c.errors });
    if (c.hidden) chips.push({ id: 'hidden', label: 'Hidden', n: c.hidden });
    return chips;
  });

  const showAll = () => {
    for (const script of store.scripts) {
      if (!script.visible) setScriptChartVisible(script.id, true);
    }
    setStatus('ready', 'All scripts shown');
  };

  const hideAll = () => {
    for (const script of store.scripts) {
      if (script.visible) setScriptChartVisible(script.id, false);
    }
    setStatus('ready', 'All scripts hidden');
  };

  const removeAll = () => {
    if (!store.scripts.length) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Remove all ${store.scripts.length} scripts from the chart?`)
    ) {
      return;
    }
    void import('./detach').then(({ detachIndicatorFromChart }) => {
      for (const script of [...store.scripts]) detachIndicatorFromChart(script.id);
      setStatus('ready', 'Removed all scripts');
    });
  };

  const resetFilters = () => {
    setQuery('');
    setFilter('all');
  };

  onMount(() => onCleanup(bindSlashToSearch(() => searchInput)));

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

  const [liveCaps] = createResource(
    () => String(store.activePlugins?.engine || store.engine || ''),
    async (id) => getEngineCapabilities(id || undefined),
  );

  /**
   * Effective cadence for the chip. The stored preference is never rewritten —
   * an engine that cannot do every-tick falls back to bar close at run time
   * (`liveRerunModeForEngine`) and the chip says so; silently downgrading the
   * saved setting reads as "my setting does not save".
   */
  const effectiveRerunOn = createMemo<'every-tick' | 'bar-close'>(() => {
    const stored: 'every-tick' | 'bar-close' =
      store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick';
    const caps = liveCaps();
    if (stored !== 'every-tick' || !caps) return stored;
    return caps.liveModes.includes('every-tick') ? 'every-tick' : 'bar-close';
  });

  const liveChip = createMemo(() => {
    const eff = effectiveRerunOn();
    const engineLimited = eff !== store.live.rerunOn;
    const limitHint = engineLimited ? ' · engine advertises bar close only' : '';
    if (!store.live.active) {
      return {
        label: eff === 'bar-close' ? 'Off · close' : 'Off · tick',
        title: liveRerunTitle(false, eff, true) + limitHint,
        active: false,
      };
    }
    if (eff === 'bar-close') {
      return {
        label: engineLimited ? 'Bar close · engine' : 'Bar close',
        title: liveRerunTitle(true, 'bar-close', true) + limitHint,
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
    const allowed = liveCaps()?.liveModes ?? ['bar-close'];
    const idx = allowed.indexOf(store.live.rerunOn);
    const next = allowed[(idx + 1) % allowed.length] ?? 'bar-close';
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
        <div class="ax-scripts flex flex-col flex-1 min-h-0">
          {/* ── Composition + search + filters ─────────────────────── */}
          <div class="ax-scripts-head flex-shrink-0" data-testid="axis-scripts-composition">
            <div class="ax-scripts-head-top">
              <span class="ax-scripts-kicker">Composition</span>
              <span
                class="ax-scripts-ctx"
                title={chartCtx().title}
                data-testid="axis-scripts-chart-ctx"
              >
                {chartCtx().line}
              </span>
              <button
                type="button"
                class="ax-scripts-icon"
                classList={{ 'is-on': helpOpen() }}
                title="Badge key"
                aria-label="Badge key"
                aria-expanded={helpOpen()}
                onClick={() => setHelpOpen((v) => !v)}
              >
                ?
              </button>
            </div>

            <div class="ax-scripts-chips">
              <CompChip
                label={store.source || 'source'}
                title={`Historical source: ${store.source} — where OHLCV bars load from`}
              />
              <CompChip
                label={streamId()}
                title={`Live stream: ${streamId()} — tick feed when Live is on`}
              />
              <CompChip label={eng()} title={engineFamilyLabel(engFam(), eng())} />
              <CompChip
                label={liveChip().label}
                title={liveChip().title}
                active={liveChip().active}
                onClick={cycleRerun}
              />
            </div>

            <Show when={helpOpen()}>
              <div class="ax-scripts-help" data-testid="axis-scripts-help">
                <span title="Indicator">
                  <Icons.activity size={9} class="text-accent" /> ind
                </span>
                <span title="Strategy">
                  <Icons.trend size={9} class="text-accent-2" /> strat
                </span>
                <span title="Price overlay">
                  <Icons.layers size={9} /> overlay
                </span>
                <span title="Sub-pane">
                  <Icons.panelBottom size={9} /> pane
                </span>
                <span title="Server engine">
                  <Icons.server size={9} /> srv
                </span>
                <span title="Click the live chip or a card clock/zap to switch tick ↔ bar close">
                  <Icons.zap size={9} />/<Icons.clock size={9} /> policy
                </span>
              </div>
            </Show>

            <div class="ax-scripts-search">
              <Icons.search size={12} />
              <input
                ref={searchInput}
                type="search"
                class="ax-scripts-search-input"
                placeholder="Find scripts…"
                aria-label="Find applied scripts"
                data-testid="axis-scripts-search"
                value={query()}
                autocomplete="off"
                spellcheck={false}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query()) {
                    e.preventDefault();
                    setQuery('');
                  }
                }}
              />
              <Show when={query()} fallback={<kbd class="ax-scripts-kbd">/</kbd>}>
                <button
                  type="button"
                  class="ax-scripts-search-clear"
                  title="Clear search"
                  aria-label="Clear script search"
                  onClick={() => {
                    setQuery('');
                    searchInput?.focus();
                  }}
                >
                  <Icons.x size={10} />
                </button>
              </Show>
            </div>

            <div class="ax-scripts-filters">
              <For each={filterChips()}>
                {(chip) => (
                  <button
                    type="button"
                    class="ax-scripts-filter"
                    classList={{ 'is-on': filter() === chip.id }}
                    aria-pressed={filter() === chip.id}
                    data-testid={`axis-scripts-filter-${chip.id}`}
                    onClick={() => setFilter(chip.id)}
                  >
                    {chip.label}
                    <span class="ax-scripts-filter-count">{chip.n}</span>
                  </button>
                )}
              </For>
              <span class="ax-scripts-spacer" />
              <button
                type="button"
                class="ax-scripts-tool"
                classList={{ 'is-on': pickerOpen() }}
                title="Add an original AXIS built-in study"
                data-testid="axis-scripts-add-builtin"
                onClick={() => setPickerOpen((v) => !v)}
              >
                <Icons.plus size={10} /> Built-in
              </button>
              <button
                type="button"
                class="ax-scripts-tool"
                classList={{ 'is-on': bulkOpen() }}
                title="Bulk script actions"
                aria-label="Bulk script actions"
                aria-expanded={bulkOpen()}
                data-testid="axis-scripts-bulk-toggle"
                onClick={() => setBulkOpen((v) => !v)}
              >
                <Icons.menu size={11} />
              </button>
            </div>

            <Show when={bulkOpen()}>
              <div class="ax-scripts-bulk" data-testid="axis-scripts-bulk">
                <button type="button" onClick={showAll}>
                  <Icons.eye size={10} /> Show all
                </button>
                <button type="button" onClick={hideAll}>
                  <Icons.eyeOff size={10} /> Hide all
                </button>
                <button type="button" class="is-danger" onClick={removeAll}>
                  <Icons.trash size={10} /> Remove all
                </button>
              </div>
            </Show>

            <Show when={pickerOpen()}>
              <div class="ax-scripts-picker" data-testid="axis-builtin-picker">
                <input
                  type="search"
                  class="sc-input h-6 min-h-6 text-[11px]"
                  placeholder="Search built-ins…"
                  value={pickerQuery()}
                  data-testid="axis-builtin-picker-input"
                  spellcheck={false}
                  onInput={(e) => setPickerQuery(e.currentTarget.value)}
                />
                <div class="ax-scripts-picker-list">
                  <For each={pickerHits()}>
                    {(script) => (
                      <button
                        type="button"
                        class="ax-scripts-picker-row"
                        data-testid={`axis-builtin-pick-${script.id}`}
                        title={script.description}
                        onClick={() => {
                          void applyBuiltinScript(script.id);
                          setPickerOpen(false);
                          setPickerQuery('');
                        }}
                      >
                        <span class="truncate">{script.title}</span>
                        <span class="ax-scripts-picker-cat">
                          {builtinCategoryLabel(script.category)}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div class="ax-scripts-summary" data-testid="axis-scripts-summary">
              {counts().all} script{counts().all === 1 ? '' : 's'} · {summary().ok} ok ·{' '}
              {summary().err} err · {summary().plots} plot
              {summary().plots === 1 ? '' : 's'}
            </div>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 px-2 pb-2 pt-2">
            <Show
              when={store.scripts.length > 0}
              fallback={
                <div class="ax-scripts-empty" data-testid="axis-scripts-empty">
                  <span class="ax-scripts-empty-icon">
                    <Icons.scripts size={18} />
                  </span>
                  <p class="ax-scripts-empty-title">No scripts yet</p>
                  <p class="ax-scripts-empty-sub">
                    Add a first-party built-in, or run Pine from the editor.
                  </p>
                  <div class="ax-scripts-empty-actions">
                    <button
                      type="button"
                      class="sc-btn sc-btn-primary ax-scripts-empty-btn"
                      onClick={() => setPickerOpen(true)}
                    >
                      <Icons.plus size={11} /> Add built-in
                    </button>
                  </div>
                </div>
              }
            >
              <Show
                when={visibleScripts().length > 0}
                fallback={
                  <div class="ax-scripts-empty" data-testid="axis-scripts-no-match">
                    <span class="ax-scripts-empty-icon">
                      <Icons.search size={18} />
                    </span>
                    <p class="ax-scripts-empty-title">No scripts match</p>
                    <p class="ax-scripts-empty-sub">Clear the search or pick another filter.</p>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost ax-scripts-empty-btn"
                      onClick={resetFilters}
                    >
                      Reset filters
                    </button>
                  </div>
                }
              >
                <For each={visibleScripts()}>
                  {(ind) => <IndicatorCard indicator={ind} />}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
