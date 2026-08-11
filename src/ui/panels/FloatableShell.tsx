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
 * Floatable / dockable panel chrome with drag handle + skeleton preview.
 *
 * ## Lifecycle
 * - Reads `getPanelChrome(id)`; header drag (hold ~280ms or move past threshold)
 *   starts a global drag preview consumed by {@link PanelDragOverlay}.
 * - Dock menu: left/right/bottom/float/window; window may call `onPopoutWindow`.
 * - Float mode: free geometry via `setPanelGeometry` + `bumpPanelZ`.
 *
 * {@link installPanelWindowBridge} listens for companion-window reattach messages.
 */

import {
  Component,
  For,
  JSX,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  store,
  getPanelChrome,
  setPanelOpen,
  setPanelDock,
  setPanelGeometry,
  bumpPanelZ,
  setPanelHoverSlide,
  isPanelHoverSlide,
} from '../../store';
import { Icons } from '../icons';
import { ResizeHandle } from '../ResizeHandle';
import {
  PANEL_META,
  isHoverSlideEligible,
  type PanelDock,
  type PanelId,
  type DropZone,
} from './types';
import { dropZoneToDock, hitDropZone, skeletonSize } from './drop-zones';
import {
  dockHostElement,
  dockStackCount,
  dockStackCssOrder,
  isLastInDockStack,
  panelsOnDock,
  panelDockLayoutHeight,
  panelDockLayoutWidth,
} from './dock-layout';
import {
  HOVER_SLIDE_LEAVE_MS,
  clearPanelHoverSlideExpanded,
  isPanelHoverSlideExpanded,
  setPanelHoverSlideExpanded,
} from './hover-slide';

/** Props for a dockable panel wrapper (title falls back to PANEL_META). */
export interface FloatableShellProps {
  id: PanelId;
  title?: string;
  children: JSX.Element;
  /** Extra header actions (prefer icon-only so the title bar does not overflow) */
  headerExtra?: JSX.Element;
  /**
   * Actions rendered just before the close control (e.g. overflow ··· menu).
   * Prefer icon-only; stop pointer propagation so they don’t start panel drag.
   */
  headerEnd?: JSX.Element;
  /**
   * Extra items for the left hamburger menu (after dock options).
   * Render buttons with `role="menuitem"` and class `axis-panel-menu-item`.
   */
  menuExtra?: JSX.Element;
  class?: string;
  /** Called when user chooses "new window" (shell still sets dock=window) */
  onPopoutWindow?: () => void;
  testId?: string;
}

type DragMode = 'move' | 'resize' | null;

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  pointerId: number;
}

/** Global drag preview state (single drag at a time) */
const [dragPreview, setDragPreview] = createSignal<{
  id: PanelId;
  zone: DropZone;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
} | null>(null);

/** Reactive accessor for the active panel drag ghost (null when idle). */
export function getDragPreview() {
  return dragPreview;
}

const HOLD_MS = 280;
const MOVE_PX = 6;

const DOCK_MENU = [
  { dock: 'left' as const, label: 'Dock left', Icon: Icons.panelLeft },
  { dock: 'right' as const, label: 'Dock right', Icon: Icons.panelRight },
  { dock: 'bottom' as const, label: 'Dock bottom', Icon: Icons.panelBottom },
  { dock: 'float' as const, label: 'Float', Icon: Icons.square },
  { dock: 'window' as const, label: 'New window', Icon: Icons.popout },
];

/**
 * Panel chrome shell — docks into layout slots or floats with resize handles.
 * When closed (`isPanelOpen` false), parent renders nothing.
 * Docked panels portal into `#axis-dock-{left,right,bottom}` so multiple
 * panels on the same side stack **one below the other**.
 */
