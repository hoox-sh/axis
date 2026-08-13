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
 * Watchlist panel UI — multi-symbol quotes while the panel is open.
 *
 * Wrapped in {@link FloatableShell} (`id: watchlist`). Clicking a row loads
 * that symbol’s chart via `loadSymbolData`. Add/remove symbols update the store.
 *
 * ## Quote lifecycle
 *
 * - **Panel closed** (or empty symbols): no WS, no REST poll (`quoteMode: off`).
 * - **Panel open**: REST seed once, then WS-first via `startWatchlistQuotes`.
 * - **WS open**: stop any REST interval; merge ticks into local `prices`.
 * - **WS reconnecting**: keep last prices; do not start REST spam during backoff.
 * - **WS closed / error** (and not `mode: none`): start REST poll at
 *   `store.watchlist.refreshSec` (min 5s).
 * - **csv / no-WS sources**: one REST seed only; mode `off` after seed.
 *
 * Effect deps: panel open, symbol list, active `store.source`, refresh interval.
 * `onCleanup` always stops the mux and clears REST timers.
 *
 * ## open24h recompute
 *
 * `mergeQuote` keeps the last known 24h open. If a WS frame has last but no
 * change %, change is recomputed as `(price − open24h) / open24h × 100`.
 *
 * Independent of chart kline streams — see `src/data/watchlist-live.ts`.
 */

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
import { startWatchlistQuotes } from '../data/watchlist-live';
import { FloatableShell } from './panels/FloatableShell';

