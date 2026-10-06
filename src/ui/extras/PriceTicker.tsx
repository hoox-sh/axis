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
 * Watchlist price ticker — full-width marquee band under the module bar.
 *
 * REST-seeds instantly, then follows the watchlist quote mux for the selected
 * symbols only. Pauses on hover/focus; collapses when disabled or empty.
 *
 * The track holds two identical `.axis-extra-ticker-set` halves and scrolls
 * `translateX(-50%)`, so one period is exactly one half. Spacing lives on the
 * set (not a flex `gap`) — a gap would make the half a gap-width short and the
 * band would visibly skip every cycle. The clone half is `aria-hidden` and
 * `tabIndex={-1}` so assistive tech does not hear every symbol twice and
 * keyboard users do not tab through invisible duplicates.
 *
 * Also: pause/play toggle, click-to-pin items (pin = keep the symbol at full
 * contrast + underline), a drag handle for vertical repositioning (offset
 * persisted as `extras.ticker.offsetY`), and configurable spacing / height /
 * font-size / opacity. Hover pauses; the explicit toggle wins over hover so
 * the pause button stays usable — see the `:focus-within` note in index.css.
 *
 * @module ui/extras/PriceTicker
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
import { persist, setStore, store, TICKER_OFFSET_Y_MAX } from '../../store';
import { startWatchlistQuotes, type QuoteMuxHandle, type QuoteUpdate } from '../../data/watchlist-live';
import { fetchWatchlistTickers } from '../../data/watchlist-tickers';
import { buildTickerRows, formatTickerRow, type TickerRow } from './format';

export { formatTickerRow };

/** One band item: dim symbol, tabular price, colored change. */
const TickerItem: Component<{
  row: TickerRow;
  pinned: boolean;
  onPin: (symbol: string) => void;
  /** Clone half of the loop — kept out of the tab order (see track notes). */
  clone?: boolean;
}> = (props) => (
  <button
    type="button"
    class="axis-extra-tick"
    classList={{
      'is-up': props.row.up,
      'is-down': !props.row.up,
      'is-pending': !props.row.hasPrice,
      'is-pinned': props.pinned,
    }}
    onClick={() => props.onPin(props.row.symbol)}
    // The clone half is `aria-hidden`; without this, keyboard users tab
    // through N buttons the screen reader never announced.
    tabIndex={props.clone ? -1 : undefined}
    aria-pressed={props.pinned}
    title={props.pinned ? `Unpin ${props.row.symbol}` : `Pin ${props.row.symbol}`}
  >
    <span class="axis-extra-tick-sym">{props.row.symbol}</span>
    <span class="axis-extra-tick-price">{props.row.price}</span>
    <Show when={props.row.change}>
      {(change) => (
        <span class="axis-extra-tick-change">
          <span class="axis-extra-tick-arrow" aria-hidden="true">
            {props.row.up ? '▲' : '▼'}
          </span>
          {change()}
        </span>
      )}
    </Show>
  </button>
);

/** Drag handle for vertical repositioning. */
const DragHandle: Component<{
  onDragStart: (e: PointerEvent) => void;
}> = (props) => (
  <div
    class="axis-extra-ticker-handle"
    title="Drag to reposition"
    onPointerDown={props.onDragStart}
  >
    <div class="axis-extra-ticker-handle-bar" />
  </div>
);

