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
 * ## Reference price (Prev column)
 *
 * The Prev column is the **previous daily close** (UTC), fetched once per
 * symbol per day from daily klines (`data/watchlist-daily.ts`) — a rolling
 * `open24h` moves on every tick and is only the fallback for venues without
 * daily klines. When the daily close is known, `Chg` is the change against it
 * so the row stays internally consistent.
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
import { effectEnabled, effectMs, prefersReducedMotion, setEffectEnabled } from './effects';
import { noteSparkPrice, seedSpark, sparkPath } from './watchlist-spark';
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
  createWatchlistFolder,
  renameWatchlistFolder,
  deleteWatchlistFolder,
  moveWatchlistToFolder,
  moveWatchlist,
  moveWatchlistFolder,
  setWatchlistFolderCollapsed,
  moveWatchlistSymbol,
  moveWatchlistSymbolToList,
  sortWatchlistSymbols,
  clearWatchlistSymbols,
} from '../store';
import type { WatchlistList } from '../store/types';
import { loadSymbolData } from '../data/load-symbol';
import { SymbolModal } from './SymbolModal';
import { copyToClipboard } from './clipboard';
import {
  fetchWatchlistTickers,
  sourceSupportsRestPoll,
  type WatchTicker,
} from '../data/watchlist-tickers';
import { dailyCloseDayKey, dailyCloseSourceKey, fetchDailyCloses } from '../data/watchlist-daily';
import { startWatchlistQuotes } from '../data/watchlist-live';
import { createAlert, listAlerts, subscribeAlerts, type AlertKind } from '../alerts';
import { Icons } from './icons';
import { dismissOnOutside } from './dismiss-on-outside';
import { bigPriceSizeClass, formatCompactVolume, rangePercent } from './watchlist-row';
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

function fmtPrice(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n < 1 ? 4 : 2,
    maximumFractionDigits: n < 1 ? 6 : 2,
  });
}