export const FloatableShell: Component<FloatableShellProps> = (props) => {
  const meta = () => PANEL_META[props.id];
  const chrome = () => getPanelChrome(props.id);
  const title = () => props.title || meta().title;
  const dock = () => chrome().dock;
  const isFloat = () => dock() === 'float' || dock() === 'window';
  const stackN = () => {
    // Track full chrome map so peer open/dock changes re-flex this shell
    void store.panelChrome;
    const d = dock();
    if (d === 'float' || d === 'window') return 1;
    return dockStackCount(d);
  };
  const stacked = () => stackN() > 1;

  const [menuOpen, setMenuOpen] = createSignal(false);
  /**
   * Portal host element. Updated when dock side changes.
   * Boolean Show (not keyed on the element) so host switches move the
   * portal without destroying CodeMirror / editor state mid-drag.
   */
  const [mountEl, setMountEl] = createSignal<HTMLElement | null>(null);
  /** True while title-drag is active — geometry writes skip persist. */
  const [dragging, setDragging] = createSignal(false);

  let rootEl: HTMLDivElement | undefined;
  let menuWrapEl: HTMLDivElement | undefined;
  let drag: DragState | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDrag = false;
  let hoverLeaveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Hover-slide preference + dock eligibility (persisted chrome). */
  const hoverSlideOn = () => {
    const d = dock();
    return isPanelHoverSlide(props.id) && isHoverSlideEligible(d) && !isFloat();
  };
  const hoverExpanded = () => isPanelHoverSlideExpanded(props.id);
  const hoverCollapsed = () => hoverSlideOn() && !hoverExpanded();

  const clearHoverLeaveTimer = () => {
    if (hoverLeaveTimer != null) {
      clearTimeout(hoverLeaveTimer);
      hoverLeaveTimer = undefined;
    }
  };

  /** Notify chart host so LWC canvases shrink/grow with dock columns (not overlay). */
  const requestChartReflow = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('axis-chart-reflow'));
  };

  const expandHoverSlide = () => {
    if (!hoverSlideOn() || dragging()) return;
    clearHoverLeaveTimer();
    setPanelHoverSlideExpanded(props.id, true);
    requestChartReflow();
  };

  const scheduleCollapseHoverSlide = () => {
    if (!hoverSlideOn() || dragging()) return;
    // Keep open while dock menu is expanded (user may move to menu items)
    if (menuOpen()) return;
    clearHoverLeaveTimer();
    hoverLeaveTimer = setTimeout(() => {
      hoverLeaveTimer = undefined;
      if (menuOpen() || dragging()) return;
      setPanelHoverSlideExpanded(props.id, false);
      requestChartReflow();
    }, HOVER_SLIDE_LEAVE_MS);
  };

  // Reset expanded state when preference / dock changes
  createEffect(() => {
    const on = hoverSlideOn();
    if (!on) {
      clearHoverLeaveTimer();
      clearPanelHoverSlideExpanded(props.id);
      return;
    }
    // Prefer collapsed until the user hovers
    if (!isPanelHoverSlideExpanded(props.id)) {
      setPanelHoverSlideExpanded(props.id, false);
    }
  });

  const resolveMount = () => {
    const next = dockHostElement(dock());
    // Only update when the host node actually changes (avoids Show thrash)
    setMountEl((prev) => (prev === next ? prev : next));
  };

  onMount(() => {
    resolveMount();
    // Dock columns may paint one frame later on first boot
    requestAnimationFrame(resolveMount);
    const onVis = () => {
      // Safety: clear stuck body cursor/select if a drag was interrupted
      if (!drag) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('blur', onVis);
    onCleanup(() => window.removeEventListener('blur', onVis));
  });

  // Re-portal when dock side changes (same component instance keeps children)
  createEffect(() => {
    void dock();
    queueMicrotask(resolveMount);
  });

  const clearBodyDragStyles = () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.classList.remove('axis-panel-dragging');
  };

  const close = () => setPanelOpen(props.id, false);

  /** Ensure float chrome has on-screen geometry and usable size. */
  const seedFloatGeometry = (fromRect?: DOMRect | null) => {
    const m = meta();
    const c = getPanelChrome(props.id);
    const isEditor = props.id === 'editor';
    const w = Math.max(
      m.minW,
      fromRect?.width ?? c.w ?? m.defaultW,
      Math.min(m.defaultW, 320),
    );
    // Editor float: prefer full remaining viewport height
    const topPad = 48;
    const bottomPad = 36;
    const y0 = fromRect?.top ?? (c.y > 8 ? c.y : topPad);
    const fullH = Math.max(200, window.innerHeight - y0 - bottomPad);
    const h = isEditor
      ? fullH
      : Math.max(
          m.minH,
          fromRect?.height ?? c.h ?? m.defaultH,
          Math.min(m.defaultH, 240),
        );
    const maxX = Math.max(0, window.innerWidth - Math.min(w, window.innerWidth));
    const maxY = Math.max(0, window.innerHeight - Math.min(h, window.innerHeight));
    let x = fromRect?.left ?? c.x;
    let y = fromRect?.top ?? c.y;
    // Default place center-right when still at origin
    if (x < 8 && y < 8 && !fromRect) {
      x = Math.max(24, window.innerWidth - w - 48);
      y = isEditor ? topPad : 56;
    }
    x = Math.min(maxX, Math.max(0, x));
    y = isEditor ? Math.min(topPad + 8, Math.max(0, y)) : Math.min(maxY, Math.max(0, y));
    setPanelGeometry(props.id, {
      x,
      y,
      w,
      h: isEditor ? Math.max(200, window.innerHeight - y - bottomPad) : h,
    });
  };

  const setDock = (d: PanelDock) => {
    setMenuOpen(false);
    const rect = d === 'float' ? rootEl?.getBoundingClientRect() : null;
    setPanelDock(props.id, d);
    if (d === 'float') {
      seedFloatGeometry(rect ?? null);
      bumpPanelZ(props.id);
    }
    if (d === 'window') {
      // Custom popout (e.g. live Pine editor window) replaces the stub companion
      if (props.onPopoutWindow) {
        props.onPopoutWindow();
      } else {
        openCompanionWindow(props.id, title());
      }
    }
    queueMicrotask(() => {
      resolveMount();
      requestChartReflow();
    });
  };

  const beginMoveDrag = (clientX: number, clientY: number) => {
    setMenuOpen(false);
    const c = getPanelChrome(props.id);
    // Undock to float on drag from docked layout (one portal hop)
    if (c.dock !== 'float' && c.dock !== 'window') {
      const rect = rootEl?.getBoundingClientRect();
      setPanelDock(props.id, 'float');
      seedFloatGeometry(rect ?? null);
      // Ensure portal host is float root before move events paint
      resolveMount();
    }
    bumpPanelZ(props.id);

    const cur = getPanelChrome(props.id);
    drag = {
      mode: 'move',
      startX: clientX,
      startY: clientY,
      origX: cur.x,
      origY: cur.y,
      origW: cur.w,
      origH: cur.h,
      pointerId: -1,
    };
    setDragging(true);
    document.body.classList.add('axis-panel-dragging');
    document.body.style.userSelect = 'none';

    const endDrag = () => {
      drag = null;
      setDragging(false);
      setDragPreview(null);
      clearBodyDragStyles();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // Persist final geometry once
      const final = getPanelChrome(props.id);
      setPanelGeometry(props.id, { x: final.x, y: final.y, w: final.w, h: final.h });
    };

    const onMove = (ev: PointerEvent) => {
      if (!drag || drag.mode !== 'move') return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      const nx = Math.max(0, drag.origX + dx);
      const ny = Math.max(0, drag.origY + dy);
      setPanelGeometry(props.id, { x: nx, y: ny }, { persist: false });

      const zone = hitDropZone(ev.clientX, ev.clientY);
      const dockT = dropZoneToDock(zone);
      const sk = skeletonSize(dockT, drag.origW, drag.origH, window.innerWidth, window.innerHeight);
      let sx = ev.clientX - sk.w / 2;
      let sy = ev.clientY - 16;
      if (zone === 'left') {
        sx = 8;
        sy = 48;
      } else if (zone === 'right') {
        sx = window.innerWidth - sk.w - 8;
        sy = 48;
      } else if (zone === 'bottom') {
        sx = (window.innerWidth - sk.w) / 2;
        sy = window.innerHeight - sk.h - 40;
      }
      setDragPreview({
        id: props.id,
        zone,
        x: sx,
        y: sy,
        w: sk.w,
        h: sk.h,
        title: title(),
      });
    };

    const onUp = (ev: PointerEvent) => {
      if (!drag) return;
      const zone = hitDropZone(ev.clientX, ev.clientY);
      const nextDock = dropZoneToDock(zone);
      if (nextDock !== 'float') {
        setPanelDock(props.id, nextDock);
      }
      endDrag();
      queueMicrotask(() => {
        resolveMount();
        requestChartReflow();
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Title bar: drag immediately (not hamburger / menu / close). */
  const onHandlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, .axis-panel-menu')) return;
    e.preventDefault();
    beginMoveDrag(e.clientX, e.clientY);
  };

  /**
   * Hamburger: click → expand dock menu; hold or drag → move panel.
   */
  const onHamburgerPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    pendingDrag = false;

    const clearHold = () => {
      if (holdTimer != null) {
        clearTimeout(holdTimer);
        holdTimer = undefined;
      }
    };

    const startDrag = () => {
      if (pendingDrag) return;
      pendingDrag = true;
      clearHold();
      beginMoveDrag(startX, startY);
    };

    holdTimer = setTimeout(startDrag, HOLD_MS);

    const onMove = (ev: PointerEvent) => {
      if (pendingDrag) return;
      if (Math.abs(ev.clientX - startX) > MOVE_PX || Math.abs(ev.clientY - startY) > MOVE_PX) {
        startDrag();
      }
    };

    const onUp = () => {
      clearHold();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!pendingDrag) {
        setMenuOpen((o) => !o);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Close dock menu on outside click / Escape
  onMount(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (!menuOpen()) return;
      const t = e.target as Node;
      if (menuWrapEl && !menuWrapEl.contains(t)) setMenuOpen(false);
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('keydown', onDocKey);
      if (holdTimer != null) clearTimeout(holdTimer);
      clearHoverLeaveTimer();
    });
  });

  /**
   * Float/window border or corner resize.
   * Edges: e | w | n | s | se (corner). Min size is panel border (1px).
   * West/north also move x/y so the opposite edge stays fixed.
   */
  const onFloatResizePointerDown =
    (edge: 'e' | 'w' | 'n' | 's' | 'se') => (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const cur = getPanelChrome(props.id);
      if (cur.dock !== 'float' && cur.dock !== 'window') return;
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = cur.x;
      const origY = cur.y;
      const origW = cur.w;
      const origH = cur.h;
      const minW = meta().minW;
      const minH = meta().minH;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      document.body.style.userSelect = 'none';
      const cursor =
        edge === 'e' || edge === 'w'
          ? 'col-resize'
          : edge === 'n' || edge === 's'
            ? 'row-resize'
            : 'nwse-resize';
      document.body.style.cursor = cursor;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const geo: Partial<{ x: number; y: number; w: number; h: number }> = {};
        if (edge === 'e' || edge === 'se') {
          geo.w = Math.max(minW, origW + dx);
        }
        if (edge === 'w') {
          const w = Math.max(minW, origW - dx);
          geo.w = w;
          geo.x = origX + (origW - w);
        }
        if (edge === 's' || edge === 'se') {
          geo.h = Math.max(minH, origH + dy);
        }
        if (edge === 'n') {
          const h = Math.max(minH, origH - dy);
          geo.h = h;
          geo.y = origY + (origH - h);
        }
        setPanelGeometry(props.id, geo);
      };
      const onUp = (ev: PointerEvent) => {
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
        } catch {
          /* ignore */
        }
        clearBodyDragStyles();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

  const dockWidth = () => getPanelChrome(props.id).w;
  const dockHeight = () => getPanelChrome(props.id).h;
  const setDockWidth = (w: number) => {
    setPanelGeometry(props.id, { w });
    requestChartReflow();
  };
  const setDockHeight = (h: number) => {
    setPanelGeometry(props.id, { h });
    requestChartReflow();
  };

  /**
   * Split height with the next panel in the stack (drag bottom edge).
   * Transfers delta so total flex weight stays roughly constant.
   */
  const setStackedHeight = (nextH: number) => {
    const d = dock();
    if (d === 'float' || d === 'window') {
      setPanelGeometry(props.id, { h: nextH });
      return;
    }
    const list = panelsOnDock(d);
    const i = list.indexOf(props.id);
    const cur = getPanelChrome(props.id).h;
    const clamped = Math.max(meta().minH, Math.round(nextH));
    setPanelGeometry(props.id, { h: clamped });
    const neighbor = i >= 0 ? list[i + 1] : undefined;
    if (neighbor) {
      const nCur = getPanelChrome(neighbor).h;
      const delta = clamped - cur;
      const nMeta = PANEL_META[neighbor];
      setPanelGeometry(neighbor, {
        h: Math.max(nMeta.minH, Math.round(nCur - delta)),
      });
    }
  };

  const shellStyle = (): JSX.CSSProperties => {
    const c = chrome();
    const d = dock();
    const order = dockStackCssOrder(props.id);
    const isEditor = props.id === 'editor';
    const slide = hoverSlideOn();
    const collapsed = slide && !hoverExpanded();
    // Transition only when hover-slide is active (avoid animating normal resizes)
    const slideTransition = slide
      ? 'width 0.22s cubic-bezier(0.22, 1, 0.36, 1), height 0.22s cubic-bezier(0.22, 1, 0.36, 1), flex-basis 0.22s cubic-bezier(0.22, 1, 0.36, 1), min-width 0.22s ease'
      : undefined;

    if (d === 'float' || d === 'window') {
      // Keep editor/CM usable: never allow collapsed float chrome.
      // pointer-events:auto is required — float root is pointer-events:none so
      // empty overlay space clicks pass through; without this, CM is not editable
      // and clicks hit the chart/topbar underneath.
      const w = Math.max(meta().minW, c.w || meta().defaultW);
      // Editor float: always fill viewport under top edge (CSS tracks window resize)
      const bottomPad = 36; // status / safe area
      const top = Math.max(0, Math.min(c.y || 48, window.innerHeight - 160));
      const h = Math.max(meta().minH, c.h || meta().defaultH);
      if (isEditor) {
        return {
          position: 'fixed',
          left: `${c.x}px`,
          top: `${top}px`,
          width: `${w}px`,
          height: `calc(100vh - ${top}px - ${bottomPad}px)`,
          'z-index': String(Math.max(100, c.z || 20)),
          'min-width': `${meta().minW}px`,
          'min-height': '200px',
          'pointer-events': 'auto',
        };
      }
      return {
        position: 'fixed',
        left: `${c.x}px`,
        top: `${c.y}px`,
        width: `${w}px`,
        height: `${h}px`,
        'z-index': String(Math.max(100, c.z || 20)),
        'min-width': `${meta().minW}px`,
        'min-height': `${Math.max(meta().minH, 120)}px`,
        'pointer-events': 'auto',
      };
    }
    // Side docks: flow in the dock column (never position:fixed — that overlays the chart).
    // Multiple panels share the strip **side-by-side** (row): e.g. indicators | editor.
    if (d === 'left' || d === 'right') {
      // Layout width respects hover-slide peek when collapsed
      const layoutW = panelDockLayoutWidth(props.id);
      const fullW = Math.max(meta().minW, c.w || meta().defaultW);
      if (slide) {
        return {
          position: 'relative',
          width: `${layoutW}px`,
          height: '100%',
          flex: `0 0 ${layoutW}px`,
          'min-width': collapsed ? `${layoutW}px` : `${meta().minW}px`,
          'min-height': '0',
          order: String(order),
          left: 'auto',
          top: 'auto',
          'z-index': hoverExpanded() ? '30' : 'auto',
          transition: slideTransition,
          // Keep full width intent for tools that read CSS vars
          '--axis-panel-full-w': `${fullW}px`,
        } as JSX.CSSProperties;
      }
      if (!stacked()) {
        // Alone: fill the whole dock strip width + height
        return {
          position: 'relative',
          width: '100%',
          height: '100%',
          flex: '1 1 auto',
          'min-height': '0',
          order: String(order),
          left: 'auto',
          top: 'auto',
          'z-index': 'auto',
        };
      }
      // Side-by-side: each panel keeps its own width; full strip height
      return {
        position: 'relative',
        width: `${fullW}px`,
        height: '100%',
        flex: `0 0 ${fullW}px`,
        'min-width': `${meta().minW}px`,
        'min-height': '0',
        order: String(order),
        left: 'auto',
        top: 'auto',
        'z-index': 'auto',
      };
    }
    // bottom: pixel heights (column has no fixed height; flex-grow would collapse)
    // Hover-slide uses layout height (peek when collapsed)
    if (slide) {
      const layoutH = panelDockLayoutHeight(props.id);
      return {
        position: 'relative',
        width: '100%',
        height: `${layoutH}px`,
        flex: '0 0 auto',
        'min-height': collapsed ? `${layoutH}px` : `${Math.max(meta().minH, 40)}px`,
        order: String(order),
        left: 'auto',
        top: 'auto',
        'z-index': hoverExpanded() ? '30' : 'auto',
        transition: slideTransition,
      };
    }
    // Editor docked bottom still fills the bottom column when alone / stacked
    if (isEditor) {
      return {
        position: 'relative',
        width: '100%',
        height: '100%',
        flex: '1 1 auto',
        'min-height': `${Math.max(meta().minH, c.h, 200)}px`,
        order: String(order),
        left: 'auto',
        top: 'auto',
        'z-index': 'auto',
      };
    }
    return {
      position: 'relative',
      width: '100%',
      height: `${Math.max(meta().minH, c.h)}px`,
      flex: '0 0 auto',
      order: String(order),
      left: 'auto',
      top: 'auto',
      'z-index': 'auto',
    };
  };

  const dockClass = () => {
    const d = dock();
    if (d === 'left') return 'axis-panel-dock axis-panel-dock-left';
    if (d === 'right') return 'axis-panel-dock axis-panel-dock-right';
    if (d === 'bottom') return 'axis-panel-dock axis-panel-dock-bottom';
    return 'axis-panel-float sc-float-panel';
  };

  const showSideWidthResize = () => {
    if (hoverCollapsed()) return false;
    return dock() === 'left' || dock() === 'right';
  };
  const showBottomHeightResize = () => {
    if (hoverCollapsed()) return false;
    // Editor always fills height — no vertical split handles
    if (props.id === 'editor') return false;
    const d = dock();
    if (d === 'bottom') return true;
    // Left/right multi-panel is side-by-side (row) — width handles only
    if (d === 'left' || d === 'right') return false;
    return false;
  };

  // Boolean Show (not keyed on HTMLElement) — host swaps must not remount children
  return (
    <Show when={!!mountEl()}>
      <Portal mount={mountEl()!}>
          <div
            ref={rootEl}
            class={`axis-panel-shell flex flex-col min-h-0 overflow-hidden ${dockClass()} ${props.class || ''}`}
            classList={{
              'is-dragging': dragging(),
              'axis-panel-hover-slide': hoverSlideOn(),
              'is-hover-collapsed': hoverCollapsed(),
              'is-hover-expanded': hoverSlideOn() && hoverExpanded(),
            }}
            style={shellStyle()}
            data-panel-id={props.id}
            data-panel-dock={dock()}
            data-panel-stacked={stacked() ? '1' : '0'}
            data-hover-slide={hoverSlideOn() ? '1' : '0'}
            data-testid={props.testId}
            onPointerEnter={() => expandHoverSlide()}
            onPointerLeave={() => scheduleCollapseHoverSlide()}
            onPointerDown={() => {
              if (isFloat()) bumpPanelZ(props.id);
              // Touch / click on peek strip should expand immediately
              if (hoverCollapsed()) expandHoverSlide();
            }}
          >
            {/* Title bar — drag on title; hamburger click = menu, hold = drag */}
            <div
              class="axis-panel-handle sc-float-panel-header cursor-grab active:cursor-grabbing select-none relative"
              onPointerDown={onHandlePointerDown}
              title={
                hoverCollapsed()
                  ? `${title()} — hover to expand`
                  : 'Drag title to move · drop on edges to dock'
              }
            >
              <div
                class="axis-panel-menu relative flex-shrink-0"
                ref={menuWrapEl}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  class={`sc-btn sc-btn-ghost px-1 ${menuOpen() ? 'text-accent' : ''}`}
                  title="Click: dock options · Hold: drag panel"
                  aria-label="Panel menu"
                  aria-expanded={menuOpen()}
                  aria-haspopup="menu"
                  onPointerDown={onHamburgerPointerDown}
                >
                  <Icons.menu />
                </button>
                <Show when={menuOpen()}>
                  <div
                    class="axis-panel-menu-pop"
                    role="menu"
                    aria-label="Panel menu"
                    onClick={(e) => {
                      // Close after any menuitem action (dock items + menuExtra)
                      const t = e.target as HTMLElement | null;
                      if (t?.closest?.('[role="menuitem"]')) setMenuOpen(false);
                    }}
                  >
                    <For each={DOCK_MENU}>
                      {(item) => {
                        const ItemIcon = item.Icon;
                        const active = () => dock() === item.dock;
                        return (
                          <button
                            type="button"
                            role="menuitem"
                            class={`axis-panel-menu-item ${active() ? 'is-active' : ''}`}
                            onClick={() => setDock(item.dock)}
                          >
                            <ItemIcon />
                            <span>{item.label}</span>
                          </button>
                        );
                      }}
                    </For>
                    <Show when={isHoverSlideEligible(dock())}>
                      <div class="axis-panel-menu-sep" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        class={`axis-panel-menu-item ${
                          isPanelHoverSlide(props.id) ? 'is-active' : ''
                        }`}
                        title="When docked: collapse to a strip, expand on hover, collapse on leave"
                        data-testid={`axis-panel-hover-slide-${props.id}`}
                        onClick={() => {
                          setPanelHoverSlide(props.id, !isPanelHoverSlide(props.id));
                        }}
                      >
                        <Icons.panelRight size={14} />
                        <span>Slide on hover</span>
                        <Show when={isPanelHoverSlide(props.id)}>
                          <Icons.check size={12} class="ml-auto opacity-80" />
                        </Show>
                      </button>
                    </Show>
                    <Show when={props.menuExtra}>
                      <div class="axis-panel-menu-sep" role="separator" />
                      {props.menuExtra}
                    </Show>
                  </div>
                </Show>
              </div>
              <span class="flex-1 truncate min-w-0 axis-panel-title">{title()}</span>
              <Show when={!hoverCollapsed() && props.headerExtra}>{props.headerExtra}</Show>
              <div
                class="flex items-center gap-0.5 flex-shrink-0"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Show when={!hoverCollapsed() && props.headerEnd}>{props.headerEnd}</Show>
                <Show when={!hoverCollapsed()}>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1"
                    title="Close"
                    aria-label="Close panel"
                    onClick={close}
                  >
                    <Icons.x />
                  </button>
                </Show>
              </div>
            </div>

            <div
              class="flex-1 min-h-0 overflow-auto axis-panel-body"
              classList={{ 'is-hover-hidden': hoverCollapsed() }}
              aria-hidden={hoverCollapsed() || undefined}
            >
              {props.children}
            </div>

            {/* Docked left/right: column width on free vertical edge */}
            <Show when={showSideWidthResize() && dock() === 'left'}>
              <ResizeHandle
                direction="grow-right"
                getSize={dockWidth}
                setSize={setDockWidth}
                min={meta().minW}
                class="absolute right-0 top-0 bottom-0"
              />
            </Show>
            <Show when={showSideWidthResize() && dock() === 'right'}>
              <ResizeHandle
                direction="grow-left"
                getSize={dockWidth}
                setSize={setDockWidth}
                min={meta().minW}
                class="absolute left-0 top-0 bottom-0"
              />
            </Show>
            {/* Bottom dock top edge, or split between stacked side panels */}
            <Show when={showBottomHeightResize()}>
              <ResizeHandle
                direction={dock() === 'bottom' ? 'grow-up' : 'grow-down'}
                getSize={dockHeight}
                setSize={dock() === 'bottom' ? setDockHeight : setStackedHeight}
                min={meta().minH}
                class={
                  dock() === 'bottom'
                    ? 'absolute left-0 right-0 top-0'
                    : 'absolute left-0 right-0 bottom-0'
                }
              />
            </Show>

            {/* Float: borders. Editor keeps full viewport height — width-only resize. */}
            <Show when={isFloat()}>
              <div
                class="sc-resize-handle absolute right-0 top-0 bottom-0"
                role="separator"
                aria-orientation="vertical"
                title="Drag to resize width"
                onPointerDown={onFloatResizePointerDown('e')}
              />
              <div
                class="sc-resize-handle absolute left-0 top-0 bottom-0"
                role="separator"
                aria-orientation="vertical"
                title="Drag to resize width"
                onPointerDown={onFloatResizePointerDown('w')}
              />
              <Show when={props.id !== 'editor'}>
                <div
                  class="sc-pane-resize-handle absolute left-0 right-3 bottom-0"
                  role="separator"
                  aria-orientation="horizontal"
                  title="Drag to resize"
                  onPointerDown={onFloatResizePointerDown('s')}
                />
                <div
                  class="sc-pane-resize-handle absolute left-0 right-0 top-0"
                  role="separator"
                  aria-orientation="horizontal"
                  title="Drag to resize"
                  onPointerDown={onFloatResizePointerDown('n')}
                />
                <div
                  class="axis-panel-resize"
                  title="Resize"
                  onPointerDown={onFloatResizePointerDown('se')}
                />
              </Show>
            </Show>
          </div>
      </Portal>
    </Show>
  );
};

