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
 * Layers panel — panes, indicators, user drawings visibility/management.
 *
 * User drawings are listed individually, selectable (syncs chart selection),
 * hideable per-item, and removable. Visibility toggles hit both store and
 * chart manager / drawing layer.
 *
 * FloatableShell id `layers`. Script settings opens per applied indicator.
 */

import { Component, For, Show } from 'solid-js';
import {
  store,
  isPanelOpen,
  setPaneVisible,
  toggleIndicator,
  removeIndicator,
  clearDrawings,
  openScriptSettings,
  setSelectedDrawingId,
  setDrawingTool,
  deleteDrawing,
  patchDrawing,
} from '../store';
import { getManager, getActiveDrawingLayer } from '../chart/manager-access';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import {
  toolLabel,
  resolveDrawingStyle,
  type Drawing,
} from '../chart/drawing-types';

/** Pane / indicator / drawing visibility and remove actions. */
export const LayerPanel: Component = () => {
  const togglePane = (id: string, next: boolean) => {
    setPaneVisible(id, next);
    getManager()?.setVisible(id, next);
  };

  const onToggleIndicator = (id: string, paneId: string, currentlyVisible: boolean) => {
    toggleIndicator(id);
    const manager = getManager();
    if (!manager) return;
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

  const syncLayerDrawings = (list: Drawing[]) => {
    const layer = getActiveDrawingLayer();
    if (layer) {
      try {
        layer.setDrawings(list);
      } catch {
        /* ignore */
      }
    }
  };

  const onClearDrawings = () => {
    if (store.drawings.length && !confirm('Clear all user drawings?')) return;
    clearDrawings();
    setSelectedDrawingId(null);
    syncLayerDrawings([]);
  };

  /** Select drawing in store + live layer (shows handles on chart). */
  const onSelectDrawing = (id: string) => {
    setSelectedDrawingId(id);
    setDrawingTool('cursor');
    const layer = getActiveDrawingLayer();
    if (layer) {
      try {
        layer.setTool('cursor');
        layer.setSelectedId(id);
      } catch {
        /* ignore */
      }
    }
  };

  const onToggleDrawingVisible = (d: Drawing) => {
    const hidden = !d.meta?.hidden;
    const nextMeta = { ...(d.meta || {}), hidden };
    patchDrawing(d.id, { meta: nextMeta } as Partial<Drawing>);
    const nextList = store.drawings.map((x) =>
      x.id === d.id ? ({ ...x, meta: nextMeta } as Drawing) : x,
    );
    syncLayerDrawings(nextList);
    // Re-apply selection paint after hide toggle
    if (store.selectedDrawingId === d.id) {
      getActiveDrawingLayer()?.setSelectedId(d.id);
    }
  };

  const onRemoveDrawing = (id: string) => {
    deleteDrawing(id);
    const layer = getActiveDrawingLayer();
    if (layer) {
      try {
        const next = store.drawings.slice();
        layer.setDrawings(next);
        if (layer.getSelectedId() === id) layer.setSelectedId(null);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <Show when={isPanelOpen('layers') || store.layerPanel.open}>
      <FloatableShell id="layers" testId="axis-layers">
        <div class="flex-1 overflow-y-auto min-h-0 p-2 text-[0.85em] flex flex-col gap-2">
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
            <div class="flex items-center justify-between gap-2 px-1 py-0.5 mb-0.5">
              <span class="text-text-dim">
                User drawings{' '}
                <span class="text-text-faint font-mono">({store.drawings.length})</span>
              </span>
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
                disabled={!store.drawings.length}
                title="Clear user drawings"
                onClick={onClearDrawings}
              >
                Clear
              </button>
            </div>
            <Show
              when={store.drawings.length > 0}
              fallback={
                <Empty>No user drawings. Use the left tool rail to place shapes.</Empty>
              }
            >
              <For each={store.drawings}>
                {(d) => {
                  const selected = () => store.selectedDrawingId === d.id;
                  const visible = () => !d.meta?.hidden;
                  const st = () => resolveDrawingStyle(d);
                  return (
                    <div
                      class={`flex items-center gap-1.5 px-1 py-1 border cursor-pointer transition-colors ${
                        selected()
                          ? 'bg-accent/15 border-accent'
                          : 'bg-bg-elev border-border-soft hover:border-border'
                      }`}
                      data-drawing-id={d.id}
                      data-selected={selected() ? '1' : '0'}
                      role="button"
                      tabIndex={0}
                      title="Click to select on chart"
                      onClick={() => onSelectDrawing(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectDrawing(d.id);
                        }
                      }}
                    >
                      <button
                        type="button"
                        class={`w-5 h-5 text-[0.75em] flex items-center justify-center border-2 flex-shrink-0 ${
                          visible()
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-border bg-bg-hover text-text-dim'
                        }`}
                        title={visible() ? 'Hide' : 'Show'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleDrawingVisible(d);
                        }}
                      >
                        {visible() ? '●' : '○'}
                      </button>
                      <span
                        class="w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-border-soft"
                        style={{ background: st().color }}
                        title={st().color}
                      />
                      <div class="min-w-0 flex-1">
                        <div
                          class={`truncate font-medium leading-tight ${
                            selected() ? 'text-accent' : 'text-text'
                          }`}
                        >
                          {drawingListLabel(d)}
                        </div>
                        <div class="text-[0.78em] text-text-faint font-mono truncate">
                          {toolLabel(d.kind)}
                          {st().locked ? ' · locked' : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
                        title="Remove drawing"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveDrawing(d.id);
                        }}
                      >
                        <Icons.x />
                      </button>
                    </div>
                  );
                }}
              </For>
            </Show>
            <div class="px-1 mt-1 text-[0.78em] text-text-faint">
              Script drawings refresh on each run (not listed).
            </div>
          </Section>
        </div>
      </FloatableShell>
    </Show>
  );
};