/** Always-signed 2-decimal % so +0.48% and −0.13% share a fixed tabular slot. */
function fmtChange(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '\u00a0';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function sameSpark(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Alert-level text with a sensible precision for the price magnitude
 * (`187.07`, `1.2345`, `0.000123`) — full float noise (`187.06648788281606`)
 * is unreadable in a 7-char input.
 */
function alertPriceText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const decimals = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  const fixed = n.toFixed(decimals);
  // Trim trailing zeros but keep at least one decimal when it was added.
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** 24h open when known; else previous from last × %; else undefined. */
function closeOf(tick?: WatchTicker): number | undefined {
  if (!tick) return undefined;
  if (tick.open24h != null && Number.isFinite(tick.open24h)) return tick.open24h;
  const px = tick.price;
  const ch = tick.change;
  if (px == null || ch == null || !Number.isFinite(px) || !Number.isFinite(ch)) return undefined;
  if (ch === -100) return undefined;
  const prev = px / (1 + ch / 100);
  return Number.isFinite(prev) ? prev : undefined;
}

const WatchlistRow: Component<{
  sym: string;
  tick?: WatchTicker;
  /** Previous **daily** close (UTC) when known — stable for the whole day. */
  prevClose?: number;
  active: boolean;
  alerted: boolean;
  expanded: boolean;
  /** Inline symbol actions strip is open for this row. */
  moreOpen?: boolean;
  cols: string;
  onSelect: (sym: string) => void;
  onAlert: (sym: string, el: HTMLElement) => void;
  onExpand: (sym: string) => void;
  onMore: (sym: string) => void;
}> = (props) => {
  const [flash, setFlash] = createSignal<'up' | 'down' | ''>('');
  const [spark, setSpark] = createSignal<number[]>([]);
  let lastPrice: number | undefined;
  createEffect(() => {
    const p = props.tick?.price;
    const ms = effectMs('watchlist.tick');
    if (p == null || !Number.isFinite(p)) return;
    seedSpark(props.sym, prevPrice(), p);
    const next = noteSparkPrice(props.sym, p);
    setSpark((prev) => (sameSpark(prev, next) ? prev : next));
    if (lastPrice != null && p !== lastPrice && ms > 0) {
      setFlash(p > lastPrice ? 'up' : 'down');
      const id = window.setTimeout(() => setFlash(''), ms);
      onCleanup(() => {
        window.clearTimeout(id);
        setFlash('');
      });
    }
    lastPrice = p;
  });
  /** Reference price: previous daily close when known, else the 24h open. */
  const prevPrice = () => {
    const d = props.prevClose;
    if (d != null && Number.isFinite(d) && d > 0) return d;
    return closeOf(props.tick);
  };
  /**
   * Change vs the reference price. When a daily close is known the % is the
   * daily change (matching the Prev column); otherwise the venue's 24h %.
   */
  const ch = () => {
    const prev = prevPrice();
    const px = props.tick?.price;
    if (prev != null && prev > 0 && px != null && Number.isFinite(px)) {
      return ((px - prev) / prev) * 100;
    }
    const n = props.tick?.change;
    return n != null && Number.isFinite(n) ? n : undefined;
  };
  const chClass = () =>
    ch() == null
      ? 'text-text-faint'
      : (ch() ?? 0) >= 0
        ? 'axis-wl-change-up'
        : 'axis-wl-change-down';

  /** Icon cluster shared by the compact overlay and the expanded header. */
  const iconBtns = (alwaysShow: boolean) => {
    const reveal = alwaysShow
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';
    return (
      <span class="flex items-center justify-end gap-1">
        <button
          type="button"
          class={`w-[18px] h-[18px] flex items-center justify-center rounded-[var(--radius-chip)] text-text-faint hover:text-accent hover:bg-bg focus-visible:opacity-100 ${
            props.alerted ? 'text-accent opacity-100' : reveal
          }`}
          title={props.alerted ? `Alerts on ${props.sym}` : `Add alert for ${props.sym}`}
          aria-label={`Add alert for ${props.sym}`}
          data-testid={`axis-watchlist-alert-${props.sym}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onAlert(props.sym, e.currentTarget);
          }}
        >
          <Icons.alerts size={11} />
        </button>
        <button
          type="button"
          class={`w-[18px] h-[18px] flex items-center justify-center rounded-[var(--radius-chip)] text-[12px] leading-none font-bold focus-visible:opacity-100 ${
            props.expanded
              ? 'text-accent bg-accent/10 opacity-100'
              : `text-text-faint hover:text-accent hover:bg-bg ${reveal}`
          }`}
          title={
            props.expanded ? `Compact view for ${props.sym}` : `Big price view for ${props.sym}`
          }
          aria-label={`Big price view for ${props.sym}`}
          aria-pressed={props.expanded}
          data-testid={`axis-watchlist-expand-${props.sym}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onExpand(props.sym);
          }}
        >
          !
        </button>
        <button
          type="button"
          class={`w-[18px] h-[18px] flex items-center justify-center rounded-[var(--radius-chip)] focus-visible:opacity-100 ${
            props.moreOpen
              ? 'text-accent bg-accent/10 opacity-100'
              : `text-text-faint hover:text-accent hover:bg-bg ${reveal}`
          }`}
          title={`Actions for ${props.sym}`}
          aria-label={`Actions for ${props.sym}`}
          aria-expanded={!!props.moreOpen}
          data-testid={`axis-watchlist-more-${props.sym}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onMore(props.sym);
          }}
        >
          <Icons.menu size={11} />
        </button>
      </span>
    );
  };

  const priceText = () => fmtPrice(props.tick?.price);

  /** Day range bar (24h low/high) — hidden when the ticker lacks the stats. */
  const rangeBar = () => {
    const low = props.tick?.low24h;
    const high = props.tick?.high24h;
    const pct = rangePercent(props.tick?.price, low, high);
    if (pct == null || low == null || high == null) return null;
    return { low, high, pct };
  };

  const volumeText = () => {
    const base = formatCompactVolume(props.tick?.volume24h);
    const quote = formatCompactVolume(props.tick?.quoteVolume24h);
    if (base && quote) return `${base} · ${quote}`;
    return base ?? quote;
  };

  const sparkSvg = (width: number, height: number) => {
    const d = sparkPath(spark(), width, height);
    if (!d) return null;
    const change = ch();
    return (
      <svg
        class="axis-wl-spark"
        classList={{
          'is-up': change != null && change >= 0,
          'is-down': change != null && change < 0,
        }}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden="true"
        data-testid={`axis-watchlist-spark-${props.sym}`}
      >
        <path d={d} />
      </svg>
    );
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: row contains nested buttons; wrapping in <button> would be invalid HTML
    <div
      class={`axis-wl-row group ${props.cols} cursor-pointer text-[12px] border-b border-border relative`}
      classList={{
        'is-active': props.active,
        'is-expanded': props.expanded,
        'is-flash-up': flash() === 'up',
        'is-flash-down': flash() === 'down',
      }}
      role="button"
      tabIndex={0}
      onClick={() => props.onSelect(props.sym)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect(props.sym);
        }
      }}
    >
      <Show
        when={props.expanded}
        fallback={
          <>
            <span class="axis-wl-sym">
              <span class={`font-semibold truncate ${props.active ? 'text-accent' : 'text-text'}`}>
                {props.sym.replace(/USDT$/i, '').replace(/USD$/i, '')}
                <span class="text-text-faint font-normal text-[10px]">
                  {/USDT$/i.test(props.sym) ? 'USDT' : /USD$/i.test(props.sym) ? 'USD' : ''}
                </span>
              </span>
              {sparkSvg(48, 10)}
            </span>
            <span class="font-mono text-[12px] font-medium text-text text-right tabular-nums lining-nums min-w-[4.5rem]">
              {priceText()}
            </span>
            <span
              class={`font-mono text-[11px] text-right tabular-nums lining-nums min-w-[4.25rem] ${chClass()}`}
            >
              {fmtChange(ch())}
            </span>
            <span
              class="font-mono text-[10px] text-text-faint text-right tabular-nums lining-nums min-w-[3.9rem]"
              title={
                props.prevClose != null
                  ? 'Previous daily close (UTC 00:00)'
                  : 'Previous close (24h open — daily close unavailable)'
              }
            >
              {fmtPrice(prevPrice())}
            </span>
            {/* Action cluster overlays the row edge on hover/focus: it must not
                steal width from the quote columns in a 260px panel. */}
            <span class="axis-wl-actions" data-testid={`axis-watchlist-actions-${props.sym}`}>
              {iconBtns(false)}
            </span>
          </>
        }
      >
        <div class="axis-wl-expanded">
          <div class="axis-wl-expanded-top">
            <span
              class={`axis-wl-big-price ${bigPriceSizeClass(priceText())}`}
              title={`Last price ${priceText()}`}
            >
              {priceText()}
            </span>
            {iconBtns(true)}
          </div>
          <div class="axis-wl-expanded-sub">
            <span class={`font-semibold ${props.active ? 'text-accent' : 'text-text'}`}>
              {props.sym.replace(/USDT$/i, '').replace(/USD$/i, '')}
              <span class="text-text-faint font-normal">
                {/USDT$/i.test(props.sym) ? 'USDT' : /USD$/i.test(props.sym) ? 'USD' : ''}
              </span>
            </span>
            <span class={`font-mono tabular-nums lining-nums ${chClass()}`}>{fmtChange(ch())}</span>
            <span
              class="font-mono text-text-faint tabular-nums lining-nums"
              title={
                props.prevClose != null
                  ? 'Previous daily close (UTC 00:00)'
                  : 'Previous close (24h open — daily close unavailable)'
              }
            >
              Prev {fmtPrice(prevPrice())}
            </span>
            {sparkSvg(72, 16)}
          </div>
          {/* Day range: where the last price sits between the 24h low/high. */}
          <Show when={rangeBar()}>
            {(bar) => (
              <div class="axis-wl-expanded-range" data-testid={`axis-watchlist-range-${props.sym}`}>
                <span class="axis-wl-range-label" title="24h low">
                  {fmtPrice(bar().low)}
                </span>
                <span
                  class="axis-wl-range-track"
                  role="img"
                  aria-label={`24h range ${fmtPrice(bar().low)} to ${fmtPrice(bar().high)}`}
                >
                  <span class="axis-wl-range-fill" style={{ width: `${bar().pct}%` }} />
                  <span class="axis-wl-range-dot" style={{ left: `${bar().pct}%` }} />
                </span>
                <span class="axis-wl-range-label" title="24h high">
                  {fmtPrice(bar().high)}
                </span>
              </div>
            )}
          </Show>
          <Show when={volumeText()}>
            <div class="axis-wl-expanded-volume" data-testid={`axis-watchlist-volume-${props.sym}`}>
              <span class="text-text-faint">24h vol</span>
              <span class="font-mono tabular-nums lining-nums text-text-dim">{volumeText()}</span>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

/**
 * Watchlist dock panel: add/remove symbols, live quotes with sparkline, and the
 * expanded day-range row. Owns its own ticker subscription and keeps the
 * persisted symbol list in the store.
 */
export const Watchlist: Component = (): JSX.Element => {
  const [prices, setPrices] = createSignal<Record<string, WatchTicker>>({});
  const [addValue, setAddValue] = createSignal('');
  const [browseOpen, setBrowseOpen] = createSignal(false);
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
  /** Symbols pinned to the big-price row layout (session-local). */
  const [expandedSyms, setExpandedSyms] = createSignal<Set<string>>(new Set());
  /** Watchlist manager drawer (folders + list actions). */
  const [managerOpen, setManagerOpen] = createSignal(false);
  /** Inline action strip for one manager row: `folder:<id>` / `list:<id>`. */
  const [managerMenu, setManagerMenu] = createSignal('');
  /** Inline rename in the manager (folder or list). */
  const [renameTarget, setRenameTarget] = createSignal<{
    kind: 'list' | 'folder';
    id: string;
  } | null>(null);
  const [renameDraft, setRenameDraft] = createSignal('');
  /** Symbol whose action strip is open. */
  const [symbolActions, setSymbolActions] = createSignal<string | null>(null);
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
  const folders = createMemo(() => store.watchlist.folders ?? []);
  const listsInFolder = (folderId: string) =>
    lists().filter((l) => (l.folderId ?? null) === folderId);
  const rootLists = createMemo(() => lists().filter((l) => !l.folderId));
  const folderName = (id?: string | null) =>
    id ? (folders().find((f) => f.id === id)?.name ?? '') : '';
  const alertedSymbols = createMemo(() => {
    void alertsTick();
    const set = new Set<string>();
    for (const a of listAlerts()) {
      if (a.enabled) set.add(a.symbol.toUpperCase());
    }
    return set;
  });

  /**
   * Previous **daily** close per symbol (UTC day boundary).
   *
   * Exchange 24h opens roll with every tick, so a “Prev” column built from
   * them changes continuously. A daily close is fixed for the whole day — the
   * reference price a watchlist should show. Fetched once per symbol per UTC
   * day, refreshed when the day rolls over or the panel regains focus.
   */
  const [dailyCloses, setDailyCloses] = createSignal<Record<string, number>>({});
  const [dailyDay, setDailyDay] = createSignal(dailyCloseDayKey());
  const [dailySource, setDailySource] = createSignal(dailyCloseSourceKey(store.source));

  onMount(() => {
    let disposed = false;
    const load = async () => {
      const day = dailyCloseDayKey();
      const source = dailyCloseSourceKey(store.source);
      if (day !== dailyDay() || source !== dailySource()) {
        setDailyDay(day);
        setDailySource(source);
        setDailyCloses({});
      }
      const syms = store.watchlist.symbols;
      if (!syms.length) return;
      const closes = await fetchDailyCloses(syms, store.source, Date.now());
      if (!disposed && Object.keys(closes).length) {
        setDailyCloses((prev) => ({ ...prev, ...closes }));
      }
    };
    void load();
    // Day rollover, source switch, or late symbol additions. Cheap: two compares.
    const iv = window.setInterval(() => {
      const day = dailyCloseDayKey();
      const source = dailyCloseSourceKey(store.source);
      const missing = store.watchlist.symbols.some((s) => dailyCloses()[s] == null);
      if (day !== dailyDay() || source !== dailySource() || missing) void load();
    }, 60_000);
    const onFocus = () => {
      if (dailyCloseDayKey() !== dailyDay()) void load();
    };
    window.addEventListener('focus', onFocus);
    onCleanup(() => {
      disposed = true;
      clearInterval(iv);
      window.removeEventListener('focus', onFocus);
    });
  });

  /** Daily close for a row, when the venue ships daily klines. */
  const prevCloseFor = (sym: string): number | undefined => {
    const v = dailyCloses()[sym];
    return v != null && Number.isFinite(v) && v > 0 ? v : undefined;
  };

  /** Last price of the symbol the alert pop is open for (context + quick fills). */
  const alertLastPrice = (): number | undefined => {
    const sym = alertSym();
    if (!sym) return undefined;
    const px = prices()[sym]?.price;
    return px != null && Number.isFinite(px) && px > 0 ? px : undefined;
  };

  /** One-tap levels around the last price: last, ±1 %. */
  const alertQuickFills = createMemo(() => {
    const last = alertLastPrice();
    if (last == null) return [];
    return [
      {
        id: 'last',
        label: 'Last',
        value: alertPriceText(last),
        title: `Last price ${fmtPrice(last)}`,
      },
      {
        id: 'up1',
        label: '+1%',
        value: alertPriceText(last * 1.01),
        title: `1% above the last price (${fmtPrice(last * 1.01)})`,
      },
      {
        id: 'down1',
        label: '−1%',
        value: alertPriceText(last * 0.99),
        title: `1% below the last price (${fmtPrice(last * 0.99)})`,
      },
    ];
  });

  const alertValid = (): boolean => {
    const n = Number(alertPrice());
    return Number.isFinite(n) && n > 0;
  };

  /**
   * Non-blocking warning: an alert that is already satisfied fires on the next
   * tick (still valid — the user may want exactly that).
   */
  const alertHint = (): string => {
    const last = alertLastPrice();
    const n = Number(alertPrice());
    if (last == null || !Number.isFinite(n) || n <= 0) return '';
    const kind = alertKind();
    if (kind === 'price_above' && n <= last) {
      return `Price is already above ${fmtPrice(n)} — it fires on the next tick.`;
    }
    if (kind === 'price_below' && n >= last) {
      return `Price is already below ${fmtPrice(n)} — it fires on the next tick.`;
    }
    return '';
  };

  /** Enabled alerts already attached to the pop's symbol. */
  const symbolAlertCount = createMemo(() => {
    void alertsTick();
    const sym = alertSym();
    if (!sym) return 0;
    const key = sym.toUpperCase();
    return listAlerts().filter((a) => a.enabled && a.symbol.toUpperCase() === key).length;
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
    high24h?: number;
    low24h?: number;
    volume24h?: number;
    quoteVolume24h?: number;
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
          // Keep the day envelope across last-only frames (WS tickers often
          // send price/change per tick and the stats less often).
          high24h: partial.high24h ?? old?.high24h,
          low24h: partial.low24h ?? old?.low24h,
          volume24h: partial.volume24h ?? old?.volume24h,
          quoteVolume24h: partial.quoteVolume24h ?? old?.quoteVolume24h,
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

  const newListInFolder = (folderId: string) => {
    const id = createWatchlist(undefined, [], folderId);
    setManagerOpen(true);
    beginManagerRename('list', id);
    announce('Created watchlist');
  };

  const onNewFolder = () => {
    const id = createWatchlistFolder();
    setManagerOpen(true);
    beginManagerRename('folder', id);
    announce('Created folder');
  };

  const beginManagerRename = (kind: 'list' | 'folder', id: string) => {
    const name =
      kind === 'folder'
        ? (folders().find((f) => f.id === id)?.name ?? '')
        : (lists().find((l) => l.id === id)?.name ?? '');
    setRenameTarget({ kind, id });
    setRenameDraft(name);
    setManagerMenu('');
  };

  const commitManagerRename = () => {
    const target = renameTarget();
    if (!target) return;
    if (target.kind === 'folder') renameWatchlistFolder(target.id, renameDraft());
    else renameWatchlist(target.id, renameDraft());
    setRenameTarget(null);
  };

  const cancelManagerRename = () => setRenameTarget(null);

  const isRenaming = (kind: 'list' | 'folder', id: string) =>
    renameTarget()?.kind === kind && renameTarget()?.id === id;

  const toggleManagerMenu = (key: string) => setManagerMenu((prev) => (prev === key ? '' : key));

  const openList = (id: string) => {
    setActiveWatchlist(id);
    setManagerOpen(false);
    setManagerMenu('');
    setSymbolActions(null);
  };

  const duplicateList = (id: string) => {
    const copy = duplicateWatchlist(id);
    if (!copy) return;
    setManagerOpen(true);
    beginManagerRename('list', copy);
    announce('Duplicated watchlist');
  };

  const removeList = (id: string) => {
    if (!deleteWatchlist(id)) return;
    setManagerMenu('');
    announce('Deleted watchlist');
  };

  const removeFolder = (id: string) => {
    if (!deleteWatchlistFolder(id)) return;
    setManagerMenu('');
    announce('Folder removed — its lists moved to the root');
  };

  const moveList = (id: string, delta: -1 | 1) => {
    if (moveWatchlist(id, delta))
      announce(delta < 0 ? 'Moved watchlist up' : 'Moved watchlist down');
  };

  const moveFolder = (id: string, delta: -1 | 1) => {
    if (moveWatchlistFolder(id, delta))
      announce(delta < 0 ? 'Moved folder up' : 'Moved folder down');
  };

  const moveListToFolder = (listId: string, folderId: string | null) => {
    if (!moveWatchlistToFolder(listId, folderId)) return;
    setManagerMenu('');
    announce(folderId ? 'Moved watchlist into folder' : 'Moved watchlist to the root');
  };

  const toggleSymbolActions = (sym: string) =>
    setSymbolActions((prev) => (prev === sym ? null : sym));

  const onMoveSymbol = (sym: string, delta: -1 | 1) => {
    if (moveWatchlistSymbol(sym, delta)) announce(`${sym} moved`);
  };

  const onMoveSymbolToList = (sym: string, targetId: string) => {
    if (!moveWatchlistSymbolToList(sym, targetId)) return;
    announce(`Moved ${sym}`);
    setSymbolActions(null);
  };

  const onCopySymbol = async (sym: string) => {
    if (await copyToClipboard(sym)) announce(`Copied ${sym}`);
  };

  const onRemoveSymbol = (sym: string) => {
    removeWatchlistSymbol(sym);
    if (symbolActions() === sym) setSymbolActions(null);
    announce(`Removed ${sym}`);
  };

  const onSortSymbols = () => {
    sortWatchlistSymbols();
    announce('Sorted the active watchlist');
  };

  const onClearSymbols = () => {
    if (!store.watchlist.symbols.length) return;
    const name = activeList()?.name || 'watchlist';
    if (typeof window !== 'undefined' && !window.confirm(`Remove every symbol from "${name}"?`)) {
      return;
    }
    clearWatchlistSymbols();
    setSymbolActions(null);
    announce(`Cleared ${name}`);
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

  const toggleExpanded = (sym: string) => {
    const key = sym.toUpperCase();
    setExpandedSyms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        announce(`${sym} compact view`);
      } else {
        next.add(key);
        announce(`${sym} big price view`);
      }
      return next;
    });
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
    setAlertPrice(last != null && Number.isFinite(last) ? alertPriceText(last) : '');
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
    const onReposition = () => placeAlertPop();
    const disposeDismiss = dismissOnOutside({
      inside: () => [alertPopEl, alertAnchorEl],
      onDismiss: () => closeAlert(),
    });
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    onCleanup(() => {
      disposeDismiss();
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

  const modeLabel = () => {
    const m = quoteMode();
    if (m === 'ws') return 'live';
    if (m === 'rest') return 'rest';
    return '';
  };

  const cols = 'grid grid-cols-[minmax(3.75rem,1fr)_auto_auto_auto] items-center gap-x-1.5 px-2';

  const managerRenameInput = (kind: 'list' | 'folder') => (
    <input
      class="sc-input axis-wl-rename-input"
      value={renameDraft()}
      aria-label={`Rename ${kind}`}
      data-testid={`axis-watchlist-rename-${kind}`}
      onInput={(e) => setRenameDraft(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitManagerRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelManagerRename();
        }
      }}
      onBlur={() => commitManagerRename()}
      ref={(el) =>
        queueMicrotask(() => {
          el.focus();
          el.select();
        })
      }
    />
  );

  const listRow = (list: WatchlistList) => {
    const isActive = () => (store.watchlist.activeId || activeList()?.id) === list.id;
    const menuKey = `list:${list.id}`;
    return (
      <div
        class="axis-wl-list"
        classList={{ 'is-on': isActive() }}
        data-testid={`axis-watchlist-list-row-${list.id}`}
      >
        <Show when={!isRenaming('list', list.id)} fallback={managerRenameInput('list')}>
          <button
            type="button"
            class="axis-wl-list-pick"
            title={`Open ${list.name}`}
            onClick={() => openList(list.id)}
          >
            <span class="axis-wl-list-dot" aria-hidden="true" />
            <span class="axis-wl-list-name">{list.name}</span>
            <span class="axis-wl-count">{list.symbols.length}</span>
          </button>
        </Show>
        <button
          type="button"
          class="axis-wl-icon-btn"
          classList={{ 'is-on': managerMenu() === menuKey }}
          title={`Actions for ${list.name}`}
          aria-label={`Actions for ${list.name}`}
          aria-expanded={managerMenu() === menuKey}
          onClick={() => toggleManagerMenu(menuKey)}
        >
          <Icons.menu size={11} />
        </button>
        <Show when={managerMenu() === menuKey}>
          <div class="axis-wl-manager-actions">
            <button type="button" onClick={() => beginManagerRename('list', list.id)}>
              <Icons.pencil size={10} /> Rename
            </button>
            <button type="button" onClick={() => duplicateList(list.id)}>
              <Icons.copy size={10} /> Duplicate
            </button>
            <button type="button" onClick={() => moveList(list.id, -1)}>
              <Icons.chevronUp size={10} /> Up
            </button>
            <button type="button" onClick={() => moveList(list.id, 1)}>
              <Icons.chevronDown size={10} /> Down
            </button>
            <select
              class="axis-wl-move-select"
              aria-label={`Folder for ${list.name}`}
              value={list.folderId ?? ''}
              onChange={(e) => moveListToFolder(list.id, e.currentTarget.value || null)}
            >
              <option value="">No folder</option>
              <For each={folders()}>
                {(folder) => <option value={folder.id}>{folder.name}</option>}
              </For>
            </select>
            <button
              type="button"
              class="is-danger"
              disabled={lists().length <= 1}
              onClick={() => removeList(list.id)}
            >
              <Icons.trash size={10} /> Delete
            </button>
          </div>
        </Show>
      </div>
    );
  };

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
              data-testid="axis-watchlist-menu-manage"
              onClick={() => setManagerOpen(true)}
            >
              <Icons.listTree size={14} />
              <span>Manage watchlists…</span>
            </button>
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
              data-testid="axis-watchlist-menu-new-folder"
              onClick={() => onNewFolder()}
            >
              <Icons.folder size={14} />
              <span>New folder</span>
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
            <button
              type="button"
              class="axis-wl-current"
              classList={{ 'is-open': managerOpen() }}
              title="Manage watchlists"
              aria-expanded={managerOpen()}
              aria-haspopup="true"
              data-testid="axis-watchlist-list"
              onClick={() => setManagerOpen((v) => !v)}
            >
              <Icons.watchlist size={12} />
              <span class="axis-wl-current-name">
                <Show when={folderName(activeList()?.folderId)}>
                  <span class="axis-wl-current-folder">{folderName(activeList()?.folderId)}</span>
                  <span class="axis-wl-current-sep">/</span>
                </Show>
                <span class="axis-wl-current-label">{activeList()?.name ?? 'Watchlist'}</span>
              </span>
              <span class="axis-wl-count">{store.watchlist.symbols.length}</span>
              <Icons.chevronDown
                size={11}
                class={`axis-wl-chevron${managerOpen() ? ' is-open' : ''}`}
              />
            </button>
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
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1"
            classList={{
              'text-accent': effectEnabled('watchlist.tick'),
              'text-text-faint': !effectEnabled('watchlist.tick'),
            }}
            aria-pressed={effectEnabled('watchlist.tick')}
            title={
              prefersReducedMotion()
                ? 'Tick flash stays off while reduced motion is on'
                : effectEnabled('watchlist.tick')
                  ? 'Tick flash on'
                  : 'Tick flash off'
            }
            aria-label={
              effectEnabled('watchlist.tick') ? 'Disable tick flash' : 'Enable tick flash'
            }
            data-testid="axis-watchlist-tick-flash"
            onClick={() => setEffectEnabled('watchlist.tick', !effectEnabled('watchlist.tick'))}
          >
            <Icons.zap size={12} />
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

        <Show when={managerOpen()}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the manager drawer; rows own their own controls */}
          <div
            class="axis-wl-manager"
            data-testid="axis-watchlist-manager"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              setManagerOpen(false);
              setManagerMenu('');
              cancelManagerRename();
            }}
          >
            <div class="axis-wl-manager-head">
              <span class="axis-wl-manager-title">
                <Icons.listTree size={12} /> Watchlists
              </span>
              <span class="axis-wl-manager-meta">
                {lists().length} list{lists().length === 1 ? '' : 's'} · {folders().length} folder
                {folders().length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                class="axis-wl-icon-btn"
                title="New folder"
                aria-label="New folder"
                data-testid="axis-watchlist-new-folder"
                onClick={onNewFolder}
              >
                <Icons.folder size={12} />
              </button>
              <button
                type="button"
                class="axis-wl-icon-btn"
                title="Close watchlist manager"
                aria-label="Close watchlist manager"
                onClick={() => {
                  setManagerOpen(false);
                  setManagerMenu('');
                  cancelManagerRename();
                }}
              >
                <Icons.x size={12} />
              </button>
            </div>

            <div class="axis-wl-manager-body">
              <For each={folders()}>
                {(folder) => {
                  const folderLists = () => listsInFolder(folder.id);
                  const menuKey = `folder:${folder.id}`;
                  return (
                    <div class="axis-wl-folder" data-testid={`axis-watchlist-folder-${folder.id}`}>
                      <div class="axis-wl-folder-row" classList={{ 'is-open': !folder.collapsed }}>
                        <button
                          type="button"
                          class="axis-wl-folder-toggle"
                          title={folder.collapsed ? 'Expand folder' : 'Collapse folder'}
                          aria-label={
                            folder.collapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`
                          }
                          aria-expanded={!folder.collapsed}
                          onClick={() => setWatchlistFolderCollapsed(folder.id, !folder.collapsed)}
                        >
                          <Icons.chevronDown
                            size={11}
                            class={`axis-wl-chevron${folder.collapsed ? '' : ' is-open'}`}
                          />
                        </button>
                        <Icons.folder size={12} class="axis-wl-folder-icon" />
                        <Show
                          when={!isRenaming('folder', folder.id)}
                          fallback={managerRenameInput('folder')}
                        >
                          <span class="axis-wl-folder-name">{folder.name}</span>
                        </Show>
                        <span class="axis-wl-count">{folderLists().length}</span>
                        <button
                          type="button"
                          class="axis-wl-icon-btn"
                          title={`New watchlist in ${folder.name}`}
                          aria-label={`New watchlist in ${folder.name}`}
                          onClick={() => newListInFolder(folder.id)}
                        >
                          <Icons.plus size={11} />
                        </button>
                        <button
                          type="button"
                          class="axis-wl-icon-btn"
                          classList={{ 'is-on': managerMenu() === menuKey }}
                          title={`Actions for ${folder.name}`}
                          aria-label={`Actions for ${folder.name}`}
                          aria-expanded={managerMenu() === menuKey}
                          onClick={() => toggleManagerMenu(menuKey)}
                        >
                          <Icons.menu size={11} />
                        </button>
                      </div>
                      <Show when={managerMenu() === menuKey}>
                        <div class="axis-wl-manager-actions">
                          <button
                            type="button"
                            onClick={() => beginManagerRename('folder', folder.id)}
                          >
                            <Icons.pencil size={10} /> Rename
                          </button>
                          <button type="button" onClick={() => moveFolder(folder.id, -1)}>
                            <Icons.chevronUp size={10} /> Up
                          </button>
                          <button type="button" onClick={() => moveFolder(folder.id, 1)}>
                            <Icons.chevronDown size={10} /> Down
                          </button>
                          <button
                            type="button"
                            class="is-danger"
                            onClick={() => removeFolder(folder.id)}
                          >
                            <Icons.trash size={10} /> Delete
                          </button>
                        </div>
                      </Show>
                      <Show when={!folder.collapsed}>
                        <For each={folderLists()}>{(list) => listRow(list)}</For>
                        <Show when={folderLists().length === 0}>
                          <div class="axis-wl-manager-empty">No lists in this folder</div>
                        </Show>
                      </Show>
                    </div>
                  );
                }}
              </For>

              <Show when={folders().length > 0 && rootLists().length > 0}>
                <div class="axis-wl-manager-label">Ungrouped</div>
              </Show>
              <For each={rootLists()}>{(list) => listRow(list)}</For>
            </div>

            <div class="axis-wl-manager-foot">
              <button type="button" onClick={onNewList}>
                <Icons.plus size={10} /> New watchlist
              </button>
              <button type="button" onClick={onNewFolder}>
                <Icons.folder size={10} /> New folder
              </button>
              <span class="axis-wl-spacer" />
              <button
                type="button"
                title="Sort the active watchlist A–Z"
                data-testid="axis-watchlist-sort"
                onClick={onSortSymbols}
              >
                <Icons.type size={10} /> Sort
              </button>
              <button
                type="button"
                class="is-danger"
                title="Remove every symbol from the active watchlist"
                data-testid="axis-watchlist-clear"
                onClick={onClearSymbols}
              >
                <Icons.eraser size={10} /> Clear
              </button>
            </div>
          </div>
        </Show>

        <div class="flex-1 overflow-y-auto min-h-0">
          <Show
            when={store.watchlist.symbols.length > 0}
            fallback={
              <div class="axis-wl-empty" data-testid="axis-watchlist-empty">
                <span class="axis-wl-empty-icon">
                  <Icons.watchlist size={17} />
                </span>
                <p class="axis-wl-empty-title">
                  No symbols in {activeList()?.name ?? 'this watchlist'}
                </p>
                <p class="axis-wl-empty-sub">Add one below, or browse the venue’s symbols.</p>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost"
                  onClick={() => setBrowseOpen(true)}
                >
                  <Icons.search size={11} /> Browse symbols
                </button>
              </div>
            }
          >
            <div
              class={`${cols} h-5 text-[10px] uppercase tracking-wider text-text-faint select-none`}
              aria-hidden="true"
            >
              <span>Sym</span>
              <span class="text-right min-w-[4.5rem]">Last</span>
              <span
                class="text-right min-w-[4.25rem]"
                title="Change vs the previous daily close (UTC) — 24h % when the venue has no daily klines"
              >
                Chg
              </span>
              <span
                class="text-right min-w-[3.9rem] text-text-faint"
                title="Previous daily close (UTC 00:00) — fixed for the day"
              >
                Prev
              </span>
            </div>
            <For each={store.watchlist.symbols}>
              {(sym, index) => (
                <>
                  <WatchlistRow
                    sym={sym}
                    tick={prices()[sym]}
                    prevClose={prevCloseFor(sym)}
                    active={store.symbol === sym}
                    alerted={alertedSymbols().has(sym.toUpperCase())}
                    expanded={expandedSyms().has(sym.toUpperCase())}
                    moreOpen={symbolActions() === sym}
                    cols={cols}
                    onSelect={(s) => void select(s)}
                    onAlert={openAlert}
                    onExpand={toggleExpanded}
                    onMore={toggleSymbolActions}
                  />
                  <Show when={symbolActions() === sym}>
                    <div
                      class="axis-wl-sym-actions"
                      data-testid={`axis-watchlist-sym-actions-${sym}`}
                    >
                      <button
                        type="button"
                        disabled={index() === 0}
                        title="Move up"
                        onClick={() => onMoveSymbol(sym, -1)}
                      >
                        <Icons.chevronUp size={10} /> Up
                      </button>
                      <button
                        type="button"
                        disabled={index() === store.watchlist.symbols.length - 1}
                        title="Move down"
                        onClick={() => onMoveSymbol(sym, 1)}
                      >
                        <Icons.chevronDown size={10} /> Down
                      </button>
                      <select
                        class="axis-wl-move-select"
                        aria-label={`Move ${sym} to another watchlist`}
                        value=""
                        onChange={(e) => {
                          const target = e.currentTarget.value;
                          e.currentTarget.value = '';
                          if (target) onMoveSymbolToList(sym, target);
                        }}
                      >
                        <option value="">Move to…</option>
                        <For each={lists().filter((l) => l.id !== activeList()?.id)}>
                          {(list) => <option value={list.id}>{list.name}</option>}
                        </For>
                      </select>
                      <button
                        type="button"
                        title="Copy symbol"
                        onClick={() => void onCopySymbol(sym)}
                      >
                        <Icons.copy size={10} /> Copy
                      </button>
                      <button
                        type="button"
                        class="is-danger"
                        title="Remove from this watchlist"
                        onClick={() => onRemoveSymbol(sym)}
                      >
                        <Icons.trash size={10} /> Remove
                      </button>
                    </div>
                  </Show>
                </>
              )}
            </For>
          </Show>
        </div>

        <div class="border-t border-border px-2 py-1.5 flex-shrink-0">
          <div class="axis-wl-add">
            <input
              class="sc-input h-7 min-h-7 text-[11px] placeholder:text-text-faint bg-transparent"
              placeholder="Add symbol…"
              aria-label="Add symbol"
              data-testid="axis-watchlist-add"
              value={addValue()}
              onInput={(e) => setAddValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAdd();
                else if (e.key === 'ArrowDown' || (e.key === ' ' && e.ctrlKey)) {
                  e.preventDefault();
                  setBrowseOpen(true);
                }
              }}
            />
            <button
              type="button"
              class="axis-tb-field-trailing-btn"
              title="Browse symbols for this venue"
              aria-label="Browse symbols"
              data-testid="axis-watchlist-browse"
              onClick={() => setBrowseOpen(true)}
            >
              <Icons.search size={14} />
            </button>
          </div>
        </div>
      </FloatableShell>
      <SymbolModal
        open={browseOpen()}
        initialQuery={addValue() || store.symbol}
        onClose={() => setBrowseOpen(false)}
        onSelect={(sym) => {
          const next = sym.toUpperCase().trim();
          if (next) addWatchlistSymbol(next);
          setAddValue('');
          setBrowseOpen(false);
        }}
      />
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
                <span class="flex items-center gap-1.5">
                  <Show when={alertLastPrice() != null}>
                    <span
                      class="font-mono text-[10px] text-text-dim tabular-nums"
                      title="Last price"
                      data-testid="axis-watchlist-alert-last"
                    >
                      {fmtPrice(alertLastPrice())}
                    </span>
                  </Show>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1"
                    aria-label="Close"
                    onClick={() => closeAlert()}
                  >
                    <Icons.x size={12} />
                  </button>
                </span>
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
                      title={
                        opt.id === 'price_cross'
                          ? 'Fires when price crosses the level in either direction'
                          : opt.id === 'price_above'
                            ? 'Fires once price is above the level'
                            : 'Fires once price is below the level'
                      }
                      onClick={() => setAlertKind(opt.id)}
                    >
                      {opt.label}
                    </button>
                  )}
                </For>
              </div>
              <div class="flex items-center gap-1 mb-1.5">
                <For each={alertQuickFills()}>
                  {(q) => (
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost text-[10px] px-1.5 h-6 min-h-6 flex-1"
                      title={q.title}
                      data-testid={`axis-watchlist-alert-quick-${q.id}`}
                      onClick={() => setAlertPrice(q.value)}
                    >
                      {q.label}
                    </button>
                  )}
                </For>
              </div>
              <input
                class="sc-input w-full h-7 min-h-7 text-[11px] font-mono mb-1"
                inputMode="decimal"
                placeholder={
                  alertLastPrice() != null ? `Price (last ${fmtPrice(alertLastPrice())})` : 'Price'
                }
                value={alertPrice()}
                aria-label="Alert price"
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
              <Show when={alertHint()}>
                <div
                  class="text-[10px] text-amber-300/90 mb-1"
                  data-testid="axis-watchlist-alert-hint"
                >
                  {alertHint()}
                </div>
              </Show>
              <Show when={alertError()}>
                <div class="text-[10px] text-red mb-1" role="alert">
                  {alertError()}
                </div>
              </Show>
              <button
                type="button"
                class="sc-btn sc-btn-primary w-full h-7 min-h-7 text-[11px]"
                data-testid="axis-watchlist-alert-create"
                disabled={!alertValid()}
                onClick={() => commitAlert()}
              >
                Create alert
              </button>
              <Show when={symbolAlertCount() > 0}>
                <button
                  type="button"
                  class="mt-1 w-full text-[9px] text-text-faint hover:text-accent text-left"
                  data-testid="axis-watchlist-alert-manage"
                  onClick={() => {
                    closeAlert();
                    setStore('alertsPanel', 'open', true);
                  }}
                >
                  {symbolAlertCount()} alert{symbolAlertCount() === 1 ? '' : 's'} on {sym()} —
                  manage
                </button>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </Show>
  );
};
