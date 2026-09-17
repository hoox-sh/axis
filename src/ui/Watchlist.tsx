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
 * - **MEXC / Kraken** (`mode: none` but REST-capable): REST seed + REST poll
 *   at `refreshSec` — no venue ticker mux (MEXC WS is kline-only; Kraken
 *   quotes are never mixed onto Binance).
 * - **csv / gecko / ccxt / unknown** (`mode: none`, no REST): one REST seed
 *   only; mode `off` after seed.
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

import {
  type Component,
  For,
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  store,
  setStore,
  persist,
  addWatchlistSymbol,
  removeWatchlistSymbol,
  isPanelOpen,
  setActiveWatchlist,
  createWatchlist,
  renameWatchlist,
  duplicateWatchlist,
  deleteWatchlist,
} from '../store';
import { loadSymbolData } from '../data/load-symbol';
import { fetchWatchlistTickers, sourceSupportsRestPoll, type WatchTicker } from '../data/watchlist-tickers';
import { startWatchlistQuotes } from '../data/watchlist-live';
import {
  createAlert,
  listAlerts,
  subscribeAlerts,
  type AlertKind,
} from '../alerts';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import { announce } from './sr-announce';

/** Dockable multi-symbol quote list with WS/REST lifecycle (see module docs). */
type PriceAlertKind = Extract<AlertKind, 'price_cross' | 'price_above' | 'price_below'>;

const ALERT_KIND_OPTS: { id: PriceAlertKind; label: string }[] = [
  { id: 'price_cross', label: 'Cross' },
  { id: 'price_above', label: 'Above' },
  { id: 'price_below', label: 'Below' },
];

/** Place the portaled alert pop; flip above the row when it would clip the viewport. */
function placeWatchlistAlertPop(
  anchor: { top: number; right: number; bottom: number },
  pop: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const pad = 8;
  const width = Math.max(1, pop.width);
  const height = Math.max(1, pop.height);
  const left = Math.max(pad, Math.min(anchor.right - width, viewport.width - width - pad));
  const below = anchor.bottom - 2;
  if (below + height <= viewport.height - pad) {
    return { top: Math.max(pad, below), left };
  }
  return { top: Math.max(pad, anchor.top - height + 2), left };
}

