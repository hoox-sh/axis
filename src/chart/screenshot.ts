// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart screenshot capture — LWC pane canvases, optional drawing SVG overlay,
 * watermark, copy / download.
 *
 * @module chart/screenshot
 */

import { store, setStatus } from '../store';
import { getJson, setJson } from '../utils/storage';
import { getManager } from './manager-access';
import { getThemeManager } from '../theme';

/** Which pane canvases a capture includes: price pane, all panes, or the workspace. */
export type ScreenshotScope = 'price' | 'panes' | 'workspace';
/** Device-pixel multiplier applied to the output canvas. */
export type ScreenshotScale = 1 | 2;

/** Capture settings, persisted between sessions. */
export interface ScreenshotOptions {
  scope: ScreenshotScope;
  scale: ScreenshotScale;
  includeDrawings: boolean;
  includeWatermark: boolean;
}

/** Defaults when nothing is stored: all panes, 2×, drawings and watermark on. */
export const DEFAULT_SCREENSHOT_OPTIONS: ScreenshotOptions = {
  scope: 'panes',
  scale: 2,
  includeDrawings: true,
  includeWatermark: true,
};

const PREFS_KEY = 'pynescript.axis.screenshot';
const PANE_GAP = 2;

/** @returns stored capture options, each field validated; defaults when absent. */
export function loadScreenshotOptions(): ScreenshotOptions {
  const parsed = getJson<Partial<ScreenshotOptions>>(PREFS_KEY);
  if (!parsed) return { ...DEFAULT_SCREENSHOT_OPTIONS };
  return {
    scope:
      parsed.scope === 'price' || parsed.scope === 'workspace' || parsed.scope === 'panes'
        ? parsed.scope
        : DEFAULT_SCREENSHOT_OPTIONS.scope,
    scale: parsed.scale === 1 ? 1 : 2,
    includeDrawings: parsed.includeDrawings !== false,
    includeWatermark: parsed.includeWatermark !== false,
  };
}

/** Persist capture options. @param opts full options bag (no partial merge). */
export function saveScreenshotOptions(opts: ScreenshotOptions): void {
  setJson(PREFS_KEY, opts);
}

/**
 * Download name for a capture.
 *
 * @param symbol ticker; unsafe characters become `_`
 * @param interval timeframe token
 * @param at timestamp rendered in UTC as `YYYYMMDD-HHmm`
 * @returns `axis-<symbol>-<interval>-<stamp>.png`
 */
