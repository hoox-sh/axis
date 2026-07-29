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
 */

import { Component, JSX, Show, createSignal, onCleanup } from 'solid-js';
import {
  store,
  getPanelChrome,
  setPanelOpen,
  setPanelDock,
  setPanelGeometry,
  bumpPanelZ,
} from '../../store';
import { Icons } from '../icons';
import {
  PANEL_META,
  type PanelDock,
  type PanelId,
  type DropZone,
} from './types';
import { dropZoneToDock, hitDropZone, skeletonSize } from './drop-zones';

export interface FloatableShellProps {
  id: PanelId;
  title?: string;
  children: JSX.Element;
  /** Extra header actions */
  headerExtra?: JSX.Element;
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

export function getDragPreview() {
  return dragPreview;
}

export const FloatableShell: Component<FloatableShellProps> = (props) => {
  const meta = () => PANEL_META[props.id];
  const chrome = () => getPanelChrome(props.id);
  const title = () => props.title || meta().title;
  const dock = () => chrome().dock;
  const isFloat = () => dock() === 'float' || dock() === 'window';

  let rootEl: HTMLDivElement | undefined;
  let drag: DragState | null = null;

  const close = () => setPanelOpen(props.id, false);

  const setDock = (d: PanelDock) => {
    setPanelDock(props.id, d);
    if (d === 'float') {
      // Seed float position near center-right if still at origin defaults
      const c = getPanelChrome(props.id);
      if (c.x < 8 && c.y < 8) {
        setPanelGeometry(props.id, {
          x: Math.max(24, window.innerWidth - c.w - 48),
          y: 56,
        });
      }
      bumpPanelZ(props.id);
    }
    if (d === 'window') {
      props.onPopoutWindow?.();
      openCompanionWindow(props.id, title());
    }
  };

  const onHandlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;

    const c = getPanelChrome(props.id);
    // Undock to float on drag from docked layout
    if (c.dock !== 'float' && c.dock !== 'window') {
      const rect = rootEl?.getBoundingClientRect();
      setPanelDock(props.id, 'float');
      setPanelGeometry(props.id, {
        x: rect?.left ?? e.clientX - 40,
        y: rect?.top ?? e.clientY - 12,
        w: rect?.width ?? c.w,
        h: rect?.height ?? c.h,
      });
    }
    bumpPanelZ(props.id);

    const cur = getPanelChrome(props.id);
    drag = {
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      origX: cur.x,
      origY: cur.y,
      origW: cur.w,
      origH: cur.h,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      if (!drag || drag.mode !== 'move') return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      const nx = Math.max(0, drag.origX + dx);
      const ny = Math.max(0, drag.origY + dy);
      setPanelGeometry(props.id, { x: nx, y: ny });

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
      } else {
        setPanelDock(props.id, 'float');
      }
      drag = null;
      setDragPreview(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    onCleanup(() => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    });
  };

  const onResizePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const cur = getPanelChrome(props.id);
    if (cur.dock !== 'float' && cur.dock !== 'window') return;
    drag = {
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      origX: cur.x,
      origY: cur.y,
      origW: cur.w,
      origH: cur.h,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!drag || drag.mode !== 'resize') return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      const minW = meta().minW;
      const minH = meta().minH;
      setPanelGeometry(props.id, {
        w: Math.max(minW, drag.origW + dx),
        h: Math.max(minH, drag.origH + dy),
      });
    };
    const onUp = () => {
      drag = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const shellStyle = (): JSX.CSSProperties => {
    const c = chrome();
    const d = dock();
    if (d === 'float' || d === 'window') {
      return {
        position: 'fixed',
        left: `${c.x}px`,
        top: `${c.y}px`,
        width: `${c.w}px`,
        height: `${c.h}px`,
        'z-index': String(c.z),
      };
    }
    if (d === 'left' || d === 'right') {
      return {
        width: `${c.w}px`,
        height: '100%',
      };
    }
    // bottom
    return {
      width: '100%',
      height: `${c.h}px`,
    };
  };

  const dockClass = () => {
    const d = dock();
    if (d === 'left') return 'axis-panel-dock axis-panel-dock-left';
    if (d === 'right') return 'axis-panel-dock axis-panel-dock-right';
    if (d === 'bottom') return 'axis-panel-dock axis-panel-dock-bottom';
    return 'axis-panel-float sc-float-panel';
  };

  return (
    <div
      ref={rootEl}
      class={`axis-panel-shell flex flex-col min-h-0 overflow-hidden ${dockClass()} ${props.class || ''}`}
      style={shellStyle()}
      data-panel-id={props.id}
      data-panel-dock={dock()}
      data-testid={props.testId}
      onPointerDown={() => {
        if (isFloat()) bumpPanelZ(props.id);
      }}
    >
      {/* Title bar / drag handle */}
      <div
        class="axis-panel-handle sc-float-panel-header cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onHandlePointerDown}
        title="Drag to move · drop on edges to dock"
      >
        <span class="axis-panel-grip" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span class="flex-1 truncate min-w-0">{title()}</span>
        <Show when={props.headerExtra}>{props.headerExtra}</Show>
        <div class="flex items-center gap-0.5 flex-shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            class={`sc-btn sc-btn-ghost px-1 ${dock() === 'left' ? 'text-accent' : ''}`}
            title="Dock left"
            aria-label="Dock left"
            onClick={() => setDock('left')}
          >
            <Icons.panelLeft />
          </button>
          <button
            type="button"
            class={`sc-btn sc-btn-ghost px-1 ${dock() === 'right' ? 'text-accent' : ''}`}
            title="Dock right"
            aria-label="Dock right"
            onClick={() => setDock('right')}
          >
            <Icons.panelRight />
          </button>
          <button
            type="button"
            class={`sc-btn sc-btn-ghost px-1 ${dock() === 'bottom' ? 'text-accent' : ''}`}
            title="Dock bottom"
            aria-label="Dock bottom"
            onClick={() => setDock('bottom')}
          >
            <Icons.panelBottom />
          </button>
          <button
            type="button"
            class={`sc-btn sc-btn-ghost px-1 ${dock() === 'float' ? 'text-accent' : ''}`}
            title="Float"
            aria-label="Float panel"
            onClick={() => setDock('float')}
          >
            <Icons.square />
          </button>
          <button
            type="button"
            class={`sc-btn sc-btn-ghost px-1 ${dock() === 'window' ? 'text-accent' : ''}`}
            title="Open in new window"
            aria-label="New window"
            onClick={() => setDock('window')}
          >
            <Icons.popout />
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1"
            title="Close"
            aria-label="Close panel"
            onClick={close}
          >
            <Icons.x />
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto axis-panel-body">{props.children}</div>

      <Show when={isFloat()}>
        <div
          class="axis-panel-resize"
          title="Resize"
          onPointerDown={onResizePointerDown}
        />
      </Show>
    </div>
  );
};

/** Full-screen dock zone + skeleton ghost while dragging */
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

/** Listen for reattach messages from companion windows */
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