/**
 * Full-screen dock zone highlights + skeleton ghost while a panel is dragged.
 * Mount once at the App root (above content).
 */
export const PanelDragOverlay: Component = () => {
  const preview = dragPreview;
  return (
    <Show when={preview()}>
      {(p) => (
        <div class="axis-dock-overlay" aria-hidden="true">
          <div class={`axis-dock-zone axis-dock-zone-left ${p().zone === 'left' ? 'is-hot' : ''}`} />
          <div class={`axis-dock-zone axis-dock-zone-right ${p().zone === 'right' ? 'is-hot' : ''}`} />
          <div
            class={`axis-dock-zone axis-dock-zone-bottom ${p().zone === 'bottom' ? 'is-hot' : ''}`}
          />
          <div
            class="axis-panel-skeleton"
            style={{
              left: `${p().x}px`,
              top: `${p().y}px`,
              width: `${p().w}px`,
              height: `${p().h}px`,
            }}
          >
            <div class="axis-panel-skeleton-bar">
              <span class="axis-panel-grip" />
              <span class="truncate">{p().title}</span>
            </div>
            <div class="axis-panel-skeleton-body">
              <div class="axis-sk-line" style={{ width: '72%' }} />
              <div class="axis-sk-line" style={{ width: '88%' }} />
              <div class="axis-sk-line" style={{ width: '54%' }} />
              <div class="axis-sk-line" style={{ width: '66%' }} />
              <div class="axis-sk-block" />
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

const companionWindows = new Map<PanelId, Window>();

function openCompanionWindow(id: PanelId, title: string) {
  try {
    const existing = companionWindows.get(id);
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const c = getPanelChrome(id);
    const w = window.open(
      '',
      `axis-panel-${id}`,
      `width=${Math.max(320, c.w)},height=${Math.max(240, c.h)},menubar=no,toolbar=no,location=no,status=no`,
    );
    if (!w) return;
    companionWindows.set(id, w);
    const doc = w.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<title>AXIS · ${title}</title>
<style>
  html,body{margin:0;height:100%;background:#0a0b10;color:#eceef4;
    font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{display:flex;flex-direction:column;height:100%}
  header{display:flex;align-items:center;gap:8px;padding:8px 10px;
    border-bottom:2px solid #3a3d4a;background:#111218;font-size:11px;
    text-transform:uppercase;letter-spacing:.06em;color:#8b8e9c;font-weight:650}
  main{flex:1;padding:16px;color:#8b8e9c;font-size:12px;line-height:1.5}
  code{color:#939fff}
  button{margin-top:12px;background:#171821;color:#eceef4;border:2px solid #3a3d4a;
    padding:6px 12px;cursor:pointer;border-radius:2px;font:inherit}
  button:hover{border-color:#939fff;color:#939fff}
  .grip{display:inline-flex;flex-direction:column;gap:2px;margin-right:6px}
  .grip i{display:block;width:10px;height:2px;background:#5c5f6e}
</style></head><body><div class="wrap">
<header><span class="grip"><i></i><i></i><i></i></span>${title}</header>
<main>
  <p><strong style="color:#eceef4">${title}</strong> is detached to this window.</p>
  <p>The live panel stays in the main AXIS tab (float mode). Use this window as a focus space, or close it and choose <code>Dock</code> / <code>Float</code> from the panel handle.</p>
  <button type="button" id="reattach">Reattach &amp; close</button>
</main></div>
<script>
  document.getElementById('reattach').onclick = function(){
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'axis-panel-reattach', id: '${id}' }, '*');
      }
    } catch (e) {}
    window.close();
  };
  window.addEventListener('beforeunload', function(){
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'axis-panel-window-closed', id: '${id}' }, '*');
      }
    } catch (e) {}
  });
</script></body></html>`);
    doc.close();
  } catch {
    /* popup blocked */
  }
}

/**
 * Listen for `axis-panel-reattach` / `axis-panel-window-closed` postMessages
 * from companion popups. Returns an unsubscribe for `onCleanup`.
 */
export function installPanelWindowBridge() {
  const onMsg = (ev: MessageEvent) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'axis-panel-reattach' && typeof d.id === 'string') {
      setPanelDock(d.id as PanelId, 'float');
      setPanelOpen(d.id as PanelId, true);
      const w = companionWindows.get(d.id as PanelId);
      try {
        w?.close();
      } catch {
        /* ignore */
      }
      companionWindows.delete(d.id as PanelId);
    }
    if (d.type === 'axis-panel-window-closed' && typeof d.id === 'string') {
      companionWindows.delete(d.id as PanelId);
      // Keep float open in main
      const c = getPanelChrome(d.id as PanelId);
      if (c.dock === 'window') setPanelDock(d.id as PanelId, 'float');
    }
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}
