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
 * Layers panel — show/hide panes, indicators, and clear drawings.
 */

import { Component, For, Show } from 'solid-js';
import {
  store,
  setLayerPanelOpen,
  setPaneVisible,
  toggleIndicator,
  removeIndicator,
  clearDrawings,
  openScriptSettings,
} from '../store';
import { getManager, getActiveDrawingLayer } from '../chart/manager-access';
import { Icons } from './icons';

export const LayerPanel: Component = () => {
  const togglePane = (id: string, next: boolean) => {
    setPaneVisible(id, next);
    getManager()?.setVisible(id, next);
  };

  const onToggleIndicator = (id: string, paneId: string, currentlyVisible: boolean) => {
    toggleIndicator(id);
    const manager = getManager();
    if (!manager) return;
    // Hide: strip overlays; show: user re-runs (visibility flag for list)
    if (currentlyVisible) {
      try {
        manager.removeOverlays(paneId);
      } catch {
        /* ignore */
      }
    }
  };

  const onRemoveIndicator = (id: string, paneId: string) => {
    const manager = getManager();
    if (manager) {
      try {
        manager.removeOverlays(paneId);
        if (paneId !== 'price' && paneId !== 'volume') {
          manager.destroyPane(paneId);
        }
      } catch {
        /* ignore */
      }
    }
    removeIndicator(id);
  };

  const onClearDrawings = () => {
    if (store.drawings.length && !confirm('Clear all user drawings?')) return;
    clearDrawings();
    const layer = getActiveDrawingLayer();
    if (layer) {
      try {
        layer.setDrawings([]);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <Show when={store.layerPanel.open}>
      <aside
        class="absolute bottom-12 left-2 z-30 flex flex-col bg-bg-panel/95 border-2 border-border shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-sm max-h-[min(380px,60vh)] w-[220px] pointer-events-auto"
        data-testid="axis-layers"
        aria-label="Layers"
      >
        <div class="flex items-center justify-between px-2 py-1.5 border-b-2 border-border text-[10px] text-text-dim uppercase tracking-wider font-semibold flex-shrink-0">
          <span class="inline-flex items-center gap-1">
            <Icons.layers size={12} />
            Layers
          </span>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5"
            title="Close layers"
            aria-label="Close layers"
            onClick={() => setLayerPanelOpen(false)}
          >
            <Icons.x size={12} />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto min-h-0 p-2 text-[11px] flex flex-col gap-2">
          <Section title="Panes">
            <For each={[...store.panes].sort((a, b) => a.order - b.order)}>
              {(pane) => (
                <LayerRow
                  label={pane.label || pane.id}
                  sub={pane.type}
                  visible={pane.visible}
                  onToggle={() => togglePane(pane.id, !pane.visible)}
                  locked={pane.id === 'price'}
                />
              )}
            </For>
          </Section>

          <Section title="Indicators">
            <Show
              when={store.scripts.length > 0}
              fallback={<Empty>No scripts on chart. Run Pine to add layers.</Empty>}
            >
              <For each={store.scripts}>
                {(ind) => (
                  <LayerRow
                    label={ind.name}
                    sub={ind.paneId}
                    visible={ind.visible}
                    onToggle={() => onToggleIndicator(ind.id, ind.paneId, ind.visible)}
                    onSettings={() => openScriptSettings(ind.id)}
                    onRemove={() => onRemoveIndicator(ind.id, ind.paneId)}
                  />
                )}
              </For>
            </Show>
          </Section>

          <Section title="Drawings">
            <div class="flex items-center justify-between gap-2 px-1 py-0.5">
              <span class="text-text-dim">
                User drawings{' '}
                <span class="text-text-faint font-mono">({store.drawings.length})</span>
              </span>
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-1.5 text-[10px]"
                disabled={!store.drawings.length}
                title="Clear user drawings"
                onClick={onClearDrawings}
              >
                Clear
              </button>
            </div>
            <div class="px-1 text-[10px] text-text-faint">
              Script drawings refresh on each run.
            </div>
          </Section>
        </div>
      </aside>
    </Show>
  );
};

const Section: Component<{ title: string; children: any }> = (props) => (
  <div>
    <div class="text-[9px] uppercase tracking-wider text-text-faint font-semibold mb-1 px-0.5">
      {props.title}
    </div>
    <div class="flex flex-col gap-0.5">{props.children}</div>
  </div>
);

const Empty: Component<{ children: any }> = (props) => (
  <div class="text-text-faint italic px-1 py-1 text-[10px]">{props.children}</div>
);

const LayerRow: Component<{
  label: string;
  sub?: string;
  visible: boolean;
  locked?: boolean;
  onToggle: () => void;
  onSettings?: () => void;
  onRemove?: () => void;
}> = (props) => (
  <div class="flex items-center gap-1.5 px-1 py-1 bg-bg-elev border border-border-soft hover:border-border">
    <button
      type="button"
      class={`w-5 h-5 text-[10px] flex items-center justify-center border-2 flex-shrink-0 ${
        props.visible
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-border bg-bg-hover text-text-dim'
      } ${props.locked ? 'opacity-50 cursor-not-allowed' : ''}`}
      disabled={props.locked}
      title={props.visible ? 'Hide' : 'Show'}
      onClick={() => !props.locked && props.onToggle()}
    >
      {props.visible ? '●' : '○'}
    </button>
    <div class="min-w-0 flex-1">
      <div class="text-text truncate font-medium leading-tight">{props.label}</div>
      <Show when={props.sub}>
        <div class="text-[9px] text-text-faint font-mono truncate">{props.sub}</div>
      </Show>
    </div>
    <Show when={props.onSettings}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1"
        title="Script settings"
        onClick={props.onSettings}
      >
        <Icons.settings size={11} />
      </button>
    </Show>
    <Show when={props.onRemove}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
        title="Remove"
        onClick={props.onRemove}
      >
        <Icons.x size={11} />
      </button>
    </Show>
  </div>
);