/** Short human label for a drawing row. */
function drawingListLabel(d: Drawing): string {
  switch (d.kind) {
    case 'hline':
      return `H · ${Number(d.price).toFixed(2)}`;
    case 'vline':
      return `V · ${formatBarTime(d.time)}`;
    case 'text':
      return (d.text || d.meta?.text || 'Text').slice(0, 32);
    case 'measure': {
      const dp = d.p2.price - d.p1.price;
      return `Δ ${dp >= 0 ? '+' : ''}${dp.toFixed(2)}`;
    }
    case 'fib':
      return `Fib · ${Math.min(d.p1.price, d.p2.price).toFixed(0)}–${Math.max(d.p1.price, d.p2.price).toFixed(0)}`;
    case 'trend':
    case 'ray':
    case 'extend':
    case 'arrow':
      return `${toolLabel(d.kind)} · ${d.p1.price.toFixed(1)}→${d.p2.price.toFixed(1)}`;
    case 'rect':
    case 'ellipse':
      return toolLabel(d.kind);
    default:
      return toolLabel((d as Drawing).kind);
  }
}

function formatBarTime(t: number): string {
  if (!Number.isFinite(t)) return '—';
  // unix seconds vs ms
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(t);
  }
}

const Section: Component<{ title: string; children: any }> = (props) => (
  <div>
    <div class="text-[0.78em] uppercase tracking-wider text-text-faint font-semibold mb-1 px-0.5">
      {props.title}
    </div>
    <div class="flex flex-col gap-0.5">{props.children}</div>
  </div>
);

const Empty: Component<{ children: any }> = (props) => (
  <div class="text-text-faint italic px-1 py-1 text-[0.85em]">{props.children}</div>
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
      class={`w-5 h-5 text-[0.75em] flex items-center justify-center border-2 flex-shrink-0 ${
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
        <div class="text-[0.78em] text-text-faint font-mono truncate">{props.sub}</div>
      </Show>
    </div>
    <Show when={props.onSettings}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1"
        title="Script settings"
        onClick={props.onSettings}
      >
        <Icons.settings />
      </button>
    </Show>
    <Show when={props.onRemove}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
        title="Remove"
        onClick={props.onRemove}
      >
        <Icons.x />
      </button>
    </Show>
  </div>
);
