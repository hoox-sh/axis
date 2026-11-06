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
 * Symbol picker modal — preloaded instrument list for the active exchange
 * (resolved from source, with stream as fallback).
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
import { store } from '../store';
import {
  type SymbolEntry,
  type SymbolVenue,
  filterSymbols,
  listQuotes,
  loadSymbolCatalog,
  resolveSymbolVenue,
  venueLabel,
} from '../data/symbol-catalog';
import { activeCcxtExchange, activeCcxtGateway } from '../data/credentials';
import { Modal } from './Modal';
import { Icons } from './icons';
import { Spinner } from './Spinner';
import {
  emptySymbolPicks,
  loadSymbolPicks,
  rememberSymbol,
  saveSymbolPicks,
  symbolPicksScope,
  toggleFavorite,
  visibleSymbolPicks,
  type SymbolPicks,
} from './symbol-picks';

/** Props for the symbol picker: visibility, close/select handlers, and initial filter. */
export type SymbolModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called with AXIS symbol form when user picks a row or commits free text. */
  onSelect: (symbol: string) => void;
  /** Initial filter (usually current chart symbol). */
  initialQuery?: string;
};

/** Symbol picker overlay: filters the active exchange's instruments and reports the pick. */
export const SymbolModal: Component<SymbolModalProps> = (props): JSX.Element => {
  const [query, setQuery] = createSignal('');
  const [quote, setQuote] = createSignal('ALL');
  const [rows, setRows] = createSignal<SymbolEntry[]>([]);
  const [venue, setVenue] = createSignal<SymbolVenue>('generic');
  const [venueName, setVenueName] = createSignal('…');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [meta, setMeta] = createSignal('');
  const [active, setActive] = createSignal(0);
  const [picks, setPicks] = createSignal<SymbolPicks>(emptySymbolPicks());
  const [seed, setSeed] = createSignal('');
  let searchRef: HTMLInputElement | undefined;
  let abort: AbortController | undefined;

  const filtered = createMemo(() => filterSymbols(rows(), query(), { quote: quote(), limit: 100 }));

  const quotes = createMemo(() => ['ALL', ...listQuotes(rows()).slice(0, 12)]);

  const activeStreamId = () => store.live?.streamId || store.activePlugins?.stream || '';

  const exchangeHint = createMemo(() => {
    const src = store.source;
    const stream = activeStreamId();
    return `Source ${src}${stream ? ` · Stream ${stream}` : ''}`;
  });

  // Seed search + focus when the modal opens (not on every source change)
  createEffect(() => {
    if (!props.open) return;
    const initial = (props.initialQuery || store.symbol || '').toUpperCase();
    setQuery(initial);
    setSeed(initial);
    setQuote('ALL');
    setActive(0);
    setError('');
    queueMicrotask(() => searchRef?.focus());
    requestAnimationFrame(() => searchRef?.select());
  });

  const ccxtExchangeId = () =>
    store.source === 'ccxt-rest' || store.live?.streamId === 'ccxt-ws' ? activeCcxtExchange() : '';

  const picksScope = () => symbolPicksScope(venue(), ccxtExchangeId());

  const writePicks = (next: SymbolPicks) => {
    setPicks(next);
    saveSymbolPicks(picksScope(), next);
  };

  const showPicks = () => {
    const q = query().trim();
    return q === '' || q === seed();
  };

  const chips = createMemo(() => (showPicks() ? visibleSymbolPicks(picks()) : emptySymbolPicks()));

  const isFavorite = (sym: string) => picks().favorites.includes(sym);

  // Preload instrument list for venue (source → stream)
  createEffect(() => {
    if (!props.open) return;

    const v = resolveSymbolVenue(store.source, activeStreamId());
    const ccxtExchange =
      store.source === 'ccxt-rest' || store.live?.streamId === 'ccxt-ws'
        ? activeCcxtExchange()
        : '';
    setVenue(v);
    setVenueName(ccxtExchange ? `${ccxtExchange} (CCXT)` : venueLabel(v));
    setPicks(loadSymbolPicks(symbolPicksScope(v, ccxtExchange)));
    setMeta('');

    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;

    setLoading(true);
    void loadSymbolCatalog(v, {
      signal,
      ccxtExchange: ccxtExchange || undefined,
      gateway: ccxtExchange ? activeCcxtGateway() : undefined,
    })
      .then((r) => {
        if (signal.aborted) return;
        setVenue(r.venue);
        setVenueName(r.label);
        setRows(r.symbols);
        const bits: string[] = [`${r.symbols.length} pairs`];
        if (r.fromCache) bits.push('cached');
        if (r.fallback) bits.push('fallback list');
        setMeta(bits.join(' · '));
        if (r.error) {
          setError(`Catalog fetch: ${r.error} (using ${r.fallback ? 'fallback' : 'cache'})`);
        }
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setRows([]);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });

    onCleanup(() => {
      abort?.abort();
    });
  });

  const pick = (sym: string) => {
    const raw = String(sym || '')
      .toUpperCase()
      .trim();
    const ccxt = store.source === 'ccxt-rest' || store.live?.streamId === 'ccxt-ws';
    const next = ccxt ? raw : raw.replace(/[^A-Z0-9:._-]/g, '');
    if (!next) return;
    writePicks(rememberSymbol(picks(), next));
    props.onSelect(next);
    props.onClose();
  };

  const onToggleFavorite = (sym: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    writePicks(toggleFavorite(picks(), sym));
  };

  const pickActive = () => {
    const list = filtered();
    const i = active();
    if (list[i]) {
      pick(list[i]!.symbol);
      return;
    }
    // Free-type commit
    const q = query().trim();
    if (q) pick(q);
  };

  const onSearchKey = (e: KeyboardEvent) => {
    const list = filtered();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (list.length ? (i + 1) % list.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickActive();
    }
  };

  const refresh = () => {
    const v = venue();
    setLoading(true);
    setError('');
    abort?.abort();
    abort = new AbortController();
    const ccxtExchange =
      store.source === 'ccxt-rest' || store.live?.streamId === 'ccxt-ws'
        ? activeCcxtExchange()
        : '';
    void loadSymbolCatalog(v, {
      forceRefresh: true,
      signal: abort.signal,
      ccxtExchange: ccxtExchange || undefined,
      gateway: ccxtExchange ? activeCcxtGateway() : undefined,
    })
      .then((r) => {
        setRows(r.symbols);
        setMeta(`${r.symbols.length} pairs · refreshed`);
        if (r.error) setError(r.error);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Symbol"
      titleId="axis-symbol-modal-title"
      hintClass="sc-hint truncate"
      hintTestId="axis-symbol-modal-venue"
      hint={
        <>
          {venueName()} · {exchangeHint()}
          <Show when={meta()}>
            <span class="text-text-faint"> · {meta()}</span>
          </Show>
        </>
      }
      class="w-[min(540px,calc(100vw-2*var(--ui-dialog-margin)))] max-h-[min(86vh,660px)] flex flex-col"
      bodyClass="flex flex-col gap-3 min-h-0 overflow-hidden flex-1"
      testId="axis-symbol-modal"
      backdropClass="sc-dialog-backdrop--start sm:items-center"
      autoFocus={false}
      headerActions={
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-sm"
            onClick={() => refresh()}
            disabled={loading()}
            title="Refresh instrument list"
          >
            <Icons.refresh />
          </button>
        </div>
      }
    >
      <Show when={error()}>
        <div
          class="text-[11px] text-amber-200/90 border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 rounded"
          role="status"
        >
          {error()}
        </div>
      </Show>

      <label class="flex flex-col gap-0.5">
        <span class="text-muted text-[0.68rem] uppercase tracking-wide">Search or type symbol</span>
        <input
          ref={searchRef}
          type="text"
          class="sc-input font-mono text-[0.95em]"
          data-testid="axis-symbol-modal-search"
          value={query()}
          spellcheck={false}
          autocomplete="off"
          placeholder={
            venue() === 'gecko' ? 'eth:0x… or search later in On-Chain' : 'BTC, ETHUSDT, SOL…'
          }
          onInput={(e) => {
            setQuery(e.currentTarget.value.toUpperCase());
            setActive(0);
          }}
          onKeyDown={onSearchKey}
        />
      </label>

      <div class="flex flex-wrap gap-1" data-testid="axis-symbol-modal-quotes">
        <For each={quotes()}>
          {(q) => (
            <button
              type="button"
              class={`sc-btn sc-btn-sm ${quote() === q ? 'sc-btn-primary' : 'sc-btn-ghost'}`}
              onClick={() => {
                setQuote(q);
                setActive(0);
              }}
            >
              {q}
            </button>
          )}
        </For>
      </div>

      <Show when={chips().favorites.length > 0 || chips().recent.length > 0}>
        <div class="axis-symbol-picks" data-testid="axis-symbol-picks">
          <Show when={chips().favorites.length > 0}>
            <div class="axis-symbol-pick-row">
              <span class="axis-symbol-pick-label">Favorites</span>
              <div class="axis-symbol-pick-chips">
                <For each={chips().favorites}>
                  {(sym) => (
                    <span class="axis-symbol-pick">
                      <button
                        type="button"
                        class="axis-symbol-pick-sym"
                        data-testid={`axis-symbol-pick-fav-${sym}`}
                        onClick={() => pick(sym)}
                      >
                        {sym}
                      </button>
                      <button
                        type="button"
                        class="axis-symbol-star is-on"
                        aria-pressed="true"
                        aria-label={`Remove ${sym} from favorites`}
                        data-testid={`axis-symbol-pick-unfav-${sym}`}
                        onClick={(e) => onToggleFavorite(sym, e)}
                      >
                        <Icons.favorite size={11} fill="currentColor" />
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={chips().recent.length > 0}>
            <div class="axis-symbol-pick-row">
              <span class="axis-symbol-pick-label">Recent</span>
              <div class="axis-symbol-pick-chips">
                <For each={chips().recent}>
                  {(sym) => (
                    <span class="axis-symbol-pick">
                      <button
                        type="button"
                        class="axis-symbol-pick-sym"
                        data-testid={`axis-symbol-pick-recent-${sym}`}
                        onClick={() => pick(sym)}
                      >
                        {sym}
                      </button>
                      <button
                        type="button"
                        class="axis-symbol-star"
                        aria-pressed="false"
                        aria-label={`Add ${sym} to favorites`}
                        onClick={(e) => onToggleFavorite(sym, e)}
                      >
                        <Icons.favorite size={11} fill="none" />
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <div
        class="flex-1 min-h-[200px] overflow-y-auto border border-border/40 rounded bg-card/30"
        data-testid="axis-symbol-modal-list"
        role="listbox"
        aria-label="Symbols"
      >
        <Show when={loading()}>
          <div class="flex items-center justify-center gap-2 py-10 text-muted text-sm">
            <Spinner />
            Loading {venueName()} pairs…
          </div>
        </Show>
        <Show when={!loading() && filtered().length === 0}>
          <div class="py-8 px-3 text-center text-muted text-sm">
            No matches.
            <Show when={query().trim()}>
              {' '}
              Press Enter to use <span class="font-mono text-text">{query().trim()}</span>
            </Show>
          </div>
        </Show>
        <Show when={!loading() && filtered().length > 0}>
          <ul class="divide-y divide-border/25">
            <For each={filtered()}>
              {(row, i) => (
                <li
                  class="axis-symbol-row"
                  classList={{ 'is-active': active() === i() }}
                  onMouseEnter={() => setActive(i())}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={active() === i()}
                    class="axis-symbol-row-main"
                    onClick={() => pick(row.symbol)}
                  >
                    <span class="font-mono font-medium text-text text-[0.92em]">{row.symbol}</span>
                    <span class="text-muted text-[0.8em] font-mono truncate">{row.display}</span>
                  </button>
                  <button
                    type="button"
                    class="axis-symbol-star"
                    classList={{ 'is-on': isFavorite(row.symbol) }}
                    aria-pressed={isFavorite(row.symbol)}
                    aria-label={
                      isFavorite(row.symbol)
                        ? `Remove ${row.symbol} from favorites`
                        : `Add ${row.symbol} to favorites`
                    }
                    data-testid={`axis-symbol-star-${row.symbol}`}
                    onClick={(e) => onToggleFavorite(row.symbol, e)}
                  >
                    <Icons.favorite
                      size={12}
                      fill={isFavorite(row.symbol) ? 'currentColor' : 'none'}
                    />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <div class="flex items-center justify-between gap-2 pt-1">
        <span class="text-[0.7rem] text-text-faint">↑↓ navigate · Enter select · Esc close</span>
        <button
          type="button"
          class="sc-btn sc-btn-primary sc-btn-sm"
          data-testid="axis-symbol-modal-apply"
          onClick={() => pickActive()}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
};
