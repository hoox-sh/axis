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
 * Symbol picker modal — preloaded instrument list for the active exchange
 * (resolved from source, with stream as fallback).
 */

import {
  Component,
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
import { Icons } from './icons';

export type SymbolModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called with AXIS symbol form when user picks a row or commits free text. */
  onSelect: (symbol: string) => void;
  /** Initial filter (usually current chart symbol). */
  initialQuery?: string;
};

export const SymbolModal: Component<SymbolModalProps> = (props) => {
  const [query, setQuery] = createSignal('');
  const [quote, setQuote] = createSignal('ALL');
  const [rows, setRows] = createSignal<SymbolEntry[]>([]);
  const [venue, setVenue] = createSignal<SymbolVenue>('generic');
  const [venueName, setVenueName] = createSignal('…');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [meta, setMeta] = createSignal('');
  const [active, setActive] = createSignal(0);
  let searchRef: HTMLInputElement | undefined;
  let abort: AbortController | undefined;

  const filtered = createMemo(() =>
    filterSymbols(rows(), query(), { quote: quote(), limit: 100 })
  );

  const quotes = createMemo(() => ['ALL', ...listQuotes(rows()).slice(0, 12)]);

  const activeStreamId = () =>
    store.live?.streamId || store.activePlugins?.stream || '';

  const exchangeHint = createMemo(() => {
    const src = store.source;
    const stream = activeStreamId();
    return `Source ${src}${stream ? ` · Stream ${stream}` : ''}`;
  });

  // Seed search + focus when the modal opens (not on every source change)
  createEffect(() => {
    if (!props.open) return;
    setQuery((props.initialQuery || store.symbol || '').toUpperCase());
    setQuote('ALL');
    setActive(0);
    setError('');
    queueMicrotask(() => searchRef?.focus());
    requestAnimationFrame(() => searchRef?.select());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
    });
  });

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
          setError(
            `Catalog fetch: ${r.error} (using ${r.fallback ? 'fallback' : 'cache'})`
          );
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
    const raw = String(sym || '').toUpperCase().trim();
    const ccxt = store.source === 'ccxt-rest' || store.live?.streamId === 'ccxt-ws';
    const next = ccxt ? raw : raw.replace(/[^A-Z0-9:._-]/g, '');
    if (!next) return;
    props.onSelect(next);
    props.onClose();
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

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
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
    <Show when={props.open}>
      <div
        class="sc-dialog-backdrop sc-dialog-backdrop--start sm:items-center"
        onClick={onBackdrop}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(540px,calc(100vw-2*var(--ui-dialog-margin)))] max-h-[min(86vh,660px)] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-symbol-modal-title"
          data-testid="axis-symbol-modal"
          tabIndex={-1}
        >
          <div class="sc-dialog-accent" />
          <div class="sc-dialog-header">
            <div class="min-w-0">
              <div
                id="axis-symbol-modal-title"
                class="text-[0.95em] font-semibold text-text tracking-tight"
              >
                Symbol
              </div>
              <div class="sc-hint truncate" data-testid="axis-symbol-modal-venue">
                {venueName()} · {exchangeHint()}
                <Show when={meta()}>
                  <span class="text-text-faint"> · {meta()}</span>
                </Show>
              </div>
            </div>
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
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-2"
                onClick={() => props.onClose()}
                aria-label="Close"
              >
                <Icons.x />
              </button>
            </div>
          </div>

          <div class="sc-dialog-body flex flex-col gap-3 min-h-0 overflow-hidden flex-1">
            <Show when={error()}>
              <div
                class="text-[11px] text-amber-200/90 border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 rounded"
                role="status"
              >
                {error()}
              </div>
            </Show>

            <label class="flex flex-col gap-0.5">
              <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                Search or type symbol
              </span>
              <input
                ref={searchRef}
                type="text"
                class="sc-input font-mono text-[0.95em]"
                data-testid="axis-symbol-modal-search"
                value={query()}
                spellcheck={false}
                autocomplete="off"
                placeholder={
                  venue() === 'gecko'
                    ? 'eth:0x… or search later in On-Chain'
                    : 'BTC, ETHUSDT, SOL…'
                }
                onInput={(e) => {
                  setQuery(e.currentTarget.value.toUpperCase());
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
              />
            </label>

            <div
              class="flex flex-wrap gap-1"
              data-testid="axis-symbol-modal-quotes"
            >
              <For each={quotes()}>
                {(q) => (
                  <button
                    type="button"
                    class={`sc-btn sc-btn-sm ${
                      quote() === q ? 'sc-btn-primary' : 'sc-btn-ghost'
                    }`}
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

            <div
              class="flex-1 min-h-[200px] overflow-y-auto border border-border/40 rounded bg-card/30"
              data-testid="axis-symbol-modal-list"
              role="listbox"
              aria-label="Symbols"
            >
              <Show when={loading()}>
                <div class="flex items-center justify-center gap-2 py-10 text-muted text-sm">
                  <Icons.loader class="animate-spin" />
                  Loading {venueName()} pairs…
                </div>
              </Show>
              <Show when={!loading() && filtered().length === 0}>
                <div class="py-8 px-3 text-center text-muted text-sm">
                  No matches.
                  <Show when={query().trim()}>
                    {' '}
                    Press Enter to use{' '}
                    <span class="font-mono text-text">{query().trim()}</span>
                  </Show>
                </div>
              </Show>
              <Show when={!loading() && filtered().length > 0}>
                <ul class="divide-y divide-border/25">
                  <For each={filtered()}>
                    {(row, i) => (
                      <li>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active() === i()}
                          class={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent/10 ${
                            active() === i() ? 'bg-accent/15' : ''
                          }`}
                          onMouseEnter={() => setActive(i())}
                          onClick={() => pick(row.symbol)}
                        >
                          <span class="font-mono font-medium text-text text-[0.92em]">
                            {row.symbol}
                          </span>
                          <span class="text-muted text-[0.8em] font-mono truncate">
                            {row.display}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>

            <div class="flex items-center justify-between gap-2 pt-1">
              <span class="text-[0.7rem] text-text-faint">
                ↑↓ navigate · Enter select · Esc close
              </span>
              <button
                type="button"
                class="sc-btn sc-btn-primary sc-btn-sm"
                data-testid="axis-symbol-modal-apply"
                onClick={() => pickActive()}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
