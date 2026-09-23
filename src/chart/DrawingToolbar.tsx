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
 * - Per-group **flyouts** when `g.flyout` is set; otherwise click activates last tool
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
import type { Drawing, DrawingKind, DrawingToolId, DrawingLineStyle } from './drawing-types';
import { toolLabel, resolveDrawingStyle, DRAWING_COLORS } from './drawing-types';
import { Icons } from '../ui/icons';
import { DrawingToolIcon } from './drawings/tool-icons';
import { levelSwatches } from './drawings/level-palette';
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

const COLOR_PRESETS = [
  DRAWING_COLORS.default,
  DRAWING_COLORS.up,
  DRAWING_COLORS.down,
  DRAWING_COLORS.measure,
  '#eceef4',
  '#8b8e9c',
] as const;

const LINE_STYLES: DrawingLineStyle[] = ['solid', 'dashed', 'dotted'];

/** Chart-scope chords already in the shortcut registry — do not invent new ones. */
const TOOL_SHORTCUT: Partial<Record<DrawingToolId, string>> = {
  cursor: 'Q',
  eraser: 'E',
  measure: 'M',
  trend: 'L',
  fib: 'F',
  rect: 'R',
  text: 'T',
  hline: 'H',
  brush: 'X',
};

function titleWithShortcut(name: string, shortcut?: string) {
  return shortcut ? `${name} (${shortcut})` : name;
}

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
  layer.setStylePrefs({
    color: resolved.color,
    width: resolved.width,
    lineStyle: resolved.lineStyle,
    fillOpacity: resolved.fillOpacity,
    extendLeft: resolved.extendLeft,
    extendRight: resolved.extendRight,
    fontSize: resolved.fontSize,
    showPrice: resolved.showPrice,
    showPct: resolved.showPct,
    showStats: resolved.showStats,
    reverse: resolved.reverse,
    arrowStart: resolved.arrowStart,
    arrowEnd: resolved.arrowEnd,
    rr: resolved.rr,
    fibLevels: resolved.fibLevels,
    multiColor: resolved.multiColor,
    levelColors: resolved.levelColors ? { ...resolved.levelColors } : undefined,
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

  const onToolPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const host = hostBox();
    if (!host || !railRef) return;
    const pid = e.pointerId;
    try {
      handle.setPointerCapture(pid);
    } catch {
      /* Synthetic pointers and some browsers reject capture; move listeners still run. */
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const railBox = railRef.getBoundingClientRect();
    const origX = railBox.left - host.left;
    const origY = railBox.top - host.top;
    let moved = false;
    setDragging('tools');
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      const hb = hostBox();
      const bar = railRef?.getBoundingClientRect();
      if (!hb || !bar) return;
      setLiveTools(
        clampToHost(
          origX + (ev.clientX - startX),
          origY + (ev.clientY - startY),
          hb.width,
          hb.height,
          bar.width,
          bar.height,
        ),
      );
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragging(null);
      if (ev.type !== 'pointerup') {
        setLiveTools(null);
        return;
      }
      toolPointerHandled = true;
      if (!moved) {
        setOpenGroup(null);
        setSettingsOpen(false);
        setMenuOpen((v) => !v);
        return;
      }
      const pos = liveTools();
      setLiveTools(null);
      if (!pos) return;
      const nextDock = snapToolbarDock(pos.x, pos.y);
      if (nextDock === 'float') setDrawingUi({ toolbarDock: 'float', toolbarX: pos.x, toolbarY: pos.y });
      else setDrawingUi({ toolbarDock: nextDock });
      setMenuOpen(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onToolKeyDown = (e: KeyboardEvent) => {
    if (dock() !== 'float') return;
    const step = e.shiftKey ? 16 : 4;
    const dir: Record<string, [number, number] | undefined> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = dir[e.key];
    if (!d) return;
    e.preventDefault();
    const cur = railAnchor();
    const next = rememberRailSize({ x: cur.x + d[0], y: cur.y + d[1] }, railRef);
    setDrawingUi({ toolbarDock: 'float', toolbarX: next.x, toolbarY: next.y });
  };

  const onStylePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const host = hostBox();
    const bar = styleRef;
    if (!host || !bar) return;
    const pid = e.pointerId;
    try {
      handle.setPointerCapture(pid);
    } catch {
      /* See tool-handle capture note. */
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const box = bar.getBoundingClientRect();
    const origX = box.left - host.left;
    const origY = box.top - host.top;
    let moved = false;
    setDragging('style');
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      const hb = hostBox();
      const size = styleRef?.getBoundingClientRect();
      if (!hb || !size) return;
      setLiveStyle(
        clampToHost(
          origX + (ev.clientX - startX),
          origY + (ev.clientY - startY),
          hb.width,
          hb.height,
          size.width,
          size.height,
        ),
      );
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragging(null);
      if (!moved) return;
      const pos = liveStyle();
      setLiveStyle(null);
      if (!pos) return;
      setDrawingUi({ stylebarX: pos.x, stylebarY: pos.y });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

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

  const iconPx = 16;
  const btnClass =
    'axis-draw-btn sc-btn sc-btn-ghost w-8 h-8 min-w-8 min-h-8 !w-8 !h-8 !min-w-8 !min-h-8 p-0 flex items-center justify-center border border-transparent rounded-[4px]';

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
            <Icons.grip size={14} strokeWidth={2.25} class="axis-draw-grip" />
          </button>
          <Show when={menuOpen()}>
            <div class="axis-draw-menu" role="menu" aria-label="Drawing toolbar placement">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={dock() === 'left'}
                onClick={() => {
                  setDrawingUi({ toolbarDock: 'left' });
                  setMenuOpen(false);
                }}
              >
                Dock left
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={dock() === 'top'}
                onClick={() => {
                  setDrawingUi({ toolbarDock: 'top' });
                  setMenuOpen(false);
                }}
              >
                Dock top
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={dock() === 'float'}
                onClick={placeFree}
              >
                Free position
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={store.drawingUi.toolbarSlide === true}
                  disabled={dock() === 'float'}
                  onChange={(e) => setDrawingUi({ toolbarSlide: e.currentTarget.checked })}
                />
                Slide in
              </label>
            </div>
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
              <div class="relative" data-drawing-group={g.id}>
                <button
                  type="button"
                  class={`${btnClass} ${isActive() ? 'is-active' : ''}`}
                  title={
                    g.flyout
                      ? titleWithShortcut(
                          `${g.label} · ${toolLabel(primaryId())}`,
                          TOOL_SHORTCUT[primaryId()],
                        )
                      : titleWithShortcut(toolLabel(primaryId()), TOOL_SHORTCUT[primaryId()])
                  }
                  aria-label={g.label}
                  aria-pressed={isActive()}
                  aria-haspopup={g.flyout ? 'menu' : undefined}
                  aria-expanded={g.flyout ? openGroup() === g.id : undefined}
                  onClick={() => onGroupClick(g.id)}
                >
                  <DrawingToolIcon id={primaryId()} size={iconPx} strokeWidth={1.75} />
                  <Show when={g.flyout}>
                    <span
                      class={`absolute right-0.5 bottom-0.5 text-text-faint opacity-80 ${
                        dock() === 'top' ? 'rotate-90' : ''
                      }`}
                    >
                      <Icons.chevronRight size={8} strokeWidth={2.5} />
                    </span>
                  </Show>
                </button>
                <Show when={g.flyout && openGroup() === g.id}>
                  <div
                    class={`axis-draw-pop absolute z-50 min-w-[9.5em] p-2 flex flex-col gap-0.5 overflow-y-auto ${
                      dock() === 'top' ? 'left-0 top-full mt-1' : 'left-full top-0 ml-1'
                    }`}
                    role="menu"
                    style={flyoutClamp()[g.id]}
                    data-drawing-flyout
                  >
                    <For each={g.tools}>
                      {(tid) => {
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={active() === tid}
                            class={`flex items-center gap-2 w-full px-2 py-1.5 text-left text-[12px] rounded-[4px] border-0 bg-transparent cursor-pointer font-inherit ${
                              active() === tid
                                ? 'text-accent bg-accent/10 font-semibold'
                                : 'text-text-dim hover:bg-white/[0.04] hover:text-text'
                            }`}
                            title={titleWithShortcut(toolLabel(tid), TOOL_SHORTCUT[tid])}
                            onClick={() => selectTool(tid)}
                          >
                            <DrawingToolIcon id={tid} size={15} strokeWidth={1.75} />
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

        <div class="axis-draw-sep h-px bg-border-soft my-0.5" />

        <button
          type="button"
          class={`${btnClass} relative ${
            store.drawingUi.magnet !== 'off' ? 'text-accent' : 'text-text-dim'
          }`}
          title={`Magnet: ${store.drawingUi.magnet} (W)`}
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
          title="Hide drawings (user + Pine; selected user drawings still visible)"
          aria-pressed={store.drawingUi.hideDrawings}
          aria-label={store.drawingUi.hideDrawings ? 'Show drawings' : 'Hide drawings'}
          onClick={() => {
            const next = !store.drawingUi.hideDrawings;
            setDrawingUi({ hideDrawings: next });
            setHideDrawingsAll(next);
          }}
        >
          {store.drawingUi.hideDrawings ? (
            <Icons.eyeOff size={iconPx} strokeWidth={2.25} />
          ) : (
            <Icons.eye size={iconPx} strokeWidth={2.25} />
          )}
        </button>

        <div class="axis-draw-sep h-px bg-border-soft my-0.5" />

        <button
          type="button"
          class={`${btnClass} text-text-dim disabled:opacity-40`}
          title={`Duplicate drawings for ${store.symbol} with new IDs`}
          aria-label="Duplicate drawings"
          data-testid="axis-drawing-duplicate"
          disabled={visibleDrawingsForActiveSymbol().length === 0}
          onClick={() => {
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
          <Icons.copy size={iconPx} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          class={`${btnClass} text-text-dim disabled:opacity-40`}
          title="Delete selected (Delete)"
          aria-label="Delete selected drawing"
          disabled={!store.selectedDrawingId}
          onClick={() => getActiveDrawingLayer()?.deleteSelected()}
        >
          <Icons.trash size={iconPx} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          class={`${btnClass} text-text-dim disabled:opacity-40`}
          title={`Clear drawings for ${store.symbol}`}
          aria-label="Clear drawings for symbol"
          disabled={visibleDrawingsForActiveSymbol().length === 0}
          onClick={() => {
            const n = visibleDrawingsForActiveSymbol().length;
            if (n && !confirm(`Clear drawings for ${store.symbol}?`)) return;
            // clearAll emits [] → onChange merges (other symbols kept); also
            // update store directly so UI stays correct if layer is missing
            getActiveDrawingLayer()?.clearAll();
            clearDrawingsForSymbol(store.symbol);
          }}
        >
          <Icons.eraser size={iconPx} strokeWidth={2.25} />
        </button>

        <Show when={visibleDrawingsForActiveSymbol().length > 0}>
          <span
            class="text-[10px] font-mono text-text-faint text-center py-0.5 tabular-nums"
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
              <Icons.grip size={14} strokeWidth={2.25} />
            </button>
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
            <input
              type="color"
              class="w-5 h-5 p-0 border border-border-soft rounded-sm bg-transparent cursor-pointer shrink-0"
              title="Custom color"
              aria-label="Custom color"
              value={
                /^#[0-9a-fA-F]{6}$/.test(styleTarget().color)
                  ? styleTarget().color
                  : '#939fff'
              }
              onInput={(e) => applyStyle({ color: e.currentTarget.value })}
            />

            <span class="w-px h-5 bg-border-soft mx-0.5" />

            <For each={[...widthsForKind(activeKind())]}>
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

            <Show when={hasSetting(activeKind(), 'fillOpacity')}>
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

            <Show when={hasSetting(activeKind(), 'extendLeft')}>
              <button
                type="button"
                class={`${btnClass} !w-7 !h-7 !min-w-7 !min-h-7 text-[10px] font-mono ${
                  styleTarget().extendLeft ? 'text-accent border-accent' : 'text-text-dim'
                }`}
                title="Extend left"
                aria-pressed={styleTarget().extendLeft}
                onClick={() => applyStyle({ extendLeft: !styleTarget().extendLeft })}
              >
                ←
              </button>
            </Show>
            <Show when={hasSetting(activeKind(), 'extendRight')}>
              <button
                type="button"
                class={`${btnClass} !w-7 !h-7 !min-w-7 !min-h-7 text-[10px] font-mono ${
                  styleTarget().extendRight ? 'text-accent border-accent' : 'text-text-dim'
                }`}
                title="Extend right"
                aria-pressed={styleTarget().extendRight}
                onClick={() => applyStyle({ extendRight: !styleTarget().extendRight })}
              >
                →
              </button>
            </Show>
            <Show when={hasSetting(activeKind(), 'showPrice')}>
              <button
                type="button"
                class={`${btnClass} !w-7 !h-7 !min-w-7 !min-h-7 text-[10px] ${
                  styleTarget().showPrice ? 'text-accent border-accent' : 'text-text-dim'
                }`}
                title="Show price / time"
                aria-pressed={styleTarget().showPrice}
                onClick={() => applyStyle({ showPrice: !styleTarget().showPrice })}
              >
                $
              </button>
            </Show>

            <Show when={styleTarget().mode === 'selection'}>
              <span class="w-px h-5 bg-border-soft mx-0.5" />
              <button
                type="button"
                class={`${btnClass} !w-7 !h-7 !min-w-7 !min-h-7 ${
                  styleTarget().locked ? 'text-accent border-accent' : 'text-text-dim'
                }`}
                title={styleTarget().locked ? 'Unlock drawing' : 'Lock drawing'}
                aria-pressed={styleTarget().locked}
                onClick={() => applyStyle({ locked: !styleTarget().locked })}
              >
                {styleTarget().locked ? (
                  <Icons.lock size={14} strokeWidth={2.25} />
                ) : (
                  <Icons.unlock size={14} strokeWidth={2.25} />
                )}
              </button>
              <span class="text-[10px] text-text-faint px-1 uppercase tracking-wider">sel</span>
            </Show>

            <span class="w-px h-5 bg-border-soft mx-0.5" />
            <button
              type="button"
              class={`${btnClass} !w-7 !h-7 !min-w-7 !min-h-7 ${
                settingsOpen() ? 'text-accent border-accent' : 'text-text-dim'
              }`}
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
              class="axis-draw-pop pointer-events-auto absolute left-0 top-full mt-1 w-[18.5rem] max-h-[min(70vh,28rem)] overflow-y-auto p-2 flex flex-col gap-2 z-50"
              role="dialog"
              aria-label="Drawing settings"
              style={settingsClamp()}
              data-testid="axis-drawing-settings-popover"
            >
              <div class="text-[11px] font-semibold text-text px-0.5">
                {toolLabel(activeKind())}
              </div>

              <Show when={hasSetting(activeKind(), 'text')}>
                <label class="flex flex-col gap-0.5 text-[10px] text-text-faint">
                  Text
                  <input
                    type="text"
                    class="sc-input text-[12px] px-2 py-1"
                    value={styleTarget().text}
                    maxlength={200}
                    onChange={(e) => applyStyle({ text: e.currentTarget.value })}
                  />
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'fontSize')}>
                <label class="flex items-center justify-between gap-2 text-[10px] text-text-faint">
                  Font size
                  <input
                    type="number"
                    min={8}
                    max={32}
                    step={1}
                    class="sc-input w-16 text-[12px] px-1 py-0.5"
                    value={styleTarget().fontSize}
                    onChange={(e) =>
                      applyStyle({ fontSize: clampFontSize(Number(e.currentTarget.value)) })
                    }
                  />
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'showStats')}>
                <label class="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={styleTarget().showStats}
                    onChange={(e) => applyStyle({ showStats: e.currentTarget.checked })}
                  />
                  Show stats
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'showPct')}>
                <label class="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={styleTarget().showPct}
                    onChange={(e) => applyStyle({ showPct: e.currentTarget.checked })}
                  />
                  Show percents
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'arrowStart')}>
                <label class="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={styleTarget().arrowStart}
                    onChange={(e) => applyStyle({ arrowStart: e.currentTarget.checked })}
                  />
                  Arrow at start
                </label>
              </Show>
              <Show when={hasSetting(activeKind(), 'arrowEnd')}>
                <label class="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={styleTarget().arrowEnd}
                    onChange={(e) => applyStyle({ arrowEnd: e.currentTarget.checked })}
                  />
                  Arrow at end
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'rr')}>
                <label class="flex items-center justify-between gap-2 text-[10px] text-text-faint">
                  Risk / reward
                  <input
                    type="number"
                    min={0.25}
                    max={10}
                    step={0.25}
                    class="sc-input w-16 text-[12px] px-1 py-0.5"
                    value={styleTarget().rr}
                    onChange={(e) =>
                      applyStyle({ rr: clampRiskReward(Number(e.currentTarget.value)) })
                    }
                  />
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'reverse')}>
                <label class="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={styleTarget().reverse}
                    onChange={(e) => applyStyle({ reverse: e.currentTarget.checked })}
                  />
                  Reverse
                </label>
              </Show>

              <Show when={hasSetting(activeKind(), 'multiColor')}>
                <label class="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={styleTarget().multiColor !== false}
                    onChange={(e) => applyStyle({ multiColor: e.currentTarget.checked })}
                  />
                  Classic level colors
                </label>
                <div class="flex flex-wrap gap-1">
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
                        <label class="flex flex-col items-center gap-0.5" title={sw.label}>
                          <input
                            type="color"
                            class="w-5 h-5 p-0 border border-border-soft rounded-sm bg-transparent cursor-pointer"
                            aria-label={`${sw.label} color`}
                            value={current()}
                            onInput={(e) => {
                              const next = { ...(styleTarget().levelColors || {}), [sw.key]: e.currentTarget.value };
                              applyStyle({ levelColors: next });
                            }}
                          />
                          <span class="text-[9px] font-mono text-text-faint">{sw.label}</span>
                        </label>
                      );
                    }}
                  </For>
                </div>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost text-[11px] self-start px-2 py-0.5"
                  onClick={() => applyStyle({ levelColors: {} })}
                >
                  Reset colors
                </button>
              </Show>

              <Show when={hasSetting(activeKind(), 'fibLevels')}>
                <div class="flex flex-col gap-1">
                  <div class="text-[10px] text-text-faint uppercase tracking-wider">Levels</div>
                  <For each={styleTarget().fibLevels}>
                    {(lvl, i) => (
                      <div class="flex items-center gap-1">
                        <input
                          type="number"
                          step={0.001}
                          class="sc-input flex-1 text-[11px] px-1 py-0.5 font-mono"
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
                          class={`${btnClass} !w-6 !h-6 !min-w-6 !min-h-6 text-text-dim`}
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
                    class="sc-btn sc-btn-ghost text-[11px] self-start px-2 py-0.5"
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
