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

import { Component, For, createSignal, createEffect, onCleanup, Show } from 'solid-js';
import {
  store,
  setStore,
  persist,
  addWatchlistSymbol,
  removeWatchlistSymbol,
  isPanelOpen,
} from '../store';
import { loadSymbolData } from '../data/load-symbol';
import { fetchWatchlistTickers, type WatchTicker } from '../data/watchlist-tickers';
import { FloatableShell } from './panels/FloatableShell';

export const Watchlist: Component = () => {
  const [prices, setPrices] = createSignal<Record<string, WatchTicker>>({});
  const [addValue, setAddValue] = createSignal('');
  let timer: ReturnType<typeof setInterval> | undefined;

  const fetchPrices = async () => {
    const symbols = store.watchlist.symbols;
    if (!symbols.length) return;
    try {
      const next = await fetchWatchlistTickers(symbols, store.source);
      setPrices(next);
    } catch {
      /* keep last good quotes */
    }
  };

  // Re-poll when symbols, source, or refresh interval change (interval from Settings)
  createEffect(() => {
    const _syms = store.watchlist.symbols.join(',');
    const _src = store.source;
    const sec = store.watchlist.refreshSec || 15;
    void _syms;
    void _src;

    if (timer) clearInterval(timer);
    void fetchPrices();
    timer = setInterval(() => void fetchPrices(), Math.max(5, sec) * 1000);

    onCleanup(() => {
      if (timer) clearInterval(timer);
    });
  });

  const select = async (sym: string) => {
    setStore('symbol', sym.toUpperCase());
    persist();
    await loadSymbolData(sym, store.interval, store.source);
  };

  const onAdd = () => {
    let v = addValue().trim().toUpperCase();
    if (!v) return;
    if (!/USDT$|USD$|USDC$/i.test(v) && /^[A-Z0-9]{2,12}$/.test(v)) {
      v = `${v}USDT`;
    }
    addWatchlistSymbol(v);
    setAddValue('');
    void fetchPrices();
  };

  const fmtPrice = (n?: number) =>
    n == null
      ? '—'
      : n.toLocaleString(undefined, {
          minimumFractionDigits: n < 1 ? 4 : 2,
          maximumFractionDigits: n < 1 ? 6 : 2,
        });

  return (
    <Show when={isPanelOpen('watchlist') || store.watchlist.open}>
      <FloatableShell id="watchlist" testId="axis-watchlist">
        <div class="flex-1 overflow-y-auto min-h-0">
          <For each={store.watchlist.symbols}>
            {(sym) => {
              const tick = () => prices()[sym];
              const active = () => store.symbol === sym;
              const change = () => tick()?.change;
              return (
                <div
                  class={`flex items-center justify-between gap-1 px-2 py-1.5 cursor-pointer border-b border-border-soft text-[12px] ${
                    active()
                      ? 'bg-accent/10 border-l-2 border-l-accent pl-[6px]'
                      : 'border-l-2 border-l-transparent hover:bg-bg-hover'
                  }`}
                  onClick={() => void select(sym)}
                >
                  <span class={`font-semibold truncate ${active() ? 'text-accent' : 'text-text'}`}>
                    {sym.replace(/USDT$/i, '').replace(/USD$/i, '')}
                    <span class="text-text-faint font-normal text-[10px]">
                      {/USDT$/i.test(sym) ? 'USDT' : /USD$/i.test(sym) ? 'USD' : ''}
                    </span>
                  </span>
                  <div class="flex items-center gap-1.5 flex-shrink-0">
                    <span class="font-mono text-[11px] text-text-dim">{fmtPrice(tick()?.price)}</span>
                    <Show when={change() != null}>
                      <span
                        class={`font-mono text-[10px] px-1 ${
                          (change() ?? 0) >= 0 ? 'text-accent-2' : 'text-red'
                        }`}
                      >
                        {(change()! >= 0 ? '+' : '') + change()!.toFixed(2)}%
                      </span>
                    </Show>
                    <button
                      class="text-text-faint hover:text-red text-sm leading-none px-0.5"
                      title={`Remove ${sym}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeWatchlistSymbol(sym);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        <div class="border-t-2 border-border p-2 flex-shrink-0">
          <input
            class="sc-input w-full text-[11px]"
            placeholder="Add symbol… (BTC or BTCUSDT)"
            value={addValue()}
            onInput={(e) => setAddValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAdd();
            }}
          />
        </div>
      </FloatableShell>
    </Show>
  );
};