export const Watchlist: Component = () => {
  const [prices, setPrices] = createSignal<Record<string, WatchTicker>>({});
  const [addValue, setAddValue] = createSignal('');
  /** `ws` live, `rest` polling fallback, `off` idle/closed/no transport. */
  const [quoteMode, setQuoteMode] = createSignal<'ws' | 'rest' | 'off'>('off');
  const [renameOn, setRenameOn] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal('');
  const [alertSym, setAlertSym] = createSignal<string | null>(null);
  const [alertKind, setAlertKind] = createSignal<PriceAlertKind>('price_cross');
  const [alertPrice, setAlertPrice] = createSignal('');
  const [alertError, setAlertError] = createSignal('');
  const [alertsTick, setAlertsTick] = createSignal(0);
  const [alertPopPos, setAlertPopPos] = createSignal({ top: 0, left: 0 });
  let alertAnchorEl: HTMLElement | undefined;
  let alertPopEl: HTMLDivElement | undefined;

  const lists = createMemo(() => {
    void store.watchlist.activeId;
    const raw = store.watchlist.lists;
    if (Array.isArray(raw) && raw.length) return raw;
    return [
      {
        id: store.watchlist.activeId || 'wl-main',
        name: 'Main',
        symbols: store.watchlist.symbols,
      },
    ];
  });
  const activeList = createMemo(() => {
    const id = store.watchlist.activeId;
    return lists().find((l) => l.id === id) ?? lists()[0];
  });
  const alertedSymbols = createMemo(() => {
    void alertsTick();
    const set = new Set<string>();
    for (const a of listAlerts()) {
      if (a.enabled) set.add(a.symbol.toUpperCase());
    }
    return set;
  });

  onMount(() => {
    const unsub = subscribeAlerts(() => setAlertsTick((n) => n + 1));
    onCleanup(unsub);
  });

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
              // csv / gecko / ccxt / unknown — one seed already done, nothing to poll.
              // MEXC / Kraken have REST tickers but no WS mux, so keep REST-polling.
              // (data-manager resolves to its underlying venue inside the helper.)
              if (sourceSupportsRestPoll(source)) {
                startRestFallback();
              } else {
                setQuoteMode('off');
              }
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

  const beginRename = () => {
    setRenameValue(activeList()?.name || '');
    setRenameOn(true);
  };

  const commitRename = () => {
    if (!renameOn()) return;
    const id = activeList()?.id;
    if (id) renameWatchlist(id, renameValue());
    setRenameOn(false);
  };

  const cancelRename = () => {
    setRenameValue(activeList()?.name || '');
    setRenameOn(false);
  };

  const onNewList = () => {
    createWatchlist();
    beginRename();
  };

  const placeAlertPop = () => {
    const anchor = alertAnchorEl;
    if (!anchor?.isConnected || typeof window === 'undefined') return;
    const r = anchor.getBoundingClientRect();
    const pop = alertPopEl;
    setAlertPopPos(
      placeWatchlistAlertPop(
        r,
        { width: pop?.offsetWidth || 200, height: pop?.offsetHeight || 160 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  const emitWatchlistAlert = (open: boolean) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('axis-watchlist-alert', { detail: { open } }));
  };

  const closeAlert = () => {
    if (!alertSym()) {
      alertAnchorEl = undefined;
      return;
    }
    setAlertSym(null);
    alertAnchorEl = undefined;
    emitWatchlistAlert(false);
  };

  const openAlert = (sym: string, anchor?: HTMLElement) => {
    const last = prices()[sym]?.price;
    alertAnchorEl = anchor?.closest('.axis-wl-row') ?? anchor;
    placeAlertPop();
    const wasOpen = !!alertSym();
    setAlertKind('price_cross');
    setAlertPrice(last != null && Number.isFinite(last) ? String(last) : '');
    setAlertError('');
    setAlertSym(sym);
    if (!wasOpen) emitWatchlistAlert(true);
  };

  createEffect(() => {
    const open = isPanelOpen('watchlist') || store.watchlist.open;
    if (!open) closeAlert();
  });

  createEffect(() => {
    const sym = alertSym();
    if (!sym) return;
    if (!store.watchlist.symbols.includes(sym)) closeAlert();
  });

  createEffect(() => {
    if (!alertSym()) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (alertPopEl?.contains(t) || alertAnchorEl?.contains(t)) return;
      closeAlert();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAlert();
    };
    const onReposition = () => placeAlertPop();
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    });
  });

  const commitAlert = () => {
    const sym = alertSym();
    if (!sym) return;
    const n = Number(alertPrice());
    if (!Number.isFinite(n) || n <= 0) {
      setAlertError('Enter a price greater than 0');
      return;
    }
    const kind = alertKind();
    const verb = kind === 'price_cross' ? 'crosses' : kind === 'price_above' ? 'above' : 'below';
    createAlert({
      name: `${sym} ${verb} ${n}`,
      symbol: sym,
      kind,
      params: { price: n },
    });
    announce(`Alert created for ${sym}`);
    closeAlert();
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
    'grid grid-cols-[minmax(4.25rem,1fr)_auto_auto_auto_1.75rem] items-center gap-x-1.5 px-2';

  return (
    <Show when={isPanelOpen('watchlist') || store.watchlist.open}>
      <FloatableShell
        id="watchlist"
        testId="axis-watchlist"
        menuExtra={
          <>
            <div class="axis-panel-menu-section">Watchlists</div>
            <button
              type="button"
              role="menuitem"
              class="axis-panel-menu-item"
              data-testid="axis-watchlist-menu-new"
              onClick={() => onNewList()}
            >
              <Icons.plus size={14} />
              <span>New watchlist</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="axis-panel-menu-item"
              data-testid="axis-watchlist-menu-rename"
              onClick={() => beginRename()}
            >
              <Icons.pencil size={14} />
              <span>Rename</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="axis-panel-menu-item"
              data-testid="axis-watchlist-menu-duplicate"
              onClick={() => duplicateWatchlist()}
            >
              <Icons.copy size={14} />
              <span>Duplicate</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="axis-panel-menu-item"
              data-testid="axis-watchlist-menu-delete"
              disabled={lists().length <= 1}
              onClick={() => {
                const id = activeList()?.id;
                if (id) deleteWatchlist(id);
              }}
            >
              <Icons.trash size={14} />
              <span>Delete list</span>
            </button>
          </>
        }
      >
        <div class="axis-wl-toolbar flex items-center gap-1 px-2 py-1 border-b border-border flex-shrink-0">
          <Show
            when={!renameOn()}
            fallback={
              <input
                class="axis-wl-list-rename sc-input h-6 min-h-6 text-[11px] flex-1 min-w-0"
                value={renameValue()}
                autofocus
                data-testid="axis-watchlist-rename"
                onInput={(e) => setRenameValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                onBlur={() => {
                  if (!renameOn()) return;
                  commitRename();
                }}
              />
            }
          >
            <select
              class="axis-wl-list-select flex-1 min-w-0"
              title="Switch watchlist"
              aria-label="Watchlist"
              data-testid="axis-watchlist-list"
              onChange={(e) => setActiveWatchlist(e.currentTarget.value)}
            >
              <For each={lists()}>
                {(l) => (
                  <option
                    value={l.id}
                    selected={l.id === (store.watchlist.activeId || activeList()?.id)}
                  >
                    {l.name}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1"
            title="New watchlist"
            aria-label="New watchlist"
            data-testid="axis-watchlist-new"
            onClick={() => onNewList()}
          >
            <Icons.plus size={12} />
          </button>
          <Show when={modeLabel()}>
            <span
              class="inline-flex items-center gap-1 px-0.5 ml-auto"
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
        </div>
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
              <span class="text-right min-w-[4.5rem]">Last</span>
              <span class="text-right min-w-[3.35rem]">Chg</span>
              <span class="text-right min-w-[4.5rem]">Close</span>
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
                const hasAlert = () => alertedSymbols().has(sym.toUpperCase());
                return (
                  // biome-ignore lint/a11y/useSemanticElements: row contains nested buttons; wrapping in <button> would be invalid HTML
                  <div
                    class={`axis-wl-row group ${cols} h-8 cursor-pointer text-[12px] border-b border-border relative ${
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
                    <span class="font-mono text-[11px] text-text text-right tabular-nums lining-nums min-w-[4.5rem]">
                      {fmtPrice(tick()?.price)}
                    </span>
                    <span
                      class={`font-mono text-[11px] text-right tabular-nums lining-nums min-w-[3.35rem] ${
                        ch() == null
                          ? 'text-text-faint'
                          : (ch() ?? 0) >= 0
                            ? 'axis-wl-change-up'
                            : 'axis-wl-change-down'
                      }`}
                    >
                      {fmtChange(ch())}
                    </span>
                    <span class="font-mono text-[11px] text-text-dim text-right tabular-nums lining-nums min-w-[4.5rem]">
                      {fmtPrice(closeOf(tick()))}
                    </span>
                    <span class="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        class={`w-4 h-4 flex items-center justify-center text-text-faint hover:text-accent focus-visible:opacity-100 ${
                          hasAlert()
                            ? 'text-accent opacity-100'
                            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                        }`}
                        title={hasAlert() ? `Alerts on ${sym}` : `Add alert for ${sym}`}
                        aria-label={`Add alert for ${sym}`}
                        data-testid={`axis-watchlist-alert-${sym}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openAlert(sym, e.currentTarget);
                        }}
                      >
                        <Icons.alerts size={11} />
                      </button>
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
                    </span>
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
      <Show when={alertSym()}>
        {(sym) => (
          <Portal>
            <div
              ref={(el) => {
                alertPopEl = el;
                if (el) placeAlertPop();
              }}
              class="axis-wl-alert-pop"
              role="dialog"
              aria-label={`Alert ${sym()}`}
              data-testid="axis-watchlist-alert-pop"
              style={{
                top: `${alertPopPos().top}px`,
                left: `${alertPopPos().left}px`,
              }}
            >
              <div class="flex items-center justify-between gap-2 mb-1.5">
                <span class="text-[10px] uppercase tracking-wider text-text-faint">
                  Alert {sym()}
                </span>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost px-1"
                  aria-label="Close"
                  onClick={() => closeAlert()}
                >
                  <Icons.x size={12} />
                </button>
              </div>
              <div class="flex items-center gap-1 mb-1.5">
                <For each={ALERT_KIND_OPTS}>
                  {(opt) => (
                    <button
                      type="button"
                      class={`sc-btn sc-btn-ghost text-[10px] px-1.5 h-6 min-h-6 ${
                        alertKind() === opt.id ? 'is-active' : ''
                      }`}
                      aria-pressed={alertKind() === opt.id}
                      onClick={() => setAlertKind(opt.id)}
                    >
                      {opt.label}
                    </button>
                  )}
                </For>
              </div>
              <input
                class="sc-input w-full h-7 min-h-7 text-[11px] font-mono mb-1.5"
                inputMode="decimal"
                placeholder="Price"
                value={alertPrice()}
                data-testid="axis-watchlist-alert-price"
                onInput={(e) => setAlertPrice(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitAlert();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeAlert();
                  }
                }}
              />
              <Show when={alertError()}>
                <div class="text-[10px] text-red mb-1">{alertError()}</div>
              </Show>
              <button
                type="button"
                class="sc-btn sc-btn-primary w-full h-7 min-h-7 text-[11px]"
                data-testid="axis-watchlist-alert-create"
                onClick={() => commitAlert()}
              >
                Create alert
              </button>
            </div>
          </Portal>
        )}
      </Show>
    </Show>
  );
};
