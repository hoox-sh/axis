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

import { type Component, For, createSignal, createEffect, onCleanup, Show } from 'solid-js';
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

  /** Always-signed 2-decimal % so +0.48% and −0.13% share a fixed tabular slot. */
  const fmtChange = (n?: number) => {
    if (n == null || !Number.isFinite(n)) return '—';
    const sign = n >= 0 ? '+' : '−';
    return `${sign}${Math.abs(n).toFixed(2)}%`;
  };

  /** 24h open when known; else previous from last × %; else em-dash. */
  const closeOf = (tick?: WatchTicker): number | undefined => {
    if (!tick) return undefined;
    if (tick.open24h != null && Number.isFinite(tick.open24h)) return tick.open24h;
    const px = tick.price;
    const ch = tick.change;
    if (px == null || ch == null || !Number.isFinite(px) || !Number.isFinite(ch)) return undefined;
    if (ch === -100) return undefined;
    const prev = px / (1 + ch / 100);
    return Number.isFinite(prev) ? prev : undefined;
  };

  const modeLabel = () => {
    const m = quoteMode();
    if (m === 'ws') return 'live';
    if (m === 'rest') return 'rest';
    return '';
  };

  const cols =
    'grid grid-cols-[minmax(4.75rem,1fr)_max-content_max-content_max-content_1rem] items-center gap-x-2 px-2';

  return (
    <Show when={isPanelOpen('watchlist') || store.watchlist.open}>
      <FloatableShell
        id="watchlist"
        testId="axis-watchlist"
        headerExtra={
          <Show when={modeLabel()}>
            <span
              class="inline-flex items-center gap-1 px-0.5"
              title={
                quoteMode() === 'ws'
                  ? 'WebSocket live quotes'
                  : 'REST fallback (WebSocket unavailable)'
              }
              data-testid="axis-watchlist-quote-mode"
            >
              <span
                class={`axis-live-dot inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                  quoteMode() === 'ws'
                    ? 'axis-live-dot--pulse bg-accent-2'
                    : quoteMode() === 'rest'
                      ? 'bg-text-faint'
                      : 'hidden'
                }`}
                aria-hidden="true"
              />
              <span class="text-[10px] font-mono text-text-faint uppercase tracking-wider leading-none">
                {modeLabel()}
              </span>
            </span>
          </Show>
        }
      >
        <div class="flex-1 overflow-y-auto min-h-0">
          <Show
            when={store.watchlist.symbols.length > 0}
            fallback={
              <div class="axis-empty-state px-2 py-3 text-[11px] text-text-faint">No symbols</div>
            }
          >
            <div
              class={`${cols} h-5 text-[10px] uppercase tracking-wider text-text-faint select-none`}
              aria-hidden="true"
            >
              <span>Sym</span>
              <span class="text-right">Last</span>
              <span class="text-right">Chg</span>
              <span class="text-right">Close</span>
              <span />
            </div>
            <For each={store.watchlist.symbols}>
              {(sym) => {
                const tick = () => prices()[sym];
                const active = () => store.symbol === sym;
                const ch = () => {
                  const n = tick()?.change;
                  return n != null && Number.isFinite(n) ? n : undefined;
                };
                return (
                  // biome-ignore lint/a11y/useSemanticElements: row contains a nested remove <button>; wrapping in <button> would be invalid HTML
                  <div
                    class={`axis-wl-row group ${cols} h-8 cursor-pointer text-[12px] border-b border-border ${
                      active() ? 'is-active' : 'hover:bg-white/[0.03]'
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => void select(sym)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void select(sym);
                      }
                    }}
                  >
                    <span
                      class={`font-semibold truncate ${active() ? 'text-accent' : 'text-text'}`}
                    >
                      {sym.replace(/USDT$/i, '').replace(/USD$/i, '')}
                      <span class="text-text-faint font-normal text-[10px]">
                        {/USDT$/i.test(sym) ? 'USDT' : /USD$/i.test(sym) ? 'USD' : ''}
                      </span>
                    </span>
                    <span class="font-mono text-[11px] text-text text-right tabular-nums lining-nums">
                      {fmtPrice(tick()?.price)}
                    </span>
                    <span
                      class={`font-mono text-[11px] text-right tabular-nums lining-nums ${
                        ch() == null
                          ? 'text-text-faint'
                          : (ch() ?? 0) >= 0
                            ? 'axis-wl-change-up'
                            : 'axis-wl-change-down'
                      }`}
                    >
                      {fmtChange(ch())}
                    </span>
                    <span class="font-mono text-[11px] text-text-dim text-right tabular-nums lining-nums">
                      {fmtPrice(closeOf(tick()))}
                    </span>
                    <button
                      type="button"
                      class="w-4 h-4 flex items-center justify-center text-[11px] leading-none text-text-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red focus-visible:opacity-100"
                      title={`Remove ${sym}`}
                      aria-label={`Remove ${sym}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeWatchlistSymbol(sym);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>

        <div class="border-t border-border px-2 py-1.5 flex-shrink-0">
          <input
            class="sc-input w-full h-7 min-h-7 text-[11px] placeholder:text-text-faint bg-transparent"
            placeholder="Add symbol…"
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
