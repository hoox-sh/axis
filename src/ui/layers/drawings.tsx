// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drawings list inside the Layers panel: active tool, symbol actions, rows.
 *
 * The panel search owns filtering (`filtered`); this component only renders
 * the rows plus the symbol-scoped overflow menu.
 *
 * @module ui/layers/drawings
 */

import { type Component, For, Show, createSignal } from 'solid-js';
import { resolveDrawingStyle, toolLabel, type Drawing } from '../../chart/drawing-types';
import { Icons } from '../icons';
import { drawingListLabel } from './format';
import { LayerEmpty, LayerRow } from './rows';

export const DrawingList: Component<{
  symbol: string;
  /** Drawings for the active symbol (unfiltered). */
  drawings: Drawing[];
  /** Drawings after the panel search. */
  filtered: Drawing[];
  /** Drawings stored for every symbol. */
  totalCount: number;
  selectedId: string | null;
  toolName: string;
  toolActive: boolean;
  /** Active search text (for the no-match message). */
  query: string;
  onDuplicate: () => void;
  onKeepSymbol: () => void;
  onTagSymbol: () => void;
  onClear: () => void;
  onSelect: (id: string) => void;
  onToggleVisible: (d: Drawing) => void;
  onToggleLock: (d: Drawing) => void;
  onRemove: (id: string) => void;
}> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const symbolLabel = () => props.symbol || 'Symbol';
  const hiddenCount = () => props.drawings.filter((d) => d.meta?.hidden).length;

  const runMenu = (fn: () => void) => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div class="ax-layers-drawings">
      <div class="ax-layers-drawings-bar">
        <span
          class="ax-layers-tool-chip"
          classList={{ 'is-active': props.toolActive }}
          title="Active drawing tool — pick tools from the chart toolbar"
          data-testid="axis-layers-active-tool"
        >
          <Icons.cursor size={10} />
          <span class="ax-layers-tool-name">{props.toolName}</span>
        </span>
        <Show when={props.selectedId}>
          <span class="ax-layers-selected-chip" title="Selection is synced with the chart">
            selected
          </span>
        </Show>
        <span class="ax-layers-spacer" />
        <Show when={hiddenCount() > 0}>
          <span class="ax-layers-badge" title="Hidden drawings stay stored and can be shown again">
            {hiddenCount()} hidden
          </span>
        </Show>
        <button
          type="button"
          class="ax-layers-icon"
          classList={{ 'is-on': menuOpen() }}
          title="Drawing actions"
          aria-label="Drawing actions"
          aria-expanded={menuOpen()}
          data-testid="axis-layers-drawings-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icons.menu size={11} />
        </button>
      </div>

      <Show when={menuOpen()}>
        <div class="ax-layers-menu" data-testid="axis-layers-drawings-menu-row">
          <button
            type="button"
            disabled={!props.drawings.length}
            title={`Duplicate drawings for ${symbolLabel()} with new IDs`}
            data-testid="axis-layers-duplicate-drawings"
            onClick={() => runMenu(props.onDuplicate)}
          >
            <Icons.copy size={10} /> Duplicate
          </button>
          <button
            type="button"
            disabled={!props.totalCount}
            title={`Keep only drawings for ${symbolLabel()} (untagged kept; other symbols removed)`}
            data-testid="axis-layers-keep-symbol"
            onClick={() => runMenu(props.onKeepSymbol)}
          >
            <Icons.layers size={10} /> Keep this symbol
          </button>
          <button
            type="button"
            disabled={!props.totalCount}
            title={`Tag all drawings with symbol ${symbolLabel()}`}
            data-testid="axis-layers-tag-symbol"
            onClick={() => runMenu(props.onTagSymbol)}
          >
            <Icons.pin size={10} /> Tag symbol
          </button>
          <button
            type="button"
            class="is-danger"
            disabled={!props.drawings.length}
            title={`Clear drawings for ${symbolLabel()}`}
            data-testid="axis-layers-clear-drawings"
            onClick={() => runMenu(props.onClear)}
          >
            <Icons.trash size={10} /> Clear
          </button>
        </div>
      </Show>

      <Show when={props.totalCount !== props.drawings.length}>
        <p class="ax-layers-note">
          {symbolLabel()} keeps {props.drawings.length} of {props.totalCount} stored drawing
          {props.totalCount === 1 ? '' : 's'} · other symbols keep their own
        </p>
      </Show>

      <Show when={props.drawings.length > 0} fallback={<LayerEmpty>No drawings</LayerEmpty>}>
        <Show
          when={props.filtered.length > 0}
          fallback={
            <LayerEmpty>
              {props.query.trim() ? `No drawings match “${props.query.trim()}”` : 'No drawings'}
            </LayerEmpty>
          }
        >
          <ul class="ax-layers-list" aria-label="Drawings">
            <For each={props.filtered}>
              {(d) => {
                const label = () => drawingListLabel(d);
                const selected = () => props.selectedId === d.id;
                const hidden = () => Boolean(d.meta?.hidden);
                const st = () => resolveDrawingStyle(d);
                return (
                  <li data-drawing-id={d.id} data-selected={selected() ? '1' : '0'}>
                    <LayerRow
                      label={label()}
                      sub={`${toolLabel(d.kind)}${st().locked ? ' · locked' : ''}`}
                      visible={!hidden()}
                      hidden={hidden()}
                      selected={selected()}
                      swatch={st().color}
                      badge={hidden() ? 'hidden' : undefined}
                      onSelect={() => props.onSelect(d.id)}
                      onToggle={() => props.onToggleVisible(d)}
                      isLocked={st().locked}
                      onToggleLock={() => props.onToggleLock(d)}
                      onRemove={() => props.onRemove(d.id)}
                      removeTitle="Remove drawing"
                    />
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>

      <p class="ax-layers-note" title="Pine-created drawings are re-painted on every run">
        Script drawings refresh on each run
      </p>
    </div>
  );
};
