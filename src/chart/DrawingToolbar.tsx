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
 * TV-like left drawing rail for AXIS charts.
 *
 * ## Layout
 * - Vertical **tool groups** from {@link TOOL_GROUPS} (select / lines / fib / …)
 * - Per-group **flyouts** when `g.flyout` is set; otherwise click activates last tool
 * - Utility toggles: magnet (cycle), stay-in-mode, lock-all, hide drawings
 * - Delete selected / clear all
 * - Floating **style bar** (colors, width, line style, rect fill) when a place tool
 *   is active or a drawing is selected
 *
 * ## Store ↔ layer sync
 * Store owns persisted tool, drawings, prefs, and UI flags. The active
 * {@link DrawingLayer} is reached via `getActiveDrawingLayer()` (singleton set when
 * the layer constructs). Toolbar writes both sides on user actions; a reactive
 * effect also pushes `drawingUi` / `drawingPrefs` into the layer when store changes.
 * Style edits on a selection dual-write legacy flat fields + nested `style`.
 */

import { Component, For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import {
  store,
  setDrawingTool,
  clearDrawings,
  setDrawingPrefs,
  setDrawingUi,
  patchDrawing,
  setDrawings,
} from '../store';
import type { DrawingToolId, DrawingLineStyle } from './drawing-types';
import { toolLabel, resolveDrawingStyle, DRAWING_COLORS } from './drawing-types';
import { Icons } from '../ui/icons';
import { getActiveDrawingLayer } from './drawing-layer';
import {
  TOOL_GROUPS,
  defaultToolForGroup,
  groupForTool,
  type ToolGroupId,
} from './drawings/tool-catalog';
import { cloneDrawings, mergeDrawings } from './drawings/sync';

const COLOR_PRESETS = [
  DRAWING_COLORS.default,
  DRAWING_COLORS.up,
  DRAWING_COLORS.down,
  DRAWING_COLORS.measure,
  '#eceef4',
  '#8b8e9c',
] as const;

const WIDTHS = [1, 1.5, 2, 3] as const;
const LINE_STYLES: DrawingLineStyle[] = ['solid', 'dashed', 'dotted'];

const TOOL_ICONS: Partial<Record<DrawingToolId, typeof Icons.cursor>> = {
  cursor: Icons.cursor,
  hline: Icons.minus,
  vline: Icons.vline,
  trend: Icons.trend,
  ray: Icons.ray,
  extend: Icons.extend,
  rect: Icons.square,
  ellipse: Icons.circle,
  arrow: Icons.arrowUpRight,
  fib: Icons.fib,
  measure: Icons.ruler,
  text: Icons.type,
};

const GROUP_ICONS: Partial<Record<ToolGroupId, typeof Icons.cursor>> = {
  select: Icons.cursor,
  lines: Icons.trend,
  fib: Icons.fib,
  shapes: Icons.shapes,
  annotation: Icons.pencil,
  measure: Icons.ruler,
  trading: Icons.trend,
  actions: Icons.settings,
};

/**
 * Push toolbar-relevant store fields onto the live layer (no-op if layer not ready).
 * Called from the reactive effect and after tool selection.
 */
function syncLayerFromStore() {
  const layer = getActiveDrawingLayer();
  if (!layer) return;
  // Prefer setters that no-op when unchanged (hideDrawings already does).
  layer.setMagnet(store.drawingUi.magnet);
  layer.setStayInMode(store.drawingUi.stayInMode);
  layer.setLockAll(store.drawingUi.lockAll);
  layer.setHideDrawings(store.drawingUi.hideDrawings);
  layer.setStylePrefs({
    color: store.drawingPrefs.color,
    width: store.drawingPrefs.width,
    lineStyle: store.drawingPrefs.lineStyle,
    fillOpacity: store.drawingPrefs.fillOpacity,
  });
}

/**
 * Left-rail drawing chrome over the price pane.
 * Mounted by the chart shell; expects `ensureDrawingLayer` to have run for full interactivity.
 */
export const DrawingToolbar: Component = () => {
  const active = () => store.drawingTool;
  /** Which flyout menu is open (`null` = none). */
  const [openGroup, setOpenGroup] = createSignal<ToolGroupId | null>(null);

  const selected = createMemo(() => {
    const id = store.selectedDrawingId;
    if (!id) return null;
    return store.drawings.find((d) => d.id === id) ?? null;
  });

  /** Style bar for place tools, or when something is selected under cursor. */
  const showStyleBar = () => active() !== 'cursor' || !!selected();

  /**
   * Controls target either the selected drawing's resolved style or store defaults
   * for the next placement (`mode: 'defaults' | 'selection'`).
   */
  const styleTarget = createMemo(() => {
    const sel = selected();
    if (sel) {
      const st = resolveDrawingStyle(sel);
      return {
        mode: 'selection' as const,
        color: st.color,
        width: st.width,
        lineStyle: st.lineStyle,
        fillOpacity: st.fillOpacity,
        locked: st.locked,
      };
    }
    return {
      mode: 'defaults' as const,
      color: store.drawingPrefs.color,
      width: store.drawingPrefs.width,
      lineStyle: store.drawingPrefs.lineStyle,
      fillOpacity: store.drawingPrefs.fillOpacity,
      locked: false,
    };
  });

  createEffect(() => {
    // Track each field so Solid re-runs when any drawingUi / drawingPrefs value changes.
    void store.drawingUi.magnet;
    void store.drawingUi.stayInMode;
    void store.drawingUi.lockAll;
    void store.drawingUi.hideDrawings;
    void store.drawingPrefs.color;
    void store.drawingPrefs.width;
    void store.drawingPrefs.lineStyle;
    void store.drawingPrefs.fillOpacity;
    syncLayerFromStore();
  });

  // Close flyout on outside click / Escape
  createEffect(() => {
    if (!openGroup()) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-drawing-flyout]') || t?.closest?.('[data-drawing-group]')) return;
      setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    });
  });

  /** Activate a tool in store + layer; remember it as the group's last tool. */
  const selectTool = (id: DrawingToolId) => {
    setDrawingTool(id);
    getActiveDrawingLayer()?.setTool(id);
    const g = groupForTool(id);
    if (g) {
      setDrawingUi({ lastToolByGroup: { [g.id]: id } });
    }
    setOpenGroup(null);
    syncLayerFromStore();
  };

  /**
   * Group button: open/close flyout, or immediately select last/default tool
   * for non-flyout groups (e.g. select → cursor).
   */
  const onGroupClick = (groupId: ToolGroupId) => {
    const g = TOOL_GROUPS.find((x) => x.id === groupId);
    if (!g || !g.tools.length) return;
    if (g.flyout) {
      if (openGroup() === groupId) {
        setOpenGroup(null);
        return;
      }
      setOpenGroup(groupId);
      return;
    }
    const last = store.drawingUi.lastToolByGroup[groupId] as DrawingToolId | undefined;
    const tool =
      last && g.tools.includes(last) ? last : defaultToolForGroup(groupId) || g.tools[0]!;
    selectTool(tool);
  };

  /**
   * Apply style either to the selected drawing (dual legacy + `style` patch)
   * or to `drawingPrefs` for the next create. Always mirrors onto the layer.
   */
  const applyStyle = (patch: {
    color?: string;
    width?: number;
    lineStyle?: DrawingLineStyle;
    fillOpacity?: number;
  }) => {
    const sel = selected();
    if (sel) {
      const next = {
        ...(patch.color != null ? { color: patch.color } : {}),
        ...(patch.width != null ? { lineWidth: patch.width } : {}),
        ...(patch.lineStyle != null ? { lineStyle: patch.lineStyle } : {}),
        ...(patch.fillOpacity != null ? { fillOpacity: patch.fillOpacity } : {}),
        style: {
          ...(sel.style || {}),
          ...(patch.color != null ? { color: patch.color } : {}),
          ...(patch.width != null ? { width: patch.width } : {}),
          ...(patch.lineStyle != null ? { lineStyle: patch.lineStyle } : {}),
        },
      };
      patchDrawing(sel.id, next);
      getActiveDrawingLayer()?.updateSelected(next);
      return;
    }
    setDrawingPrefs(patch);
    getActiveDrawingLayer()?.setStylePrefs(patch);
  };

  const iconPx = 18;
  const btnClass =
    'sc-btn sc-btn-ghost w-9 h-9 min-w-9 min-h-9 p-0 flex items-center justify-center border border-transparent';

  const railGroups = () =>
    TOOL_GROUPS.filter((g) => g.id !== 'actions' && g.id !== 'trading' && g.tools.length > 0);

  return (
    <div class="absolute left-2 top-10 z-20 flex items-start gap-1.5 pointer-events-none">
      {/* Left rail */}
      <div
        class="pointer-events-auto flex flex-col gap-0.5 p-1 bg-bg-panel/95 border border-border rounded-[var(--radius-sc)]"
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation="vertical"
        data-testid="axis-drawing-toolbar"
      >
        <For each={railGroups()}>
          {(g) => {
            const primaryId = () => {
              const last = store.drawingUi.lastToolByGroup[g.id] as DrawingToolId | undefined;
              if (last && g.tools.includes(last)) return last;
              return g.tools[0]!;
            };
            const GIcon = () => {
              const tid = primaryId();
              return TOOL_ICONS[tid] || GROUP_ICONS[g.id] || Icons.cursor;
            };
            const isActive = () => g.tools.includes(active());
            return (
              <div class="relative" data-drawing-group={g.id}>
                <button
                  type="button"
                  class={`${btnClass} ${
                    isActive() ? 'bg-accent/10 text-accent border-accent' : 'text-text-dim'
                  }`}
                  title={
                    g.flyout
                      ? `${g.label} · ${toolLabel(primaryId())} · click for tools`
                      : toolLabel(primaryId())
                  }
                  aria-label={g.label}
                  aria-pressed={isActive()}
                  aria-haspopup={g.flyout ? 'menu' : undefined}
                  aria-expanded={g.flyout ? openGroup() === g.id : undefined}
                  onClick={() => onGroupClick(g.id)}
                >
                  {(() => {
                    const I = GIcon();
                    return <I size={iconPx} strokeWidth={2.25} />;
                  })()}
                  <Show when={g.flyout}>
                    <span class="absolute right-0.5 bottom-0.5 text-text-faint opacity-80">
                      <Icons.chevronRight size={8} strokeWidth={2.5} />
                    </span>
                  </Show>
                </button>
                <Show when={g.flyout && openGroup() === g.id}>
                  <div
                    class="absolute left-full top-0 ml-1 min-w-[9.5em] p-1 flex flex-col gap-0.5 bg-bg-elev border border-border rounded-[var(--radius-input)] shadow-lg z-50"
                    role="menu"
                    data-drawing-flyout
                  >
                    <For each={g.tools}>
                      {(tid) => {
                        const I = TOOL_ICONS[tid] || Icons.cursor;
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={active() === tid}
                            class={`flex items-center gap-2 w-full px-2 py-1.5 text-left text-[12px] rounded-[var(--radius-sm)] border-0 bg-transparent cursor-pointer font-inherit ${
                              active() === tid
                                ? 'text-accent bg-accent/10 font-semibold'
                                : 'text-text-dim hover:bg-bg-hover hover:text-text'
                            }`}
                            onClick={() => selectTool(tid)}
                          >
                            <I size={15} strokeWidth={2.25} />
                            <span>{toolLabel(tid)}</span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>

        <div class="h-px bg-border-soft my-0.5" />

        <button
          type="button"
          class={`${btnClass} relative ${
            store.drawingUi.magnet !== 'off' ? 'text-accent' : 'text-text-dim'
          }`}
          title={`Magnet: ${store.drawingUi.magnet} (click to cycle off → weak → strong)`}
          aria-label={`Magnet snap: ${store.drawingUi.magnet}`}
          aria-pressed={store.drawingUi.magnet !== 'off'}
          onClick={() => {
            const order = ['off', 'weak', 'strong'] as const;
            const i = order.indexOf(store.drawingUi.magnet);
            const next = order[(i + 1) % order.length]!;
            setDrawingUi({ magnet: next });
            getActiveDrawingLayer()?.setMagnet(next);
          }}
        >
          <Icons.magnet size={iconPx} strokeWidth={2.25} />
          <Show when={store.drawingUi.magnet === 'weak' || store.drawingUi.magnet === 'strong'}>
            <span class="absolute -top-0.5 -right-0.5 text-[8px] font-mono font-bold leading-none text-accent">
              {store.drawingUi.magnet === 'strong' ? 'S' : 'W'}
            </span>
          </Show>
        </button>
        <button
          type="button"
          class={`${btnClass} ${store.drawingUi.stayInMode ? 'text-accent' : 'text-text-dim'}`}
          title="Stay in drawing mode"
          aria-pressed={store.drawingUi.stayInMode}
          onClick={() => {
            const next = !store.drawingUi.stayInMode;
            setDrawingUi({ stayInMode: next });
            getActiveDrawingLayer()?.setStayInMode(next);
          }}
        >
          <Icons.pin size={iconPx} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          class={`${btnClass} ${store.drawingUi.lockAll ? 'text-accent' : 'text-text-dim'}`}
          title="Lock all drawings"
          aria-pressed={store.drawingUi.lockAll}
          onClick={() => {
            const next = !store.drawingUi.lockAll;
            setDrawingUi({ lockAll: next });
            getActiveDrawingLayer()?.setLockAll(next);
          }}
        >
          {store.drawingUi.lockAll ? (
            <Icons.lock size={iconPx} strokeWidth={2.25} />
          ) : (
            <Icons.unlock size={iconPx} strokeWidth={2.25} />
          )}
        </button>
        <button
          type="button"
          class={`${btnClass} ${store.drawingUi.hideDrawings ? 'text-accent' : 'text-text-dim'}`}
          title="Hide drawings (selected still visible)"
          aria-pressed={store.drawingUi.hideDrawings}
          aria-label={store.drawingUi.hideDrawings ? 'Show drawings' : 'Hide drawings'}
          onClick={() => {
            const next = !store.drawingUi.hideDrawings;
            setDrawingUi({ hideDrawings: next });
            getActiveDrawingLayer()?.setHideDrawings(next);
          }}
        >
          {store.drawingUi.hideDrawings ? (
            <Icons.eyeOff size={iconPx} strokeWidth={2.25} />
          ) : (
            <Icons.eye size={iconPx} strokeWidth={2.25} />
          )}
        </button>

        <div class="h-px bg-border-soft my-0.5" />

        <button
          type="button"
          class={`${btnClass} text-text-dim disabled:opacity-40`}
          title="Duplicate all drawings with new IDs (template). Drawings are already shared across multi-chart slots."
          aria-label="Duplicate drawings"
          data-testid="axis-drawing-duplicate"
          disabled={store.drawings.length === 0}
          onClick={() => {
            if (!store.drawings.length) return;
            const clones = cloneDrawings(store.drawings, { symbol: store.symbol });
            const next = mergeDrawings(store.drawings, clones, 'append');
            setDrawings(next);
            getActiveDrawingLayer()?.setDrawings(next);
          }}
        >
          <Icons.copy size={iconPx} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          class={`${btnClass} text-text-dim disabled:opacity-40`}
          title="Delete selected (Del / Backspace)"
          aria-label="Delete selected drawing"
          disabled={!store.selectedDrawingId}
          onClick={() => getActiveDrawingLayer()?.deleteSelected()}
        >
          <Icons.trash size={iconPx} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          class={`${btnClass} text-text-dim disabled:opacity-40`}
          title="Clear all drawings"
          aria-label="Clear all drawings"
          disabled={store.drawings.length === 0}
          onClick={() => {
            if (store.drawings.length && !confirm('Clear all drawings?')) return;
            getActiveDrawingLayer()?.clearAll();
            clearDrawings();
          }}
        >
          <Icons.eraser size={iconPx} strokeWidth={2.25} />
        </button>

        <Show when={store.drawings.length > 0}>
          <span
            class="text-[10px] font-mono text-text-faint text-center py-0.5 tabular-nums"
            title="Drawing count"
          >
            {store.drawings.length}
          </span>
        </Show>
      </div>

      {/* Floating style bar */}
      <Show when={showStyleBar()}>
        <div
          class="pointer-events-auto flex items-center gap-1 px-1.5 py-1 bg-bg-panel/95 border border-border rounded-[var(--radius-sc)]"
          role="toolbar"
          aria-label="Drawing style"
          data-testid="axis-drawing-stylebar"
        >
          <For each={[...COLOR_PRESETS]}>
            {(c) => (
              <button
                type="button"
                class="w-5 h-5 rounded-sm border border-border-soft shrink-0 p-0 cursor-pointer"
                style={{
                  'background-color': c,
                  'box-shadow':
                    styleTarget().color.toLowerCase() === c.toLowerCase()
                      ? 'inset 0 0 0 1px var(--color-accent)'
                      : 'none',
                }}
                title={c}
                aria-label={`Color ${c}`}
                onClick={() => applyStyle({ color: c })}
              />
            )}
          </For>

          <span class="w-px h-5 bg-border-soft mx-0.5" />

          <For each={[...WIDTHS]}>
            {(w) => (
              <button
                type="button"
                class={`${btnClass} !w-7 !h-7 !min-w-7 !min-h-7 text-[10px] font-mono ${
                  Math.abs(styleTarget().width - w) < 0.01
                    ? 'text-accent border-accent'
                    : 'text-text-dim'
                }`}
                title={`Width ${w}`}
                aria-pressed={Math.abs(styleTarget().width - w) < 0.01}
                onClick={() => applyStyle({ width: w })}
              >
                {w === 1.5 ? '1½' : w}
              </button>
            )}
          </For>

          <span class="w-px h-5 bg-border-soft mx-0.5" />

          <For each={LINE_STYLES}>
            {(ls) => (
              <button
                type="button"
                class={`${btnClass} !w-7 !h-7 !min-w-7 !min-h-7 ${
                  styleTarget().lineStyle === ls ? 'text-accent border-accent' : 'text-text-dim'
                }`}
                title={ls}
                aria-pressed={styleTarget().lineStyle === ls}
                onClick={() => applyStyle({ lineStyle: ls })}
              >
                <span
                  class="block w-4 border-t border-current"
                  style={{
                    'border-style':
                      ls === 'dashed' ? 'dashed' : ls === 'dotted' ? 'dotted' : 'solid',
                    'border-width': '0 0 2px 0',
                  }}
                />
              </button>
            )}
          </For>

          <Show
            when={
              active() === 'rect' ||
              active() === 'ellipse' ||
              selected()?.kind === 'rect' ||
              selected()?.kind === 'ellipse'
            }
          >
            <span class="w-px h-5 bg-border-soft mx-0.5" />
            <label class="flex items-center gap-1 text-[10px] text-text-faint px-0.5" title="Fill opacity">
              <span>Fill</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                class="w-14 sc-range"
                value={Math.round(styleTarget().fillOpacity * 100)}
                onInput={(e) =>
                  applyStyle({ fillOpacity: Number(e.currentTarget.value) / 100 })
                }
              />
            </label>
          </Show>

          <Show when={styleTarget().mode === 'selection'}>
            <span class="w-px h-5 bg-border-soft mx-0.5" />
            <span class="text-[10px] text-text-faint px-1 uppercase tracking-wider">sel</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};