/** Dockable multi-symbol quote list with WS/REST lifecycle (see module docs). */
export const Watchlist: Component = () => {
  const [prices, setPrices] = createSignal<Record<string, WatchTicker>>({});
  const [addValue, setAddValue] = createSignal('');
  /** `ws` live, `rest` polling fallback, `off` idle/closed/no transport. */
  const [quoteMode, setQuoteMode] = createSignal<'ws' | 'rest' | 'off'>('off');

  type QuotePartial = {
    symbol: string;
    price: number;
    change?: number;
    open24h?: number;
    source?: string;
  };

  /**
   * Apply one or more quote partials into row state (open24h retention + 24h %).
   * Used by the rAF-batched path so multi-symbol WS frames share one Solid write.
   */
  const applyQuoteBatch = (partials: readonly QuotePartial[]) => {
    if (!partials.length) return;
    setPrices((prev) => {
      const next = { ...prev };
      const now = Date.now();
      for (const partial of partials) {
        const old = next[partial.symbol];
        const open24h = partial.open24h ?? old?.open24h;
        let change = partial.change;
        if (change == null && open24h && open24h !== 0) {
          change = ((partial.price - open24h) / open24h) * 100;
        }
        if (change == null) change = old?.change ?? 0;
        next[partial.symbol] = {
          price: partial.price,
          change,
          open24h,
          source: partial.source ?? old?.source,
          updatedAt: now,
        };
      }
      return next;
    });
  };

  // Live quotes only while panel is open — WS-first, REST seed + fallback
  createEffect(() => {
    const open = isPanelOpen('watchlist') || store.watchlist.open;
    const symbols = store.watchlist.symbols.slice();
    const source = store.source;
    const fallbackSec = Math.max(5, store.watchlist.refreshSec || 15);
    void symbols.join(',');
    void source;
    void fallbackSec;

    if (!open || !symbols.length) {
      setQuoteMode('off');
      return;
    }

    let stopMux: (() => void) | undefined;
    let restTimer: ReturnType<typeof setInterval> | undefined;
    let wsHealthy = false;
    let cancelled = false;
    /** Pending quotes coalesced to one Solid write per animation frame. */
    const pendingQuotes = new Map<string, QuotePartial>();
    let quoteRaf = 0;

    const flushQuotes = () => {
      quoteRaf = 0;
      if (cancelled || !pendingQuotes.size) {
        pendingQuotes.clear();
        return;
      }
      const batch = Array.from(pendingQuotes.values());
      pendingQuotes.clear();
      applyQuoteBatch(batch);
    };

    const mergeQuote = (partial: QuotePartial) => {
      if (cancelled) return;
      const prev = pendingQuotes.get(partial.symbol);
      pendingQuotes.set(
        partial.symbol,
        prev ? { ...prev, ...partial, symbol: partial.symbol } : partial,
      );
      if (quoteRaf) return;
      if (typeof requestAnimationFrame === 'function') {
        quoteRaf = requestAnimationFrame(flushQuotes);
      } else {
        flushQuotes();
      }
    };

    const clearRest = () => {
      if (restTimer) {
        clearInterval(restTimer);
        restTimer = undefined;
      }
    };

    const seedRest = async () => {
      try {
        const next = await fetchWatchlistTickers(symbols, source);
        if (cancelled) return;
        setPrices((p) => {
          const merged = { ...p };
          for (const [sym, t] of Object.entries(next)) {
            merged[sym] = {
              ...t,
              open24h: t.open24h,
              updatedAt: Date.now(),
            };
          }
          return merged;
        });
      } catch {
        /* keep last */
      }
    };

    const startRestFallback = () => {
      if (restTimer || cancelled) return;
      setQuoteMode('rest');
      restTimer = setInterval(() => void seedRest(), fallbackSec * 1000);
    };

    void seedRest().then(() => {
      if (cancelled) return;
      const handle = startWatchlistQuotes({
        sourceId: source,
        symbols,
        onQuote: (u) => {
          if (cancelled) return;
          mergeQuote(u);
        },
        onStatus: (s) => {
          if (cancelled) return;
          if (s.state === 'open') {
            wsHealthy = true;
            setQuoteMode(s.mode === 'mock' ? 'ws' : 'ws');
            clearRest();
          } else if (s.state === 'reconnecting') {
            // keep last prices; no REST spam during backoff
            setQuoteMode(wsHealthy ? 'ws' : 'rest');
          } else if (s.state === 'closed') {
            if (s.mode === 'none') {
              setQuoteMode('off');
              // csv etc. — one seed already done
              return;
            }
            wsHealthy = false;
            startRestFallback();
          }
        },
        onError: () => {
          if (cancelled) return;
          wsHealthy = false;
          startRestFallback();
        },
      });
      stopMux = handle.stop;
    });

    onCleanup(() => {
      cancelled = true;
      pendingQuotes.clear();
      if (quoteRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(quoteRaf);
      }
      quoteRaf = 0;
      stopMux?.();
      clearRest();
      setQuoteMode('off');
    });
  });

  /** Select symbol as chart focus and load its history for the active source. */
  const select = async (sym: string) => {
    setStore('symbol', sym.toUpperCase());
    persist();
    await loadSymbolData(sym, store.interval, store.source);
  };

  /** Add bare base (BTC) or full pair; bare alphanumerics get USDT suffix. */
  const onAdd = () => {
    let v = addValue().trim().toUpperCase();
    if (!v) return;
    if (!/USDT$|USD$|USDC$/i.test(v) && /^[A-Z0-9]{2,12}$/.test(v)) {
      v = `${v}USDT`;
    }
    addWatchlistSymbol(v);
    setAddValue('');
  };

  const fmtPrice = (n?: number) =>
    n == null
      ? '—'
      : n.toLocaleString(undefined, {
          minimumFractionDigits: n < 1 ? 4 : 2,
          maximumFractionDigits: n < 1 ? 6 : 2,
        });

  const modeLabel = () => {
    const m = quoteMode();
    if (m === 'ws') return 'live';
    if (m === 'rest') return 'rest';
    return '';
  };

  return (
    <Show when={isPanelOpen('watchlist') || store.watchlist.open}>
      <FloatableShell
        id="watchlist"
        testId="axis-watchlist"
        headerExtra={
          <Show when={modeLabel()}>
            <span
              class="text-[0.72em] font-mono text-text-faint px-1 uppercase tracking-wider"
              title={
                quoteMode() === 'ws'
                  ? 'WebSocket live quotes'
                  : 'REST fallback (WebSocket unavailable)'
              }
              data-testid="axis-watchlist-quote-mode"
            >
              {modeLabel()}
            </span>
          </Show>
        }
      >
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