export function screenshotFilename(
  symbol: string,
  interval: string,
  at: Date = new Date(),
): string {
  const sym = (symbol || 'chart').replace(/[^\w.-]+/g, '_');
  const tf = (interval || 'tf').replace(/[^\w]+/g, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
  return `axis-${sym}-${tf}-${stamp}.png`;
}

/**
 * One-line capture watermark: `AXIS · symbol · interval · venue · scripts · UTC time`.
 *
 * @param input symbol and interval, plus optional venue, script names (max 4),
 *   and the timestamp to print (defaults to now)
 */
export function watermarkText(input: {
  symbol: string;
  interval: string;
  venue?: string;
  scriptNames?: string[];
  at?: Date;
}): string {
  const at = input.at ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
  const bits = ['AXIS', input.symbol, input.interval];
  if (input.venue) bits.push(input.venue);
  const scripts = (input.scriptNames || []).filter(Boolean);
  if (scripts.length) bits.push(scripts.slice(0, 4).join(' · '));
  bits.push(when);
  return bits.filter(Boolean).join('  ·  ');
}

/** Vertical stack layout for pane canvases (unit-testable without a 2D context). */
export function stackLayout(
  sizes: Array<{ width: number; height: number }>,
  gap = PANE_GAP,
): { width: number; height: number; offsets: number[] } {
  const offsets: number[] = [];
  let y = 0;
  let width = 0;
  for (const s of sizes) {
    offsets.push(y);
    width = Math.max(width, Math.max(0, s.width));
    y += Math.max(0, s.height) + gap;
  }
  if (sizes.length) y -= gap;
  return { width, height: Math.max(0, y), offsets };
}

function themeBg(): string {
  return getThemeManager().getColor('chart.bg_color') || '#0a0b10';
}

function themeFg(): string {
  return store.theme === 'light' ? '#1a1c22' : '#e8eaf0';
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function stackCanvases(canvases: HTMLCanvasElement[], bg: string): HTMLCanvasElement | null {
  if (!canvases.length) return null;
  const layout = stackLayout(canvases.map((c) => ({ width: c.width, height: c.height })));
  const out = makeCanvas(layout.width, layout.height);
  const ctx = out?.getContext('2d');
  if (!out || !ctx) return canvases[0] ?? null;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  canvases.forEach((c, i) => {
    const x = Math.round((layout.width - c.width) / 2);
    ctx.drawImage(c, x, layout.offsets[i] ?? 0);
  });
  return out;
}

function scaleCanvas(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale === 1) return src;
  const out = makeCanvas(src.width * scale, src.height * scale);
  const ctx = out?.getContext('2d');
  if (!out || !ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

function paintWatermark(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !text) return;
  const pad = Math.max(10, Math.round(canvas.width * 0.012));
  const size = Math.max(11, Math.min(16, Math.round(canvas.width / 90)));
  ctx.save();
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = themeFg();
  ctx.globalAlpha = 0.72;
  ctx.shadowColor = themeBg();
  ctx.shadowBlur = 4;
  ctx.fillText(text, pad, canvas.height - pad, canvas.width - pad * 2);
  ctx.restore();
}

function paintWorkspaceHeader(canvas: HTMLCanvasElement, title: string): HTMLCanvasElement {
  const bar = Math.max(28, Math.round(canvas.width * 0.028));
  const out = makeCanvas(canvas.width, canvas.height + bar);
  const ctx = out?.getContext('2d');
  if (!out || !ctx) return canvas;
  ctx.fillStyle = themeBg();
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = themeFg();
  ctx.globalAlpha = 0.92;
  ctx.font = `600 ${Math.max(12, Math.round(bar * 0.42))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(title, Math.max(12, bar * 0.4), bar / 2, out.width - 24);
  ctx.globalAlpha = 1;
  ctx.drawImage(canvas, 0, bar);
  return out;
}

async function rasterizeSvg(
  svg: SVGSVGElement,
  width: number,
  height: number,
): Promise<HTMLCanvasElement | null> {
  if (!width || !height || typeof Image === 'undefined') return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image();
  img.decoding = 'async';
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded) return null;
  const c = makeCanvas(width, height);
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  return c;
}

function paneHost(paneId: string): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return null;
  }
  try {
    const esc =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(paneId)
        : paneId.replace(/"/g, '\\"');
    return document.querySelector(`[data-pane-id="${esc}"]`);
  } catch {
    return null;
  }
}

async function capturePaneCanvas(
  paneId: string,
  includeDrawings: boolean,
): Promise<HTMLCanvasElement | null> {
  const mgr = getManager();
  const pane = mgr?.getPane(paneId);
  if (!pane?.chart || typeof pane.chart.takeScreenshot !== 'function') return null;
  let shot: HTMLCanvasElement;
  try {
    shot = pane.chart.takeScreenshot();
  } catch {
    return null;
  }
  if (!shot?.width || !shot.height) return null;
  if (!includeDrawings) return shot;
  const host = paneHost(paneId);
  const svg = host?.querySelector?.('svg.axis-drawing-layer') as SVGSVGElement | null;
  if (!svg) return shot;
  const overlay = await rasterizeSvg(svg, shot.width, shot.height);
  if (!overlay) return shot;
  const ctx = shot.getContext('2d');
  if (ctx) ctx.drawImage(overlay, 0, 0);
  return shot;
}

function visiblePaneIds(scope: ScreenshotScope): string[] {
  const mgr = getManager();
  const all = mgr?.getAllPanes?.() ?? [];
  const visible = all.filter((p) => p.visible !== false);
  if (scope === 'price') {
    const price = visible.find((p) => p.id === 'price' || p.type === 'price');
    return price ? [price.id] : visible.slice(0, 1).map((p) => p.id);
  }
  const order = ['price', 'volume'];
  return [...visible]
    .sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return 0;
    })
    .map((p) => p.id);
}

/** Pane geometry of the one shared chart (v1 layout). */
export type SharedChartPlan = {
  /** CSS-px size of the chart's pane stack + time axis. */
  width: number;
  height: number;
  /** Visible panes in chart order, with their CSS-px offset from the top. */
  panes: Array<{ id: string; top: number; height: number }>;
  timeAxis: { top: number; height: number };
};

/**
 * Geometry when every pane is an LWC pane on **one** chart.
 *
 * `chart.takeScreenshot()` is chart-level, so in the v1 layout the facade of
 * any pane returns the whole chart — capturing per pane stacked N copies of the
 * same image (a 4-pane chart produced a 4× repeated PNG).
 */
function sharedChartPlan(ids: string[]): SharedChartPlan | null {
  const mgr = getManager();
  const plan = (mgr as { screenshotPlan?: (ids: string[]) => SharedChartPlan | null } | undefined)
    ?.screenshotPlan;
  if (typeof plan !== 'function') return null;
  try {
    return plan.call(mgr, ids);
  } catch {
    return null;
  }
}

/** CSS px from an inline style value (`12.5px` → 12.5); 0 when unset. */
function stylePx(value: string | null | undefined): number {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Screenshot-pixel crop for one shared-chart capture.
 *
 * `ratio` maps CSS px (LWC pane heights) onto the screenshot canvas, so the
 * math is DPR- and scale-independent. `panes` scope keeps the whole stack;
 * `price` keeps the price pane and re-attaches the shared time axis below it
 * (the axis lives once, at the bottom of the chart).
 *
 * @param plan pane geometry from `PaneManager.screenshotPlan`
 * @param scope capture scope
 * @param shotHeight captured canvas height in device px
 * @returns crop in screenshot px (`top` is the pane-stack offset)
 */
export function screenshotCrop(
  plan: SharedChartPlan,
  scope: ScreenshotScope,
  shotHeight: number,
): { top: number; height: number; timeAxisTop: number; timeAxisHeight: number } | null {
  if (!(shotHeight > 0) || !(plan.height > 0) || !plan.panes.length) return null;
  const ratio = shotHeight / plan.height;
  const timeAxisTop = Math.round(plan.timeAxis.top * ratio);
  const timeAxisHeight = Math.max(0, Math.round(plan.timeAxis.height * ratio));
  if (scope !== 'price') {
    return { top: 0, height: shotHeight, timeAxisTop, timeAxisHeight };
  }
  const box = plan.panes.find((p) => p.id === 'price') ?? plan.panes[0];
  if (!box) return null;
  return {
    top: Math.round(box.top * ratio),
    height: Math.max(1, Math.round(box.height * ratio)),
    timeAxisTop,
    timeAxisHeight,
  };
}

/**
 * Composite the pane drawing SVGs onto a chart screenshot.
 *
 * Each layer sits in its pane's plot rect; its inline `left`/`top`/`width`/
 * `height` are the geometry it paints at, so scaling by the screenshot ratio
 * lands it exactly where the live chart shows it.
 */
async function compositeDrawings(
  target: HTMLCanvasElement,
  plan: SharedChartPlan,
  ids: string[],
  ratio: number,
  cropTop: number,
  priceOnly: boolean,
): Promise<void> {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  for (const id of ids) {
    if (priceOnly && id !== 'price') continue;
    const box = plan.panes.find((p) => p.id === id);
    if (!box) continue;
    const svg = paneHost(id)?.querySelector?.('svg.axis-drawing-layer') as SVGSVGElement | null;
    if (!svg) continue;
    const w = Number(svg.getAttribute('width')) || svg.clientWidth || 0;
    const h = Number(svg.getAttribute('height')) || svg.clientHeight || 0;
    if (!(w > 0) || !(h > 0)) continue;
    const overlay = await rasterizeSvg(svg, Math.round(w * ratio), Math.round(h * ratio));
    if (!overlay) continue;
    ctx.drawImage(
      overlay,
      Math.round(stylePx(svg.style.left) * ratio),
      Math.round((box.top + stylePx(svg.style.top)) * ratio) - cropTop,
    );
  }
}

/**
 * Capture the one shared chart, cropping to the price pane for that scope.
 *
 * @param plan pane geometry from {@link PaneManager.screenshotPlan}
 * @param ids panes the caller asked for
 * @param scope capture scope
 * @param includeDrawings composite the drawing SVG layers
 * @returns the chart canvas, or null when the chart cannot be captured
 */
async function captureSharedChart(
  plan: SharedChartPlan,
  ids: string[],
  scope: ScreenshotScope,
  includeDrawings: boolean,
): Promise<HTMLCanvasElement | null> {
  const mgr = getManager();
  const primary = ids.map((id) => mgr?.getPane(id)).find((p) => p?.chart);
  if (!primary?.chart || typeof primary.chart.takeScreenshot !== 'function') return null;
  let shot: HTMLCanvasElement;
  try {
    shot = primary.chart.takeScreenshot();
  } catch {
    return null;
  }
  if (!shot?.width || !shot.height) return null;
  const ratio = shot.height / Math.max(1, plan.height);
  const crop = screenshotCrop(plan, scope, shot.height);

  let out: HTMLCanvasElement = shot;
  let cropTop = 0;
  if (crop && scope === 'price') {
    const cropped = makeCanvas(shot.width, crop.height + crop.timeAxisHeight);
    const ctx = cropped?.getContext('2d');
    if (!cropped || !ctx) return shot;
    ctx.drawImage(shot, 0, crop.top, shot.width, crop.height, 0, 0, shot.width, crop.height);
    if (crop.timeAxisHeight > 0) {
      ctx.drawImage(
        shot,
        0,
        crop.timeAxisTop,
        shot.width,
        crop.timeAxisHeight,
        0,
        crop.height,
        shot.width,
        crop.timeAxisHeight,
      );
    }
    out = cropped;
    cropTop = crop.top;
  }
  if (includeDrawings) {
    await compositeDrawings(out, plan, ids, ratio, cropTop, scope === 'price');
  }
  return out;
}

/** Capture the active chart to a canvas using current options. */
export async function captureScreenshot(
  opts: ScreenshotOptions = loadScreenshotOptions(),
): Promise<HTMLCanvasElement> {
  const ids = visiblePaneIds(opts.scope);
  let stacked: HTMLCanvasElement | null = null;
  // v1 layout: every pane is an LWC pane on one chart, so one chart-level
  // capture already contains them all. Capturing per pane stacked N copies.
  const plan = sharedChartPlan(ids);
  if (plan) {
    stacked = await captureSharedChart(plan, ids, opts.scope, opts.includeDrawings);
  }
  if (!stacked) {
    // Legacy: one chart per pane (single-pane charts, test doubles).
    const panes: HTMLCanvasElement[] = [];
    for (const id of ids) {
      const c = await capturePaneCanvas(id, opts.includeDrawings);
      if (c) panes.push(c);
    }
    stacked = stackCanvases(panes, themeBg()) ?? panes[0] ?? null;
  }
  if (!stacked) {
    throw new Error('No chart to capture — load bars first');
  }
  stacked = scaleCanvas(stacked, opts.scale);
  const mark = watermarkText({
    symbol: store.symbol,
    interval: store.interval,
    venue: store.exchange || store.source,
    scriptNames: store.scripts.filter((s) => s.visible).map((s) => s.name),
  });
  if (opts.scope === 'workspace') {
    stacked = paintWorkspaceHeader(stacked, mark);
  } else if (opts.includeWatermark) {
    paintWatermark(stacked, mark);
  }
  return stacked;
}

/**
 * Encode a canvas as a PNG blob.
 *
 * @param canvas rendered chart canvas
 * @returns PNG blob; rejects when the browser cannot encode
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      try {
        const url = canvas.toDataURL('image/png');
        const bin = atob(url.split(',')[1] || '');
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/png' }));
      } catch (err) {
        reject(err);
      }
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encode failed'));
    }, 'image/png');
  });
}

/**
 * Trigger a browser download for a blob.
 *
 * @param blob payload to save
 * @param filename suggested name; no-op outside a DOM
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body?.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/**
 * Write a PNG to the clipboard.
 *
 * @param blob PNG payload
 * @returns true when the clipboard write succeeded; false when the API is missing or blocked
 */
export async function copyBlob(blob: Blob): Promise<boolean> {
  try {
    const clip = navigator.clipboard as Clipboard & {
      write?: (items: ClipboardItem[]) => Promise<void>;
    };
    if (typeof ClipboardItem === 'undefined' || typeof clip?.write !== 'function') {
      return false;
    }
    await clip.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the chart, encode it, and save it as a file.
 *
 * @param opts capture settings (defaults to the stored options)
 * @throws when there is no chart to capture (no bars loaded)
 */
export async function downloadScreenshot(
  opts: ScreenshotOptions = loadScreenshotOptions(),
): Promise<void> {
  const canvas = await captureScreenshot(opts);
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, screenshotFilename(store.symbol, store.interval));
  setStatus('ready', 'Screenshot saved', { toast: true, source: 'screenshot' });
}

/**
 * Capture the chart and copy it to the clipboard, falling back to a download
 * when the clipboard API is unavailable.
 *
 * @param opts capture settings (defaults to the stored options)
 * @throws when there is no chart to capture (no bars loaded)
 */
export async function copyScreenshot(
  opts: ScreenshotOptions = loadScreenshotOptions(),
): Promise<void> {
  const canvas = await captureScreenshot(opts);
  const blob = await canvasToBlob(canvas);
  const ok = await copyBlob(blob);
  if (ok) setStatus('ready', 'Screenshot copied', { toast: true, source: 'screenshot' });
  else {
    downloadBlob(blob, screenshotFilename(store.symbol, store.interval));
    setStatus('ready', 'Clipboard unavailable — downloaded instead', {
      toast: true,
      source: 'screenshot',
    });
  }
}
