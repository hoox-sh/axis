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
 * Topbar control: enable compare, enter second symbol, pick % / absolute.
 *
 * Loading is triggered on enable + Enter/blur when the symbol is set.
 * ChartHost paints the series from `store.compare` once bars arrive.
 *
 * Visual language matches {@link TopbarField} / axis-tb chrome.
 *
 * @module ui/CompareSymbolControl
 */

import { Component, Show } from 'solid-js';
import {
  store,
  setCompareEnabled,
  setCompareSymbol,
  setCompareMode,
  setCompareNormalizeMain,
  setCompareLoadState,
  setCompareBars,
  clearCompareBars,
  persist,
} from '../store';
import { fetchCompareBars } from '../chart/compare-overlay';
import { HooxLoader } from './HooxLoader';
import { TopbarField } from './TopbarField';

/**
 * Compact compare-symbol chrome for the workspace top bar.
 * Hidden for sources that have no per-symbol history (csv-upload).
 */
export const CompareSymbolControl: Component = () => {
  let lastFetched = '';

  const canCompare = () =>
    store.source !== 'csv-upload' && store.bars.length > 0;

  const fetchKey = (sym: string) =>
    `${sym}|${store.interval}|${store.source}|${store.historyBars}`;

  const loadCompare = async (force = false) => {
    if (!store.compare.enabled) return;
    const sym = store.compare.symbol.trim().toUpperCase();
    if (!sym) return;
    if (sym === store.symbol.toUpperCase()) {
      setCompareLoadState({ error: 'Compare symbol must differ from main' });
      return;
    }
    const key = fetchKey(sym);
    if (!force && key === lastFetched && store.compare.bars.length > 0) return;

    setCompareLoadState({ loading: true, error: null });
    try {
      const bars = await fetchCompareBars(sym, store.interval, store.source);
      // Stale guard: user may have toggled off or changed symbol mid-flight
      if (!store.compare.enabled || store.compare.symbol.toUpperCase() !== sym) {
        return;
      }
      setCompareBars(bars);
      lastFetched = key;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCompareLoadState({ loading: false, error: msg });
      clearCompareBars();
    }
  };

  const onToggle = (on: boolean) => {
    setCompareEnabled(on);
    if (on) {
      void loadCompare(true);
    } else {
      lastFetched = '';
    }
  };

  const commitSymbol = (raw: string, load: boolean) => {
    const next = raw.toUpperCase().trim();
    setCompareSymbol(next);
    persist();
    if (load && store.compare.enabled && next) {
      void loadCompare(true);
    }
  };

  return (
    <Show when={canCompare() || store.compare.enabled}>
      <button
        type="button"
        class={`sc-btn sc-btn-ghost ${store.compare.enabled ? 'is-active' : ''}`}
        title="Overlay another symbol for comparison"
        aria-pressed={store.compare.enabled}
        data-testid="axis-compare-enabled"
        onClick={() => onToggle(!store.compare.enabled)}
      >
        Compare
      </button>
      <Show when={store.compare.enabled}>
        <TopbarField
          id="axis-compare-symbol"
          label="vs"
          class="min-w-[6.5em] max-w-[8.5em]"
          mono
          testId="axis-compare-symbol"
          value={store.compare.symbol}
          placeholder="ETHUSDT"
          spellcheck={false}
          autocomplete="off"
          title="Compare symbol · Enter to load"
          onInput={(e) => setCompareSymbol(e.currentTarget.value.toUpperCase())}
          onChange={(e) => commitSymbol(e.currentTarget.value, true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitSymbol(e.currentTarget.value, true);
            }
          }}
          onBlur={(e) => commitSymbol(e.currentTarget.value, true)}
        />
        <TopbarField
          label="Scale"
          variant="select"
          class="min-w-[3.8em]"
          testId="axis-compare-mode"
          value={store.compare.mode}
          title="Compare scale: percent change or absolute price"
          onChange={(e) => {
            const v = e.currentTarget.value === 'absolute' ? 'absolute' : 'percent';
            setCompareMode(v);
          }}
        >
          <option value="percent">%</option>
          <option value="absolute">Abs</option>
        </TopbarField>
        <Show when={store.compare.mode === 'percent'}>
          <button
            type="button"
            class={`sc-btn sc-btn-ghost text-[0.85em] hidden md:inline-flex ${
              store.compare.normalizeMain ? 'is-active' : ''
            }`}
            title="Also plot main symbol as % from the first common bar"
            aria-pressed={store.compare.normalizeMain}
            data-testid="axis-compare-normalize-main"
            onClick={() => setCompareNormalizeMain(!store.compare.normalizeMain)}
          >
            Dual %
          </button>
        </Show>
        <Show when={store.compare.loading}>
          <HooxLoader size="xs" />
        </Show>
        <Show when={store.compare.error}>
          <span
            class="text-[10px] text-red max-w-[10em] truncate"
            title={store.compare.error || ''}
            data-testid="axis-compare-error"
          >
            {store.compare.error}
          </span>
        </Show>
      </Show>
    </Show>
  );
};