/** Watchlist price ticker marquee band. */
export const PriceTicker: Component = () => {
  const [quotes, setQuotes] = createSignal<Record<string, QuoteUpdate>>({});
  const [paused, setPaused] = createSignal(false);
  const [pinned, setPinned] = createSignal<Set<string>>(new Set());
  const [dragging, setDragging] = createSignal(false);
  let mux: QuoteMuxHandle | null = null;
  let bandEl: HTMLDivElement | undefined;
  /** Detaches the document-level drag listeners for an in-flight drag. */
  let endDrag: (() => void) | null = null;

  const stop = () => {
    try {
      mux?.stop();
    } catch {
      /* ignore */
    }
    mux = null;
  };

  const start = () => {
    stop();
    const symbols = store.extras.ticker.symbols;
    if (!symbols.length) {
      // Clear stale quotes so a later re-enable never flashes old prices.
      setQuotes({});
      return;
    }
    const requested = [...symbols];
    const sourceId = store.source;
    // REST seed so the band paints instantly. Merge under live quotes so
    // WS ticks that arrive before the fetch resolves are not wiped.
    void fetchWatchlistTickers(requested, sourceId)
      .then((seed) => {
        const next: Record<string, QuoteUpdate> = {};
        for (const [k, t] of Object.entries(seed)) {
          next[k] = { symbol: k, price: t.price, change: t.change };
        }
        setQuotes((q) => {
          const merged: Record<string, QuoteUpdate> = { ...next };
          for (const s of requested) {
            const live = q[s];
            if (live) merged[s] = live;
          }
          return merged;
        });
      })
      .catch(() => {});
    mux = startWatchlistQuotes({
      sourceId,
      symbols: requested,
      onQuote: (u) => setQuotes((q) => ({ ...q, [u.symbol]: u })),
    });
  };

  // Single effect owns the lifecycle (runs on mount too) — a separate
  // onMount start would open a second mux on every mount.
  createEffect(() => {
    // Restart when symbols / source change (runs once on mount too).
    void store.extras.ticker.symbols.join(',');
    void store.source;
    start();
  });
  onCleanup(stop);

  const rows = createMemo(() =>
    buildTickerRows(store.extras.ticker.symbols, quotes(), {
      showChange: store.extras.ticker.showChange,
    }),
  );

  const togglePin = (symbol: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const handleDragStart = (e: PointerEvent) => {
    if (!bandEl) return;
    e.preventDefault();
    const startY = store.extras.ticker.offsetY;
    const startClientY = e.clientY;
    setDragging(true);
    document.body.classList.add('axis-ticker-dragging');

    const onMove = (ev: PointerEvent) => {
      // 0 is the band's natural layout slot; the topbar has no overflow clip, so
      // a negative offset would paint the band over the command/module bars.
      const next = Math.max(
        0,
        Math.min(TICKER_OFFSET_Y_MAX, startY + ev.clientY - startClientY),
      );
      setStore('extras', 'ticker', 'offsetY', next);
    };

    const detach = () => {
      setDragging(false);
      document.body.classList.remove('axis-ticker-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      endDrag = null;
    };
    const finish = () => {
      detach();
      // Single durable write at drop; moves stay transient.
      persist();
    };
    endDrag = detach;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  // A drag in flight must not outlive the band — symbols can empty out and
  // unmount <PriceTicker/> mid-gesture, leaving listeners bound to a dead node.
  onCleanup(() => {
    endDrag?.();
  });

  const cssVars = createMemo(() => ({
    '--ticker-speed': `${30 / store.extras.ticker.speed}s`,
    '--ticker-item-gap': `${store.extras.ticker.itemSpacing}rem`,
    '--ticker-band-height': `${store.extras.ticker.bandHeight}px`,
    '--ticker-font-size': `${store.extras.ticker.fontSize}px`,
    '--ticker-opacity': String(store.extras.ticker.opacity),
    // Persisted drag offset — the band keeps its position across reloads.
    transform: `translateY(${store.extras.ticker.offsetY}px)`,
  }));

  return (
    <div
      ref={bandEl}
      class="axis-extra-ticker"
      classList={{ 'is-paused': paused(), 'is-dragging': dragging() }}
      data-testid="axis-extra-ticker"
      data-ticker-dir={store.extras.ticker.direction}
      style={cssVars()}
    >
      <Show when={store.extras.ticker.draggable}>
        <DragHandle onDragStart={handleDragStart} />
      </Show>
      <button
        type="button"
        class="axis-extra-ticker-pause"
        onClick={() => setPaused((p) => !p)}
        title={paused() ? 'Resume marquee' : 'Pause marquee'}
        aria-label={paused() ? 'Resume marquee' : 'Pause marquee'}
        aria-pressed={paused()}
      >
        {paused() ? '▶' : '⏸'}
      </button>
      <div class="axis-extra-ticker-track">
        <div class="axis-extra-ticker-set">
          <For each={rows()}>
            {(row) => (
              <TickerItem
                row={row}
                pinned={pinned().has(row.symbol)}
                onPin={togglePin}
              />
            )}
          </For>
        </div>
        {/* Clone — hidden from assistive tech and out of the tab order, shown only to close the loop. */}
        <div class="axis-extra-ticker-set" aria-hidden="true">
          <For each={rows()}>
            {(row) => (
              <TickerItem
                row={row}
                pinned={pinned().has(row.symbol)}
                onPin={togglePin}
                clone
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
