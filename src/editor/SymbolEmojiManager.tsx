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
 * Editor **symbol & emoji** picker — TV-editor-safe glyphs, insert or copy.
 *
 * @module editor/SymbolEmojiManager
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { copyToClipboard } from '../ui/clipboard';
import {
  PINE_SYMBOLS,
  PINE_SYMBOL_CATEGORIES,
  filterPineSymbols,
  plotcharSnippet,
  quotePineString,
  type PineSymbol,
  type PineSymbolCategory,
} from './pine-symbols';

export type SymbolEmojiManagerProps = {
  /** Insert at the CodeMirror cursor (replaces the selection). */
  onInsert: (text: string) => boolean;
};

type InsertMode = 'raw' | 'quoted' | 'plotchar';

async function copyText(text: string): Promise<boolean> {
  return copyToClipboard(text);
}

function payload(sym: PineSymbol, mode: InsertMode): string {
  if (mode === 'quoted') return quotePineString(sym.char);
  if (mode === 'plotchar') return plotcharSnippet(sym.char);
  return sym.char;
}

/** Searchable catalog under the Pine editor (Colors-panel sibling). */
export const SymbolEmojiManager: Component<SymbolEmojiManagerProps> = (props) => {
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<PineSymbolCategory | 'all'>('all');
  const [monoOnly, setMonoOnly] = createSignal(false);
  const [mode, setMode] = createSignal<InsertMode>('raw');
  const [flash, setFlash] = createSignal('');

  const rows = createMemo(() =>
    filterPineSymbols(query(), { category: category(), monoOnly: monoOnly() }),
  );

  const flashMsg = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? '' : cur)), 1400);
  };

  const insert = (text: string, label: string) => {
    if (props.onInsert(text)) flashMsg(`Inserted ${label}`);
    else flashMsg('Editor not ready');
  };

  return (
    <div
      class="flex-shrink-0 border-t-2 border-border bg-bg-panel text-[11px] max-h-[min(46vh,400px)] overflow-auto"
      data-testid="axis-editor-symbols"
    >
      <div class="px-2.5 pt-2 pb-1.5 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="sc-label !mb-0">Symbols &amp; emoji</span>
          <span class="text-text-faint font-mono tabular-nums">
            {rows().length}/{PINE_SYMBOLS.length}
            <Show when={flash()}>
              <span class="text-accent ml-2">{flash()}</span>
            </Show>
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <input
            type="search"
            class="sc-input min-w-[10rem] flex-1"
            placeholder="Search name, hex, glyph…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            data-testid="axis-editor-symbols-search"
            aria-label="Search symbols"
          />
          <label class="inline-flex items-center gap-1 text-text-dim">
            <input
              type="checkbox"
              checked={monoOnly()}
              onChange={(e) => setMonoOnly(e.currentTarget.checked)}
              data-testid="axis-editor-symbols-mono"
            />
            Mono-safe
          </label>
          <select
            class="sc-input w-auto"
            value={mode()}
            onChange={(e) => setMode(e.currentTarget.value as InsertMode)}
            data-testid="axis-editor-symbols-mode"
            title="How to insert"
          >
            <option value="raw">Raw glyph</option>
            <option value="quoted">Quoted string</option>
            <option value="plotchar">plotchar(…)</option>
          </select>
        </div>

        <div
          class="flex flex-wrap gap-1"
          role="tablist"
          aria-label="Symbol categories"
        >
          <button
            type="button"
            role="tab"
            aria-selected={category() === 'all'}
            class={`sc-btn sc-btn-ghost text-[10px] px-1.5 py-0.5 ${
              category() === 'all' ? 'is-active' : ''
            }`}
            onClick={() => setCategory('all')}
          >
            All
          </button>
          <For each={PINE_SYMBOL_CATEGORIES}>
            {(c) => (
              <button
                type="button"
                role="tab"
                aria-selected={category() === c.id}
                title={c.hint}
                class={`sc-btn sc-btn-ghost text-[10px] px-1.5 py-0.5 ${
                  category() === c.id ? 'is-active' : ''
                }`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            )}
          </For>
        </div>

        <div
          class="grid grid-cols-[repeat(auto-fill,minmax(2.4rem,1fr))] gap-1"
          data-testid="axis-editor-symbols-grid"
        >
          <For each={rows()}>
            {(sym) => {
              const preview =
                sym.category === 'spaces' ? '␣' : sym.char.length > 4 ? '¶' : sym.char;
              return (
                <button
                  type="button"
                  class="flex flex-col items-center justify-center min-h-[2.4rem] px-0.5 py-0.5 rounded border border-border-soft bg-bg-elev hover:border-accent hover:text-text text-text-dim"
                  title={`${sym.name}${sym.hex ? ` · ${sym.hex}` : ''}${
                    sym.monoSafe ? '' : ' · wide (chart)'
                  }${sym.notes ? ` — ${sym.notes}` : ''}`}
                  data-symbol-id={sym.id}
                  onClick={() => insert(payload(sym, mode()), sym.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    void copyText(payload(sym, mode())).then((ok) =>
                      flashMsg(ok ? `Copied ${sym.name}` : 'Copy failed'),
                    );
                  }}
                >
                  <span
                    class={`leading-none ${
                      sym.monoSafe ? 'font-mono text-[15px]' : 'text-[14px]'
                    }`}
                  >
                    {preview}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
        <Show when={rows().length === 0}>
          <p class="sc-hint m-0">No symbols match.</p>
        </Show>
      </div>
    </div>
  );
};
