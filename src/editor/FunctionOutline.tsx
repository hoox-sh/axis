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
 * Right-rail **function tree** for the Pine editor.
 *
 * Lists user functions, methods, types, and enums from the active buffer.
 * Clicking a name jumps the editor to that declaration line.
 *
 * @module editor/FunctionOutline
 */

import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import {
  collectFunctionOutline,
  groupOutlineEntries,
  type OutlineEntry,
  type OutlineKind,
} from './function-outline';
import { Icons } from '../ui/icons';

export type FunctionOutlineProps = {
  /** Active editor document text. */
  doc: string;
  /** 1-based cursor line — highlights the nearest enclosing outline entry. */
  activeLine?: number;
  /** Jump the editor to a 1-based line. */
  onSelect: (line: number) => void;
};

const KIND_GLYPH: Record<OutlineKind, string> = {
  function: 'ƒ',
  method: 'm',
  type: 'T',
  enum: 'E',
};

function entryLabel(e: OutlineEntry): string {
  if (e.kind === 'method' && e.parent) return `${e.parent}.${e.name}`;
  return e.name;
}

/** Selectable outline of Pine declarations for the editor right rail. */
export const FunctionOutline: Component<FunctionOutlineProps> = (props) => {
  const [filter, setFilter] = createSignal('');
  const entries = createMemo(() => collectFunctionOutline(props.doc || ''));
  const groups = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const all = entries();
    const filtered = q
      ? all.filter((e) => {
          const label = entryLabel(e).toLowerCase();
          return label.includes(q) || e.kind.includes(q);
        })
      : all;
    return groupOutlineEntries(filtered);
  });

  /** Nearest outline entry at or above the cursor line. */
  const activeKey = createMemo(() => {
    const line = props.activeLine ?? 0;
    if (line < 1) return '';
    let best: OutlineEntry | null = null;
    for (const e of entries()) {
      if (e.line <= line && (!best || e.line >= best.line)) best = e;
    }
    return best ? `${best.kind}:${best.line}:${best.name}` : '';
  });

  return (
    <aside
      class="ax-function-outline flex flex-col min-h-0 flex-shrink-0"
      data-testid="axis-editor-outline"
      aria-label="Function tree"
    >
      <div class="ax-function-outline-head flex items-center gap-1 px-1.5 h-7 flex-shrink-0 border-b border-border/60">
        <Icons.listTree size={12} class="opacity-70 flex-shrink-0" />
        <span class="text-[10px] uppercase tracking-wider text-text-dim font-semibold truncate">
          Outline
        </span>
        <span
          class="ml-auto text-[10px] text-text-faint tabular-nums"
          data-testid="axis-editor-outline-count"
        >
          {entries().length}
        </span>
      </div>
      <div class="px-1.5 py-1 flex-shrink-0">
        <input
          type="search"
          class="ax-function-outline-filter w-full bg-bg border border-border/50 rounded-[var(--radius-chip)] px-1.5 py-0.5 text-[11px] text-text outline-none focus:border-accent/50"
          placeholder="Filter…"
          value={filter()}
          data-testid="axis-editor-outline-filter"
          aria-label="Filter outline"
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-0.5 pb-1">
        <Show
          when={groups().length > 0}
          fallback={
            <div
              class="px-2 py-3 text-[11px] text-text-faint"
              data-testid="axis-editor-outline-empty"
            >
              {filter().trim()
                ? 'No matching symbols'
                : 'No functions, types, or enums'}
            </div>
          }
        >
          <For each={groups()}>
            {(group) => (
              <div class="ax-function-outline-group mb-1">
                <div class="px-1.5 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-text-faint font-semibold">
                  {group.label}
                </div>
                <ul class="list-none m-0 p-0">
                  <For each={group.items}>
                    {(item) => {
                      const key = () => `${item.kind}:${item.line}:${item.name}`;
                      const isActive = () => activeKey() === key();
                      return (
                        <li>
                          <button
                            type="button"
                            class={`ax-function-outline-item w-full flex items-center gap-1 px-1.5 py-0.5 text-left rounded-[var(--radius-chip)] text-[11px] leading-tight ${
                              isActive() ? 'is-active' : ''
                            }`}
                            title={`Line ${item.line}${item.exported ? ' · export' : ''}`}
                            data-testid="axis-editor-outline-item"
                            data-kind={item.kind}
                            data-line={String(item.line)}
                            aria-current={isActive() ? 'location' : undefined}
                            onClick={() => props.onSelect(item.line)}
                          >
                            <span
                              class="ax-function-outline-kind flex-shrink-0 w-3 text-center text-[10px] text-text-faint font-mono"
                              aria-hidden="true"
                            >
                              {KIND_GLYPH[item.kind]}
                            </span>
                            <span class="min-w-0 truncate text-text">
                              {entryLabel(item)}
                            </span>
                            <Show when={item.exported}>
                              <span class="flex-shrink-0 text-[9px] text-accent/80">
                                exp
                              </span>
                            </Show>
                            <span class="ml-auto flex-shrink-0 text-[10px] text-text-faint tabular-nums">
                              {item.line}
                            </span>
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
};
