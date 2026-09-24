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
 * Chart-style left drawing rail for AXIS (UX parity with common charting UIs).
 *
 * ## Layout
 * - Tool rail with a drag handle. Dock left (vertical), dock top (horizontal),
 *   or float anywhere over the chart. Docked rails can slide in to the handle.
 * - Tool groups from {@link TOOL_GROUPS} (select / lines / fib / …)
 * - Per-group **flyouts** when `g.flyout` is set. The button face selects the
 *   last tool; the corner arrow inside the button opens the menu.
 * - Utility toggles: magnet (cycle), stay-in-mode, lock-all, hide drawings
 * - Delete selected / clear all
 * - **Style bar** (colors, width, line style, level colors) with its own handle.
 *   It tracks the rail until dragged; double-click the handle restores that.
 *
 * ## Store ↔ layer sync
 * Store owns persisted tool, drawings, prefs, and UI flags. The active
 * {@link DrawingLayer} is reached via `getActiveDrawingLayer()` (singleton set when
 * the layer constructs). Toolbar writes both sides on user actions; a reactive
 * effect also pushes `drawingUi` / `drawingPrefs` into the layer when store changes.
 * Style edits on a selection dual-write legacy flat fields + nested `style`.
 */

import { type Component, For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import {
  store,
  clearDrawingsForSymbol,
  setDrawingTool,
  setDrawingPrefs,
  setDrawingUi,
  patchDrawing,
  setDrawings,
} from '../store';
import type { Drawing, DrawingKind, DrawingToolId } from './drawing-types';
import { toolLabel, resolveDrawingStyle } from './drawing-types';
import { Icons } from '../ui/icons';
import { DrawingToolIcon } from './drawings/tool-icons';
import { levelSwatches } from './drawings/level-palette';
import {
  COLOR_PRESETS,
  GRIP_ICON_PX,
  GRIP_ICON_STROKE,
  LINE_STYLES,
  NUDGE_LARGE_PX,
  NUDGE_PX,
  TOOL_ICON_PX,
  TOOL_ICON_STROKE,
  TOOL_SHORTCUT,
  UTILITY_ICON_PX,
  UTILITY_ICON_STROKE,
  titleWithShortcut,
} from './drawings/toolbar/shortcuts';
import { createToolbarDrag, nudgeDelta } from './drawings/toolbar/use-toolbar-drag';
import { RailBadge, RailSeparator, ToolCaret, ToolRailButton } from './drawings/toolbar/tool-button';
import { ToolFlyout } from './drawings/toolbar/tool-flyout';
import { DockMenu } from './drawings/toolbar/dock-menu';
import {
  LineStyleChip,
  StyleDivider,
  SwatchRow,
  ToggleChip,
  WidthChip,
} from './drawings/toolbar/style-controls';
import {
  autoStylebarPos,
  clampToHost,
  finitePx,
  sanitizeToolbarDock,
  snapToolbarDock,
  type ToolbarDock,
} from './drawings/toolbar/chrome';
import { getActiveDrawingLayer } from './drawing-layer';
import { visibleDrawingsForActiveSymbol, setHideDrawingsAll } from './manager-access';
import {
  TOOL_GROUPS,
  defaultToolForGroup,
  groupForTool,
  type ToolGroupId,
} from './drawings/tool-catalog';
import { cloneDrawings, mergeDrawings } from './drawings/sync';
import {
  arrowEndOf,
  arrowStartOf,
  clampFontSize,
  clampRiskReward,
  defaultFibLevels,
  drawingTextOf,
  fibLevelsOf,
  hasSetting,
  isDrawingKind,
  isFibReversed,
  resolvedPrefsForTool,
  riskRewardOf,
  sanitizeFibLevels,
  showPctOf,
  showPriceOf,
  showStatsOf,
  widthsForKind,
  type KindDrawingPrefs,
} from './drawings/tool-settings';

/** Resolved store/layer style patch for the style bar. */

type StylePatch = KindDrawingPrefs & { text?: string; locked?: boolean };

function settingsKind(tool: DrawingToolId, selectedKind?: string | null): DrawingToolId {
  if (selectedKind && isDrawingKind(selectedKind as DrawingToolId)) {
    return selectedKind as DrawingKind;
  }
  return tool;
}

function buildDrawingPatch(sel: Drawing, patch: StylePatch): Partial<Drawing> {
  const style = { ...(sel.style || {}) };
  const meta = { ...(sel.meta || {}) };
  if (patch.color != null) style.color = patch.color;
  if (patch.width != null) style.width = patch.width;
  if (patch.lineStyle != null) style.lineStyle = patch.lineStyle;
  if (patch.extendLeft != null) style.extendLeft = patch.extendLeft;
  if (patch.extendRight != null) style.extendRight = patch.extendRight;
  if (patch.fontSize != null) style.fontSize = clampFontSize(patch.fontSize);
  if (patch.showPrice != null) meta.showPrice = patch.showPrice;
  if (patch.showPct != null) meta.showPct = patch.showPct;
  if (patch.showStats != null) meta.showStats = patch.showStats;
  if (patch.reverse != null) meta.reverse = patch.reverse;
  if (patch.arrowStart != null) meta.arrowStart = patch.arrowStart;
  if (patch.arrowEnd != null) meta.arrowEnd = patch.arrowEnd;
  if (patch.rr != null) meta.rr = clampRiskReward(patch.rr);
  if (patch.fibLevels != null) meta.fibLevels = sanitizeFibLevels(patch.fibLevels, defaultFibLevels(sel.kind));
  if (patch.multiColor != null) meta.multiColor = patch.multiColor;
  if (patch.levelColors != null) meta.levelColors = { ...patch.levelColors };
  if (patch.locked != null) meta.locked = patch.locked;
  if (patch.text != null) meta.text = patch.text;
  const next: Partial<Drawing> = {
    style,
    meta,
    ...(patch.color != null ? { color: patch.color } : {}),
    ...(patch.width != null ? { lineWidth: patch.width } : {}),
    ...(patch.lineStyle != null ? { lineStyle: patch.lineStyle } : {}),
    ...(patch.fillOpacity != null ? { fillOpacity: patch.fillOpacity } : {}),
    ...(patch.locked != null ? { locked: patch.locked } : {}),
    ...(patch.text != null ? { text: patch.text } : {}),
  };
  return next;
}

/**
 * Push toolbar-relevant store fields onto the live layer (no-op if layer not ready).
 * Called from the reactive effect and after tool selection.
 */
function syncLayerFromStore() {
  setHideDrawingsAll(store.drawingUi.hideDrawings);
  const layer = getActiveDrawingLayer();
  if (!layer) return;
  // Prefer setters that no-op when unchanged (hideDrawings already does).
  layer.setMagnet(store.drawingUi.magnet);
  layer.setStayInMode(store.drawingUi.stayInMode);
  layer.setLockAll(store.drawingUi.lockAll);
  const resolved = resolvedPrefsForTool(store.drawingPrefs, store.drawingTool);
  const { color, width, lineStyle, fillOpacity, ...rest } = resolved;
  layer.setStylePrefs({
    color,
    width,
    lineStyle,
    fillOpacity,
    ...rest,
    fibLevels: rest.fibLevels ? [...rest.fibLevels] : undefined,
    levelColors: rest.levelColors ? { ...rest.levelColors } : undefined,
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
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  /** Per-group inline clamp so tall flyouts never spill past the viewport. */
  const [flyoutClamp, setFlyoutClamp] = createSignal<Partial<Record<ToolGroupId, Record<string, string>>>>(
    {},
  );
  /** Inline clamp for the settings popover (open up vs down + max-height). */
  const [settingsClamp, setSettingsClamp] = createSignal<Record<string, string>>({});
  let rootRef: HTMLDivElement | undefined;
  let railRef: HTMLDivElement | undefined;
  let styleRef: HTMLDivElement | undefined;
  let slideTimer: number | undefined;
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [slideOpen, setSlideOpen] = createSignal(false);
  const [liveTools, setLiveTools] = createSignal<{ x: number; y: number } | null>(null);
  const [liveStyle, setLiveStyle] = createSignal<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = createSignal<'tools' | 'style' | null>(null);
  const [railSize, setRailSize] = createSignal({ w: 46, h: 40 });

  const dock = (): ToolbarDock => sanitizeToolbarDock(store.drawingUi.toolbarDock);
  const slideEnabled = () => dock() !== 'float' && store.drawingUi.toolbarSlide === true;

  const clearSlideTimer = () => {
    if (slideTimer != null) window.clearTimeout(slideTimer);
    slideTimer = undefined;
  };

  onCleanup(() => clearSlideTimer());

  const hostBox = (): DOMRect | null => {
    const host = rootRef?.closest('[data-axis-chart-host]') as HTMLElement | null;
    return host ? host.getBoundingClientRect() : null;
  };

  const railAnchor = () => {
    const live = liveTools();
    if (live) return live;
    if (dock() === 'top') return { x: 8, y: 8 };
    if (dock() === 'float') {
      return {
        x: finitePx(store.drawingUi.toolbarX, 8),
        y: finitePx(store.drawingUi.toolbarY, 56),
      };
    }
    return { x: 8, y: 56 };
  };

  const styleOrigin = () => {
    const live = liveStyle();
    if (live) return live;
    const x = store.drawingUi.stylebarX;
    const y = store.drawingUi.stylebarY;
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
    const rail = railAnchor();
    const size = railSize();
    return autoStylebarPos(dock(), { x: rail.x, y: rail.y, w: size.w, h: size.h });
  };

  const slideState = () => {
    if (!slideEnabled()) return 'open';
    if (slideOpen() || openGroup() || menuOpen() || settingsOpen() || dragging()) return 'open';
    return 'collapsed';
  };

  createEffect(() => {
    dock();
    slideState();
    openGroup();
    queueMicrotask(() => {
      const w = railRef?.offsetWidth ?? 0;
      const h = railRef?.offsetHeight ?? 0;
      if (w < 1 || h < 1) return;
      setRailSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
  });

  const rememberRailSize = (pos: { x: number; y: number }, el: HTMLElement | undefined) => {
    const host = hostBox();
    const box = el?.getBoundingClientRect();
    if (!host || !box) return pos;
    return clampToHost(pos.x, pos.y, host.width, host.height, box.width, box.height);
  };

  let toolPointerHandled = false;

  const resolveToolPos = (dx: number, dy: number) => {
    const host = hostBox();
    const bar = railRef?.getBoundingClientRect();
    if (!host || !bar) return null;
    const anchor = railAnchor();
    return clampToHost(anchor.x + dx, anchor.y + dy, host.width, host.height, bar.width, bar.height);
  };

  const onToolPointerDown = createToolbarDrag(
    (dx, dy) => resolveToolPos(dx, dy),
    {
      onLive: (pos) => setLiveTools(pos),
      onTap: () => {
        toolPointerHandled = true;
        setOpenGroup(null);
        setSettingsOpen(false);
        setMenuOpen((v) => !v);
      },
      onDrop: (moved) => {
        if (!moved) return;
        const pos = liveTools();
        setLiveTools(null);
        if (!pos) return;
        const nextDock = snapToolbarDock(pos.x, pos.y);
        if (nextDock === 'float')
          setDrawingUi({ toolbarDock: 'float', toolbarX: pos.x, toolbarY: pos.y });
        else setDrawingUi({ toolbarDock: nextDock });
        setMenuOpen(false);
      },
    },
    (on) => setDragging(on ? 'tools' : null),
  );

  const onToolKeyDown = (e: KeyboardEvent) => {
    if (dock() !== 'float') return;
    const d = nudgeDelta(e.key, e.shiftKey, NUDGE_PX, NUDGE_LARGE_PX);
    if (!d) return;
    e.preventDefault();
    const cur = railAnchor();
    const next = rememberRailSize({ x: cur.x + d[0], y: cur.y + d[1] }, railRef);
    setDrawingUi({ toolbarDock: 'float', toolbarX: next.x, toolbarY: next.y });
  };

  const resolveStylePos = (dx: number, dy: number) => {
    const host = hostBox();
    const size = styleRef?.getBoundingClientRect();
    if (!host || !size) return null;
    const origin = styleOrigin();
    return clampToHost(
      origin.x + dx,
      origin.y + dy,
      host.width,
      host.height,
      size.width,
      size.height,
    );
  };

  const onStylePointerDown = createToolbarDrag(
    (dx, dy) => resolveStylePos(dx, dy),
    {
      onLive: (pos) => setLiveStyle(pos),
      onDrop: (moved) => {
        if (!moved) return;
        const pos = liveStyle();
        setLiveStyle(null);
        if (!pos) return;
        setDrawingUi({ stylebarX: pos.x, stylebarY: pos.y });
      },
    },
    (on) => setDragging(on ? 'style' : null),
  );

  const resetStylebar = () => {
    setLiveStyle(null);
    setDrawingUi({ stylebarX: null, stylebarY: null });
  };

  const placeFree = () => {
    const pos = rememberRailSize(railAnchor(), railRef);
    setDrawingUi({ toolbarDock: 'float', toolbarX: pos.x, toolbarY: pos.y });
    setMenuOpen(false);
  };

  const selected = createMemo(() => {
    const id = store.selectedDrawingId;
    if (!id) return null;
    return store.drawings.find((d) => d.id === id) ?? null;
  });

  /** Style bar for place tools, or when something is selected under cursor. */
  const showStyleBar = () => active() !== 'cursor' || !!selected();

  const activeKind = createMemo(() => settingsKind(active(), selected()?.kind));

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
        kind: sel.kind,
        color: st.color,
        width: st.width,
        lineStyle: st.lineStyle,
        fillOpacity: st.fillOpacity,
        locked: st.locked,
        extendLeft: st.extendLeft,
        extendRight: st.extendRight,
        fontSize: st.fontSize,
        showPrice: showPriceOf(sel, true),
        showPct: showPctOf(sel, true),
        showStats: showStatsOf(sel, true),
        reverse: isFibReversed(sel),
        arrowStart: arrowStartOf(sel, false),
        arrowEnd: arrowEndOf(sel, sel.kind === 'arrow' || sel.kind === 'forecast'),
        rr: riskRewardOf(sel, 1),
        fibLevels: fibLevelsOf(sel),
        multiColor: sel.meta?.multiColor,
        levelColors:
          sel.meta?.levelColors && typeof sel.meta.levelColors === 'object'
            ? { ...sel.meta.levelColors }
            : {},
        text: drawingTextOf(sel),
      };
    }
    const prefs = resolvedPrefsForTool(store.drawingPrefs, active());
    return {
      mode: 'defaults' as const,
      kind: isDrawingKind(active()) ? active() : ('trend' as DrawingKind),
      color: prefs.color,
      width: prefs.width,
      lineStyle: prefs.lineStyle,
      fillOpacity: prefs.fillOpacity,
      locked: false,
      extendLeft: !!prefs.extendLeft,
      extendRight: !!prefs.extendRight,
      fontSize: prefs.fontSize ?? 12,
      showPrice: prefs.showPrice !== false,
      showPct: prefs.showPct !== false,
      showStats: prefs.showStats !== false,
      reverse: !!prefs.reverse,
      arrowStart: !!prefs.arrowStart,
      arrowEnd: !!prefs.arrowEnd,
      rr: prefs.rr ?? 1,
      fibLevels: prefs.fibLevels ? [...prefs.fibLevels] : [...defaultFibLevels(active())],
      multiColor: prefs.multiColor,
      levelColors: prefs.levelColors ? { ...prefs.levelColors } : {},
      text: '',
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
    void store.drawingPrefs.byKind;
    void store.drawingTool;
    syncLayerFromStore();
  });

  // Close flyout / settings on outside click / Escape
  createEffect(() => {
    if (!openGroup() && !settingsOpen() && !menuOpen()) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-drawing-flyout]') || t?.closest?.('[data-drawing-group]')) return;
      if (t?.closest?.('[data-drawing-settings]')) return;
      if (t?.closest?.('[data-drawing-toolbar-handle]') || t?.closest?.('[data-drawing-dock]')) {
        if (!t?.closest?.('[data-drawing-dock]')) {
          setOpenGroup(null);
          setSettingsOpen(false);
        }
        return;
      }
      setOpenGroup(null);
      setSettingsOpen(false);
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenGroup(null);
        setSettingsOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    });
  });

  /** Measure available space around an anchor within the nearest clipping ancestor. */
  const measureSpace = (
    anchor: HTMLElement | null,
    gap = 8,
    from: 'top' | 'bottom' = 'top',
  ): { below: number; above: number } => {
    if (!anchor) return { below: 0, above: 0 };
    const r = anchor.getBoundingClientRect();
    // The chart slot is overflow-hidden; clamp to the nearest clipping ancestor (or window).
    let limitTop = 0;
    let limitBottom = window.innerHeight;
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      const s = window.getComputedStyle(el);
      if (/(hidden|clip)/.test(`${s.overflow} ${s.overflowY}`)) {
        const c = el.getBoundingClientRect();
        limitTop = Math.max(limitTop, c.top);
        limitBottom = Math.min(limitBottom, c.bottom);
        break;
      }
    }
    const topEdge = from === 'top' ? r.top : r.bottom;
    return {
      below: Math.max(0, limitBottom - topEdge - gap),
      above: Math.max(0, r.bottom - limitTop - gap),
    };
  };

  /** Anchor rect after the popup renders; measured on the group wrapper, not the popup. */
  const scheduleFlyoutClamp = (groupId: ToolGroupId) => {
    requestAnimationFrame(() => {
      const wrap = rootRef?.querySelector<HTMLElement>(`[data-drawing-group="${groupId}"]`);
      if (!wrap) return;
      if (dock() === 'top') {
        const { below } = measureSpace(wrap, 8, 'bottom');
        setFlyoutClamp((prev) => ({
          ...prev,
          [groupId]: {
            top: '100%',
            bottom: 'auto',
            left: '0',
            'margin-top': '4px',
            'max-height': `${Math.max(120, below)}px`,
          },
        }));
        return;
      }
      const { below, above } = measureSpace(wrap);
      setFlyoutClamp((prev) => ({
        ...prev,
        [groupId]:
          below >= 160 || below >= above
            ? { top: '0', bottom: 'auto', 'max-height': `${Math.max(120, below)}px` }
            : { top: 'auto', bottom: '0', 'max-height': `${Math.max(120, above)}px` },
      }));
    });
  };

  const scheduleSettingsClamp = () => {
    requestAnimationFrame(() => {
      const wrap = rootRef?.querySelector<HTMLElement>('[data-drawing-settings]');
      if (!wrap) return;
      const btn = wrap.querySelector<HTMLElement>('button');
      const { below, above } = measureSpace(btn ?? wrap, 8, 'bottom');
      // Popover hangs from `top-full` (down) or `bottom-full`+margin (up).
      setSettingsClamp(
        below >= 200 || below >= above
          ? { top: '100%', bottom: 'auto', 'margin-top': '0.25rem', 'margin-bottom': '0', 'max-height': `${Math.max(120, below)}px` }
          : { top: 'auto', bottom: '100%', 'margin-top': '0', 'margin-bottom': '0.25rem', 'max-height': `${Math.max(120, above)}px` },
      );
    });
  };

  /** Activate a tool in store + layer; remember it as the group's last tool. */
  const selectTool = (id: DrawingToolId) => {
    setDrawingTool(id);
    // force: explicit rail pick cancels an in-progress draft even if same tool
    getActiveDrawingLayer()?.setTool(id, { force: true });
    const g = groupForTool(id);
    if (g) {
      setDrawingUi({ lastToolByGroup: { [g.id]: id } });
    }
    setOpenGroup(null);
    syncLayerFromStore();
  };

  /** Open or close a group's tool menu. The corner arrow calls this. */
  const toggleFlyout = (groupId: ToolGroupId) => {
    const g = TOOL_GROUPS.find((x) => x.id === groupId);
    if (!g || !g.tools.length) return;
    if (g.flyout) {
      if (openGroup() === groupId) {
        setOpenGroup(null);
        return;
      }
      setSettingsOpen(false);
      setMenuOpen(false);
      setOpenGroup(groupId);
      scheduleFlyoutClamp(groupId);
      return;
    }
    const last = store.drawingUi.lastToolByGroup[groupId] as DrawingToolId | undefined;
    const tool =
      last && g.tools.includes(last) ? last : defaultToolForGroup(groupId) || g.tools[0]!;
    selectTool(tool);
  };

  /**
   * Apply style either to the selected drawing (dual legacy + `style` + `meta`)
   * or to `drawingPrefs` / `byKind` for the next create.
   */
  const applyStyle = (patch: StylePatch) => {
    const sel = selected();
    if (sel) {
      const next = buildDrawingPatch(sel, patch);
      const allowLocked = patch.locked != null;
      patchDrawing(sel.id, next);
      getActiveDrawingLayer()?.updateSelected(next, { allowLocked });
      return;
    }
    const tool = active();
    const { text: _text, locked: _locked, ...kindPatch } = patch;
    setDrawingPrefs({
      ...(patch.color != null ? { color: patch.color } : {}),
      ...(patch.width != null ? { width: patch.width } : {}),
      ...(patch.lineStyle != null ? { lineStyle: patch.lineStyle } : {}),
      ...(patch.fillOpacity != null ? { fillOpacity: patch.fillOpacity } : {}),
      ...(isDrawingKind(tool) ? { byKind: { [tool]: kindPatch } } : {}),
    });
    syncLayerFromStore();
  };

  const railGroups = () =>
    TOOL_GROUPS.filter((g) => g.id !== 'actions' && g.tools.length > 0);

  // Memos: the component function runs once. Reading these in JSX keeps dock and drag reactive.
  const anchor = createMemo(railAnchor);
  const styleAt = createMemo(styleOrigin);

  return (
    <div ref={rootRef} class="axis-draw-overlay">
      <div
        class="axis-draw-shell"
        data-dock={dock()}
        data-slide={slideState()}
        data-dragging={dragging() === 'tools' ? 'tools' : undefined}
        data-testid="axis-drawing-toolbar"
        style={{ left: `${anchor().x}px`, top: `${anchor().y}px` }}
        onPointerEnter={() => {
          clearSlideTimer();
          setSlideOpen(true);
        }}
        onPointerLeave={() => {
          clearSlideTimer();
          slideTimer = window.setTimeout(() => setSlideOpen(false), 300);
        }}
      >
      {/* Tool rail */}
      <div
        ref={railRef}
        class="axis-draw-rail"
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation={dock() === 'top' ? 'horizontal' : 'vertical'}
      >
        <div class="relative" data-drawing-dock>
          <button
            type="button"
            class="axis-draw-handle"
            data-testid="axis-drawing-toolbar-handle"
            aria-label="Move drawing tools"
            aria-expanded={menuOpen()}
            aria-haspopup="menu"
            title="Drag to move. Drop on the left or top edge to dock."
            onPointerDown={onToolPointerDown}
            onClick={() => {
              if (toolPointerHandled) {
                toolPointerHandled = false;
                return;
              }
              setOpenGroup(null);
              setSettingsOpen(false);
              setMenuOpen((v) => !v);
            }}
            onKeyDown={onToolKeyDown}
          >
            <Icons.grip size={GRIP_ICON_PX} strokeWidth={GRIP_ICON_STROKE} class="axis-draw-grip" />
          </button>
          <Show when={menuOpen()}>
            <DockMenu
              dock={dock()}
              slideChecked={store.drawingUi.toolbarSlide === true}
              slideDisabled={dock() === 'float'}
              onDock={(d) => {
                setDrawingUi({ toolbarDock: d });
                setMenuOpen(false);
              }}
              onFree={placeFree}
              onSlide={(checked) => setDrawingUi({ toolbarSlide: checked })}
            />
          </Show>
        </div>
        <For each={railGroups()}>
          {(g) => {
            const primaryId = () => {
              const last = store.drawingUi.lastToolByGroup[g.id] as DrawingToolId | undefined;
              if (last && g.tools.includes(last)) return last;
              return g.tools[0]!;
            };
            const isActive = () => g.tools.includes(active());
            return (
              <div
                class="axis-draw-tool"
                classList={{ 'is-active': isActive() }}
                data-drawing-group={g.id}
                data-open={g.flyout && openGroup() === g.id ? '1' : undefined}
              >
                <ToolRailButton
                  title={titleWithShortcut(toolLabel(primaryId()), TOOL_SHORTCUT[primaryId()])}
                  label={toolLabel(primaryId())}
                  active={isActive()}
                  onSelect={() => selectTool(primaryId())}
                >
                  <DrawingToolIcon id={primaryId()} size={TOOL_ICON_PX} strokeWidth={TOOL_ICON_STROKE} />
                </ToolRailButton>
                <Show when={g.flyout}>
                  <ToolCaret
                    label={`More ${g.label} tools`}
                    title={`${g.label} tools`}
                    expanded={openGroup() === g.id}
                    down={dock() === 'top'}
                    onToggle={() => toggleFlyout(g.id)}
                  />
                </Show>
                <Show when={g.flyout && openGroup() === g.id}>
                  <ToolFlyout
                    tools={[...g.tools]}
                    activeId={active()}
                    dockTop={dock() === 'top'}
                    clamp={flyoutClamp()[g.id]}
                    onSelect={(tid) => selectTool(tid)}
                    onClose={() => setOpenGroup(null)}
                  />
                </Show>
              </div>
            );
          }}
        </For>

        <RailSeparator />

        <ToolRailButton
          title={`Magnet: ${store.drawingUi.magnet} (W)`}
          label={`Magnet snap: ${store.drawingUi.magnet}`}
          active={store.drawingUi.magnet !== 'off'}
          onSelect={() => {
            const order = ['off', 'weak', 'strong'] as const;
            const i = order.indexOf(store.drawingUi.magnet);
            const next = order[(i + 1) % order.length]!;
            setDrawingUi({ magnet: next });
            getActiveDrawingLayer()?.setMagnet(next);
          }}
        >
          <Icons.magnet size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
          <Show when={store.drawingUi.magnet === 'weak' || store.drawingUi.magnet === 'strong'}>
            <RailBadge text={store.drawingUi.magnet === 'strong' ? 'S' : 'W'} />
          </Show>
        </ToolRailButton>
        <ToolRailButton
          title="Stay in drawing mode"
          label="Stay in drawing mode"
          active={store.drawingUi.stayInMode}
          onSelect={() => {
            const next = !store.drawingUi.stayInMode;
            setDrawingUi({ stayInMode: next });
            getActiveDrawingLayer()?.setStayInMode(next);
          }}
        >
          <Icons.pin size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
        </ToolRailButton>
        <ToolRailButton
          title="Lock all drawings"
          label="Lock all drawings"
          active={store.drawingUi.lockAll}
          onSelect={() => {
            const next = !store.drawingUi.lockAll;
            setDrawingUi({ lockAll: next });
            getActiveDrawingLayer()?.setLockAll(next);
          }}
        >
          {store.drawingUi.lockAll ? (
            <Icons.lock size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
          ) : (
            <Icons.unlock size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
          )}
        </ToolRailButton>
        <ToolRailButton
          title="Hide drawings (user + Pine; selected user drawings still visible)"
          label={store.drawingUi.hideDrawings ? 'Show drawings' : 'Hide drawings'}
          active={store.drawingUi.hideDrawings}
          onSelect={() => {
            const next = !store.drawingUi.hideDrawings;
            setDrawingUi({ hideDrawings: next });
            setHideDrawingsAll(next);
          }}
        >
          {store.drawingUi.hideDrawings ? (
            <Icons.eyeOff size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
          ) : (
            <Icons.eye size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
          )}
        </ToolRailButton>

        <RailSeparator />

        <ToolRailButton
          title={`Duplicate drawings for ${store.symbol} with new IDs`}
          label="Duplicate drawings"
          testId="axis-drawing-duplicate"
          disabled={visibleDrawingsForActiveSymbol().length === 0}
          onSelect={() => {
            const visible = visibleDrawingsForActiveSymbol();
            if (!visible.length) return;
            const clones = cloneDrawings(visible, { symbol: store.symbol });
            const next = mergeDrawings(store.drawings, clones, 'append');
            setDrawings(next);
            getActiveDrawingLayer()?.setDrawings(
              visibleDrawingsForActiveSymbol(store.symbol),
            );
          }}
        >
          <Icons.copy size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
        </ToolRailButton>
        <ToolRailButton
          title="Delete selected (Delete)"
          label="Delete selected drawing"
          disabled={!store.selectedDrawingId}
          onSelect={() => getActiveDrawingLayer()?.deleteSelected()}
        >
          <Icons.trash size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
        </ToolRailButton>
        <ToolRailButton
          title={`Clear drawings for ${store.symbol}`}
          label="Clear drawings for symbol"
          disabled={visibleDrawingsForActiveSymbol().length === 0}
          onSelect={() => {
            const n = visibleDrawingsForActiveSymbol().length;
            if (n && !confirm(`Clear drawings for ${store.symbol}?`)) return;
            // clearAll emits [] → onChange merges (other symbols kept); also
            // update store directly so UI stays correct if layer is missing
            getActiveDrawingLayer()?.clearAll();
            clearDrawingsForSymbol(store.symbol);
          }}
        >
          <Icons.eraser size={UTILITY_ICON_PX} strokeWidth={UTILITY_ICON_STROKE} />
        </ToolRailButton>

        <Show when={visibleDrawingsForActiveSymbol().length > 0}>
          <span
            class="axis-draw-count"
            title={`Drawings for ${store.symbol}`}
          >
            {visibleDrawingsForActiveSymbol().length}
          </span>
        </Show>
      </div>
      </div>

      <Show when={showStyleBar()}>
        <div
          ref={styleRef}
          class="axis-draw-stylebar"
          data-dragging={dragging() === 'style' ? '1' : undefined}
          role="toolbar"
          aria-label="Drawing style"
          data-testid="axis-drawing-stylebar"
          data-drawing-settings
          style={{
            left: `${styleAt().x}px`,
            top: `${styleAt().y}px`,
            'z-index': dragging() === 'style' ? '40' : undefined,
          }}
        >
            <button
              type="button"
              class="axis-draw-style-handle"
              data-testid="axis-drawing-stylebar-handle"
              aria-label="Move drawing style"
              title="Drag to move. Double-click to dock beside the tools."
              onPointerDown={onStylePointerDown}
              onDblClick={(e) => {
                e.preventDefault();
                resetStylebar();
              }}
            >
              <Icons.grip size={GRIP_ICON_PX} strokeWidth={GRIP_ICON_STROKE} />
            </button>
            <SwatchRow
              colors={COLOR_PRESETS}
              current={styleTarget().color}
              onPick={(c) => applyStyle({ color: c })}
              customValue={
                /^#[0-9a-fA-F]{6}$/.test(styleTarget().color)
                  ? styleTarget().color
                  : '#939fff'
              }
              onCustom={(c) => applyStyle({ color: c })}
            />

            <StyleDivider />

            <For each={[...widthsForKind(activeKind())]}>
              {(w) => (
                <WidthChip
                  width={w}
                  active={Math.abs(styleTarget().width - w) < 0.01}
                  onPick={(next) => applyStyle({ width: next })}
                />
              )}
            </For>

            <StyleDivider />

            <For each={LINE_STYLES}>
              {(ls) => (
                <LineStyleChip
                  style={ls}
                  active={styleTarget().lineStyle === ls}
                  onPick={(next) => applyStyle({ lineStyle: next })}
                />
              )}
            </For>

            <Show when={hasSetting(activeKind(), 'fillOpacity')}>
              <StyleDivider />
              <label class="axis-draw-fill" title="Fill opacity">
                <span>Fill</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  class="axis-draw-range"
                  value={Math.round(styleTarget().fillOpacity * 100)}
                  aria-label="Fill opacity"
                  onInput={(e) =>
                    applyStyle({ fillOpacity: Number(e.currentTarget.value) / 100 })
                  }
                />
              </label>
            </Show>

            <Show when={hasSetting(activeKind(), 'extendLeft')}>
              <ToggleChip
                title="Extend left"
                label="←"
                active={!!styleTarget().extendLeft}
                onToggle={() => applyStyle({ extendLeft: !styleTarget().extendLeft })}
              />
            </Show>
            <Show when={hasSetting(activeKind(), 'extendRight')}>
              <ToggleChip
                title="Extend right"
                label="→"
                active={!!styleTarget().extendRight}
                onToggle={() => applyStyle({ extendRight: !styleTarget().extendRight })}
              />
            </Show>
            <Show when={hasSetting(activeKind(), 'showPrice')}>
              <ToggleChip
                title="Show price / time"
                label="$"
                active={!!styleTarget().showPrice}
                onToggle={() => applyStyle({ showPrice: !styleTarget().showPrice })}
              />
            </Show>

            <Show when={styleTarget().mode === 'selection'}>
              <StyleDivider />
              <button
                type="button"
                class="axis-draw-chip is-settings"
                classList={{ 'is-active': !!styleTarget().locked }}
                title={styleTarget().locked ? 'Unlock drawing' : 'Lock drawing'}
                aria-label={styleTarget().locked ? 'Unlock drawing' : 'Lock drawing'}
                aria-pressed={!!styleTarget().locked}
                onClick={() => applyStyle({ locked: !styleTarget().locked })}
              >
                {styleTarget().locked ? (
                  <Icons.lock size={14} strokeWidth={2.25} />
                ) : (
                  <Icons.unlock size={14} strokeWidth={2.25} />
                )}
              </button>
              <span class="axis-draw-sel">sel</span>
            </Show>

            <StyleDivider />
            <button
              type="button"
              class="axis-draw-chip is-settings"
              classList={{ 'is-active': settingsOpen() }}
              title="Drawing settings"
              aria-label="Drawing settings"
              aria-expanded={settingsOpen()}
              data-testid="axis-drawing-settings"
              onClick={() => {
                setOpenGroup(null);
                setMenuOpen(false);
                setSettingsOpen((v) => {
                  const next = !v;
                  if (next) scheduleSettingsClamp();
                  return next;
                });
              }}
            >
              <Icons.settings size={14} strokeWidth={2.25} />
            </button>

          <Show when={settingsOpen()}>
            <div
              class="axis-draw-pop axis-draw-settings-pop"
              role="dialog"
              aria-label="Drawing settings"
              style={settingsClamp()}
              data-testid="axis-drawing-settings-popover"
            >
              <div class="axis-draw-settings-title">
                {toolLabel(activeKind())}
              </div>

              <Show when={hasSetting(activeKind(), 'text')}>
                <label class="axis-draw-field">
                  Text
                  <input
                    type="text"
                    class="sc-input axis-draw-text-input"
                    value={styleTarget().text}
                    maxlength={200}
                    onChange={(e) => applyStyle({ text: e.currentTarget.value })}
                  />
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'fontSize')}>
                <label class="axis-draw-field is-row">
                  Font size
                  <input
                    type="number"
                    min={8}
                    max={32}
                    step={1}
                    class="sc-input axis-draw-number-input"
                    value={styleTarget().fontSize}
                    onChange={(e) =>
                      applyStyle({ fontSize: clampFontSize(Number(e.currentTarget.value)) })
                    }
                  />
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'showStats')}>
                <label class="axis-draw-check">
                  <input
                    type="checkbox"
                    checked={styleTarget().showStats}
                    onChange={(e) => applyStyle({ showStats: e.currentTarget.checked })}
                  />
                  Show stats
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'showPct')}>
                <label class="axis-draw-check">
                  <input
                    type="checkbox"
                    checked={styleTarget().showPct}
                    onChange={(e) => applyStyle({ showPct: e.currentTarget.checked })}
                  />
                  Show percents
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'arrowStart')}>
                <label class="axis-draw-check">
                  <input
                    type="checkbox"
                    checked={styleTarget().arrowStart}
                    onChange={(e) => applyStyle({ arrowStart: e.currentTarget.checked })}
                  />
                  Arrow at start
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'arrowEnd')}>
                <label class="axis-draw-check">
                  <input
                    type="checkbox"
                    checked={styleTarget().arrowEnd}
                    onChange={(e) => applyStyle({ arrowEnd: e.currentTarget.checked })}
                  />
                  Arrow at end
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'rr')}>
                <label class="axis-draw-field is-row">
                  Risk / reward
                  <input
                    type="number"
                    min={0.25}
                    max={10}
                    step={0.25}
                    class="sc-input axis-draw-number-input"
                    value={styleTarget().rr}
                    onChange={(e) =>
                      applyStyle({ rr: clampRiskReward(Number(e.currentTarget.value)) })
                    }
                  />
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'reverse')}>
                <label class="axis-draw-check">
                  <input
                    type="checkbox"
                    checked={styleTarget().reverse}
                    onChange={(e) => applyStyle({ reverse: e.currentTarget.checked })}
                  />
                  Reverse
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'multiColor')}>
                <label class="axis-draw-check">
                  <input
                    type="checkbox"
                    checked={styleTarget().multiColor !== false}
                    onChange={(e) => applyStyle({ multiColor: e.currentTarget.checked })}
                  />
                  Classic level colors
                </label>
                <div class="axis-draw-levels">
                  <For each={levelSwatches(String(activeKind()))}>
                    {(sw) => {
                      const current = () => {
                        const custom = styleTarget().levelColors?.[sw.key];
                        return typeof custom === 'string' && /^#[0-9a-fA-F]{6}$/.test(custom)
                          ? custom
                          : /^#[0-9a-fA-F]{6}$/.test(sw.color)
                            ? sw.color
                            : '#787B86';
                      };
                      return (
                        <label class="axis-draw-level" title={sw.label}>
                          <input
                            type="color"
                            class="axis-draw-level-swatch"
                            aria-label={`${sw.label} color`}
                            value={current()}
                            onInput={(e) => {
                              const next = { ...(styleTarget().levelColors || {}), [sw.key]: e.currentTarget.value };
                              applyStyle({ levelColors: next });
                            }}
                          />
                          <span class="axis-draw-level-label">{sw.label}</span>
                        </label>
                      );
                    }}
                  </For>
                </div>
                <button
                  type="button"
                  class="axis-draw-link"
                  onClick={() => applyStyle({ levelColors: {} })}
                >
                  Reset colors
                </button>
              </Show>

              <Show when={hasSetting(activeKind(), 'fibLevels')}>
                <div class="axis-draw-levels-col">
                  <div class="axis-draw-levels-title">Levels</div>
                  <For each={styleTarget().fibLevels}>
                    {(lvl, i) => (
                      <div class="axis-draw-level-row">
                        <input
                          type="number"
                          step={0.001}
                          class="sc-input axis-draw-level-input"
                          value={lvl}
                          onChange={(e) => {
                            const next = styleTarget().fibLevels.slice();
                            const n = Number(e.currentTarget.value);
                            if (!Number.isFinite(n)) return;
                            next[i()] = n;
                            applyStyle({ fibLevels: sanitizeFibLevels(next, defaultFibLevels(activeKind())) });
                          }}
                        />
                        <button
                          type="button"
                          class="axis-draw-chip is-mini"
                          title="Remove level"
                          aria-label="Remove fib level"
                          onClick={() => {
                            const next = styleTarget().fibLevels.filter((_, idx) => idx !== i());
                            applyStyle({
                              fibLevels: sanitizeFibLevels(next, defaultFibLevels(activeKind())),
                            });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                  <button
                    type="button"
                    class="axis-draw-link"
                    onClick={() => {
                      const next = [...styleTarget().fibLevels, 1.618];
                      applyStyle({
                        fibLevels: sanitizeFibLevels(next, defaultFibLevels(activeKind())),
                      });
                    }}
                  >
                    Add level
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
