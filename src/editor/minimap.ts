// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Interactive minimap for the Pine editor.
 *
 * A canvas strip docked to the right edge of the editor container: one
 * 2px row per document line (width ∝ line length), an accent viewport box
 * for the visible range, and a cursor line. Click / drag scrolls the
 * editor. Re-renders on doc, viewport, and geometry changes (rAF
 * throttled); hidden when the container is narrower than
 * {@link MINIMAP_MIN_CONTAINER_WIDTH}.
 *
 * Owned by {@link PyneEditor}: constructed on mount, driven from the
 * editor update listener + scroller scroll events.
 *
 * @module editor/minimap
 */

import type { EditorView } from '@codemirror/view';

/** Minimap column width in px. */
export const MINIMAP_WIDTH = 72;
/** Row height per document line in px. */
export const MINIMAP_ROW_HEIGHT = 2;
/** Max lines rendered (beyond: uniformly sampled to keep huge scripts cheap). */
export const MINIMAP_MAX_LINES = 3000;
/** Container narrower than this hides the minimap. */
export const MINIMAP_MIN_CONTAINER_WIDTH = 520;

/** Fraction helpers shared with tests. */
export function scrollFraction(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const max = Math.max(1, scrollHeight - clientHeight);
  return Math.min(1, Math.max(0, scrollTop / max));
}

export function scrollTopForFraction(fraction: number, scrollHeight: number, clientHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.min(1, Math.max(0, fraction)) * max;
}

/** Viewport fraction of the whole document covered by the visible range. */
export function viewportFraction(
  visibleFrom: number,
  visibleTo: number,
  docLength: number,
): { from: number; to: number } {
  const len = Math.max(1, docLength);
  const clamp = (v: number) => Math.min(1, Math.max(0, v / len));
  return { from: clamp(visibleFrom), to: clamp(Math.max(visibleFrom + 1, visibleTo)) };
}

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** Imperative minimap bound to one EditorView + host container. */
export class EditorMinimap {
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private dragging = false;
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: () => void;
  private onScroll: () => void;

  constructor(
    private view: EditorView,
    private host: HTMLElement,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ax-minimap';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.width = `${MINIMAP_WIDTH}px`;
    host.appendChild(this.canvas);

    this.onPointerDown = (e: PointerEvent) => {
      this.dragging = true;
      try {
        this.canvas.setPointerCapture?.(e.pointerId);
      } catch {
        // Synthetic events (tests) have no active pointer — drag still works.
      }
      this.scrollToPointer(e);
    };
    this.onPointerMove = (e: PointerEvent) => {
      if (this.dragging) this.scrollToPointer(e);
    };
    this.onPointerUp = () => {
      this.dragging = false;
    };
    this.onScroll = () => this.schedule();
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    this.schedule();
  }

  /** Re-render on the next frame (coalesces bursts). */
  schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private scrollToPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const frac = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    const sd = this.view.scrollDOM;
    // Center the viewport on the pointer (clamped by the helper).
    const viewFrac = sd.clientHeight / Math.max(1, sd.scrollHeight);
    sd.scrollTop = scrollTopForFraction(frac - viewFrac / 2, sd.scrollHeight, sd.clientHeight);
  }

  private render(): void {
    const view = this.view;
    const doc = view.state.doc;
    const hostWidth = this.host.clientWidth;
    if (hostWidth < MINIMAP_MIN_CONTAINER_WIDTH) {
      this.canvas.style.display = 'none';
      this.host.dataset.minimap = 'off';
      return;
    }
    this.canvas.style.display = '';
    this.host.dataset.minimap = 'on';
    const lines = doc.lines;
    const step = Math.max(1, Math.ceil(lines / MINIMAP_MAX_LINES));
    const rows = Math.ceil(lines / step);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = MINIMAP_WIDTH;
    const h = Math.max(1, rows * MINIMAP_ROW_HEIGHT);
    // Fit the whole document into the visible container height: rows are
    // 2px at natural scale, compressed when the doc exceeds the viewport.
    const availH = Math.max(1, this.host.clientHeight || h);
    const scale = Math.min(1, availH / h);
    const drawH = Math.max(1, Math.round(h * scale));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(drawH * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(drawH * dpr);
      this.canvas.style.height = `${drawH}px`;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, drawH);

    // Longest line sets the width scale (sampled like rows).
    let maxLen = 1;
    for (let n = 1; n <= lines; n += step) {
      try {
        maxLen = Math.max(maxLen, doc.line(n).text.length);
      } catch {
        break;
      }
    }
    const barColor = cssVar('--color-text-faint', '#8a8f9e');
    ctx.fillStyle = barColor;
    ctx.globalAlpha = 0.75;
    const rowH = MINIMAP_ROW_HEIGHT * scale;
    const barH = Math.max(1, Math.floor(rowH));
    let row = 0;
    for (let n = 1; n <= lines; n += step, row++) {
      let len = 0;
      try {
        len = doc.line(n).text.length;
      } catch {
        break;
      }
      if (len === 0) continue;
      const bw = Math.max(2, Math.round((len / maxLen) * (w - 8)));
      ctx.fillRect(4, row * rowH, bw, barH);
    }
    ctx.globalAlpha = 1;

    // Viewport box from scroll position.
    const sd = view.scrollDOM;
    const frac = scrollFraction(sd.scrollTop, sd.scrollHeight, sd.clientHeight);
    const viewH = (sd.clientHeight / Math.max(1, sd.scrollHeight)) * drawH;
    const viewY = frac * (drawH - viewH);
    ctx.strokeStyle = cssVar('--color-accent', '#7aa2ff');
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, Math.max(0.5, viewY), w - 1, Math.max(2, viewH));

    // Cursor line.
    try {
      const head = view.state.selection.main.head;
      const cursorLine = doc.lineAt(head).number;
      const cy = Math.floor((cursorLine - 1) / step) * rowH;
      ctx.fillStyle = cssVar('--color-accent', '#7aa2ff');
      ctx.fillRect(0, cy, w, barH);
    } catch {
      /* selection out of range — skip */
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.canvas.remove();
  }
}
