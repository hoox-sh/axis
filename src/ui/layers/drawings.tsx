// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drawings list inside the Layers panel: active tool, symbol actions, rows.
 *
 * Selection is a real button so it is not nested inside another button.
 *
 * @module ui/layers/drawings
 */

import { type Component, For, Show } from 'solid-js';
import { resolveDrawingStyle, toolLabel, type Drawing } from '../../chart/drawing-types';
import { Icons } from '../icons';
import { drawingListLabel } from './format';
import { LayerEmpty, VisibilityToggle } from './rows';

export const DrawingList: Component<{
  symbol: string;
  /** Drawings for the active symbol (unfiltered). */
  drawings: Drawing[];
  /** Drawings after the search box. */
  filtered: Drawing[];
  /** Drawings stored for every symbol. */
  totalCount: number;
  selectedId: string | null;
  toolName: string;
  toolActive: boolean;
  query: string;
  onQuery: (q: string) => void;
  onDuplicate: () => void;
  onKeepSymbol: () => void;
  onTagSymbol: () => void;
  onClear: () => void;
  onSelect: (id: string) => void;
  onToggleVisible: (d: Drawing) => void;
  onRemove: (id: string) => void;
}> = (props) => {
  const symbolLabel = () => props.symbol || 'Symbol';
  return (
    <div class="flex flex-col gap-1">
      <div
        class="flex items-center gap-2 px-1.5 py-1.5 bg-bg-elev border border-border-soft"
        data-testid="axis-layers-active-tool"
      >
        <span class="text-[0.78em] uppercase tracking-wider text-text-faint flex-shrink-0">
          Tool
        </span>
        <span
          class={`flex-1 truncate font-medium ${
            props.toolActive ? 'text-accent' : 'text-text-dim'
          }`}
        >
          {props.toolName}
        </span>
        <Show when={props.selectedId}>
          <span class="text-[0.78em] font-mono text-accent flex-shrink-0">Selected</span>
        </Show>
      </div>

      <div class="flex items-center justify-between gap-2 px-1 py-0.5 flex-wrap">
        <span class="text-text-dim">
          {symbolLabel()}{' '}
          <span class="text-text-faint font-mono tabular-nums">
            ({props.drawings.length}
            {props.totalCount !== props.drawings.length ? ` / ${props.totalCount}` : ''})
          </span>
        </span>
        <div class="flex items-center gap-1 flex-wrap justify-end">
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
            disabled={!props.drawings.length}
            title={`Duplicate drawings for ${symbolLabel()} with new IDs`}
            data-testid="axis-layers-duplicate-drawings"
            onClick={props.onDuplicate}
          >
            Duplicate
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
            disabled={!props.totalCount}
            title={`Keep only drawings for ${symbolLabel()} (untagged kept; other symbols removed)`}
            data-testid="axis-layers-keep-symbol"
            onClick={props.onKeepSymbol}
          >
            This symbol
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
            disabled={!props.totalCount}
            title={`Tag all drawings with symbol ${symbolLabel()}`}
            data-testid="axis-layers-tag-symbol"
            onClick={props.onTagSymbol}
          >
            Tag symbol
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
            disabled={!props.drawings.length}
            title={`Clear drawings for ${symbolLabel()}`}
            onClick={props.onClear}
          >
            Clear
          </button>
        </div>
      </div>

      <p class="px-1 m-0 text-[0.75em] text-text-faint leading-snug">
        Drawings are anchored to the chart symbol ({props.symbol || '—'}). Other symbols keep
        their own drawings. Tag symbol migrates untagged legacy items onto the current ticker.
      </p>

      <Show when={props.drawings.length > 0}>
        <input
          type="search"
          class="axis-search sc-input h-7"
          placeholder="Filter drawings…"
          value={props.query}
          aria-label="Filter drawings"
          autocomplete="off"
          spellcheck={false}
          data-testid="axis-layers-drawing-search"
          onInput={(e) => props.onQuery(e.currentTarget.value)}
        />
      </Show>

      <Show
        when={props.drawings.length > 0}
        fallback={<LayerEmpty>No drawings</LayerEmpty>}
      >
        <Show
          when={props.filtered.length > 0}
          fallback={
            <LayerEmpty>No drawings match “{props.query.trim()}”</LayerEmpty>
          }
        >
          <ul class="flex flex-col gap-0.5 m-0 p-0 list-none" aria-label="Drawings">
            <For each={props.filtered}>
              {(d) => {
                const label = () => drawingListLabel(d);
                const selected = () => props.selectedId === d.id;
                const visible = () => !d.meta?.hidden;
                const st = () => resolveDrawingStyle(d);
                return (
                  <li
                    class={`axis-list-row flex items-center gap-1.5 h-8 px-1 border-b ${
                      selected()
                        ? 'bg-accent/15 border-accent'
                        : 'bg-bg-elev border-border-soft'
                    }`}
                    data-drawing-id={d.id}
                    data-selected={selected() ? '1' : '0'}
                  >
                    <VisibilityToggle
                      label={label()}
                      visible={visible()}
                      onToggle={() => props.onToggleVisible(d)}
                    />
                    <span
                      class="w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-border-soft"
                      style={{ background: st().color }}
                      title={st().color}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      class="min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                      aria-pressed={selected()}
                      title="Select on chart"
                      onClick={() => props.onSelect(d.id)}
                    >
                      <div
                        class={`truncate font-medium leading-tight ${
                          selected() ? 'text-accent' : 'text-text'
                        }`}
                      >
                        {label()}
                      </div>
                      <div class="text-[0.78em] text-text-faint font-mono truncate">
                        {toolLabel(d.kind)}
                        {st().locked ? ' · locked' : ''}
                      </div>
                    </button>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
                      title="Remove drawing"
                      aria-label={`Remove ${label()}`}
                      onClick={() => props.onRemove(d.id)}
                    >
                      <Icons.x />
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>

      <p class="px-1 m-0 text-[0.78em] text-text-faint">
        Script drawings refresh on each run (not listed).
      </p>
    </div>
  );
};
