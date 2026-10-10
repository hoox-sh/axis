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
 * Floating chart settings panel — SVG chamfered frame with a glowing 1px hairline.
 *
 * The frame is a single absolutely-positioned SVG (Method B). Its `viewBox` is
 * set to the panel's exact CSS-pixel size via `ResizeObserver`, so the 45°
 * chamfers and `vector-effect="non-scaling-stroke"` hairlines stay mathematically
 * exact at any size. All color flows through CSS variables (`--color-border`,
 * `--color-accent`, `--color-bg-elev`, `--color-bg-panel`).
 *
 * Controls are wired to the real chart store: chart type, interval (reload via
 * {@link loadSymbolData}), and the last-value / plot-name / price-scale label
 * toggles.
 *
 * @module ui/ChartSettingsPanel
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
} from 'solid-js';
import { Icons } from './icons';
import { store, setStore, setChartType, persist } from '../store';
import { CHART_TYPES } from '../chart/chart-type';
import { loadSymbolData } from '../data/load-symbol';
import { WATCHLIST_INTERVALS } from '../data/watchlist-tickers';
import { getManager } from '../chart/manager-access';
import { CHART_SCALE_EVENT } from '../chart/context-actions';

type Corner = 'tl' | 'tr' | 'br' | 'bl';

interface ChamferedCorners {
  tl?: boolean;
  tr?: boolean;
  br?: boolean;
  bl?: boolean;
}

export interface ChartSettingsPanelProps {
  /** Hide the panel (caller-controlled). Defaults to visible. */
  open?: boolean;
  /** Fired from the close button. */
  onClose?: () => void;
  /** Chamfer size in CSS px (equal on both axes → exact 45°). */
  chamfer?: number;
  /** Which corners to cut. Default: top-right + bottom-left. */
  corners?: ChamferedCorners;
  /** Extra classes applied to the frame root. */
  class?: string;
}

const DEFAULT_CORNERS: ChamferedCorners = { tr: true, bl: true };

/**
 * Build the chamfered rectangle path (clockwise) and the chamfer accent edges.
 * Returns pixel-exact strings from the measured box.
 */
function buildFramePath(
  w: number,
  h: number,
  c: number,
  corners: ChamferedCorners,
): { d: string; accents: string[] } {
  const spec: Record<Corner, { p1: [number, number]; p2: [number, number]; pc: [number, number] }> = {
    tl: { p1: [0, c], p2: [c, 0], pc: [0, 0] },
    tr: { p1: [w - c, 0], p2: [w, c], pc: [w, 0] },
    br: { p1: [w, h - c], p2: [w - c, h], pc: [w, h] },
    bl: { p1: [c, h], p2: [0, h - c], pc: [0, h] },
  };
  const pts: [number, number][] = [];
  const accents: string[] = [];
  for (const key of ['tl', 'tr', 'br', 'bl'] as Corner[]) {
    const s = spec[key];
    if (corners[key]) {
      pts.push(s.p1, s.p2);
      accents.push(`M ${s.p1[0]} ${s.p1[1]} L ${s.p2[0]} ${s.p2[1]}`);
    } else {
      pts.push(s.pc);
    }
  }
  const d = `M ${pts.map((p) => p.join(' ')).join(' L ')} Z`;
  return { d, accents };
}

const TOGGLES = [
  { key: 'lastValueLabelsVisible', label: 'Last-value labels' },
  { key: 'lastValueNamesVisible', label: 'Plot names' },
  { key: 'priceScaleLabelsVisible', label: 'Price-scale labels' },
] as const;

type ToggleKey = (typeof TOGGLES)[number]['key'];

const MANAGER_APPLY: Record<ToggleKey, (m: NonNullable<ReturnType<typeof getManager>>, on: boolean) => void> = {
  lastValueLabelsVisible: (m, on) => m.setLastValueLabelsVisible(on),
  lastValueNamesVisible: (m, on) => m.setLastValueNamesVisible(on),
  priceScaleLabelsVisible: (m, on) => m.setPriceScaleLabelsVisible(on),
};

export const ChartSettingsPanel: Component<ChartSettingsPanelProps> = (props) => {
  const chamfer = () => Math.max(6, props.chamfer ?? 14);
  const corners = () => ({ ...DEFAULT_CORNERS, ...props.corners });
  const uid = createUniqueId();

  const [dims, setDims] = createSignal({ w: 300, h: 320 });
  const [entered, setEntered] = createSignal(false);
  let root: HTMLDivElement | undefined;

  onMount(() => {
    const el = root;
    if (el) {
      const update = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w > 0 && h > 0) setDims({ w, h });
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    }
    requestAnimationFrame(() => setEntered(true));
  });

  const frame = () => buildFramePath(dims().w, dims().h, chamfer(), corners());

  const [logScale, setLogScale] = createSignal(false);
  const [autoScale, setAutoScale] = createSignal(true);

  const syncScaleState = () => {
    const m = getManager();
    if (m) {
      setLogScale(m.isPriceLogScale());
      setAutoScale(m.isPriceAutoScale());
    }
  };

  // Re-sync after data reloads and scale changes made elsewhere (scale cluster,
  // chart context menu) so the checkboxes never show stale state.
  createEffect(() => {
    void store.chartDataGen;
    syncScaleState();
  });

  onMount(() => {
    const onScale = () => syncScaleState();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) props.onClose?.();
    };
    window.addEventListener(CHART_SCALE_EVENT, onScale);
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener(CHART_SCALE_EVENT, onScale);
      window.removeEventListener('keydown', onKey);
    });
  });

  // Other surfaces (scale cluster, context menu) listen for this to resync.
  const notifyScale = () => window.dispatchEvent(new CustomEvent(CHART_SCALE_EVENT));

  const onLog = () => {
    const m = getManager();
    if (!m) return;
    setLogScale(m.togglePriceLogScale());
    notifyScale();
  };

  const onAuto = () => {
    const m = getManager();
    if (!m) return;
    setAutoScale(m.togglePriceAutoScale());
    notifyScale();
  };

  const onToggle = (key: ToggleKey) => {
    // Labels default to on (undefined ⇒ on); flip the effective value.
    const want = store[key] === false;
    setStore(key, want);
    const m = getManager();
    if (m) MANAGER_APPLY[key](m, want);
    persist();
    notifyScale();
  };

  const onInterval = (iv: string) => {
    setStore('interval', iv);
    void loadSymbolData(store.symbol, iv, store.source);
  };

  const checked = (key: ToggleKey) => store[key] !== false;

  return (
    <Show when={props.open !== false}>
      <div
        ref={root}
        class={`relative w-[300px] max-w-[calc(100vw-24px)] transition-[opacity,transform] duration-200 ease-out ${
          props.class ?? ''
        }`}
        style={{
          opacity: entered() ? 1 : 0,
          transform: entered() ? 'none' : 'translateY(8px) scale(0.985)',
        }}
        data-testid="axis-chart-settings-panel"
      >
        <svg
          class="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${dims().w} ${dims().h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ filter: 'var(--ax-drop-shadow)' }}
        >
          <defs>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ 'stop-color': 'var(--color-bg-elev)' }} />
              <stop offset="1" style={{ 'stop-color': 'var(--color-bg-panel)' }} />
            </linearGradient>
            <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" style={{ 'stop-color': 'var(--color-accent)', 'stop-opacity': 0 }} />
              <stop offset="0.5" style={{ 'stop-color': 'var(--color-accent)', 'stop-opacity': 0.05 }} />
              <stop offset="1" style={{ 'stop-color': 'var(--color-accent)', 'stop-opacity': 0 }} />
            </linearGradient>
            <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>

          <path
            d={frame().d}
            fill="none"
            style={{ stroke: 'var(--color-accent)' }}
            stroke-opacity="0.22"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
            filter={`url(#${uid}-glow)`}
          />

          <path
            d={frame().d}
            style={{ fill: `url(#${uid}-fill)`, stroke: 'var(--color-border)' }}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />

          <path
            d={frame().d}
            fill="none"
            style={{ stroke: `url(#${uid}-sheen)` }}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />

          <For each={frame().accents}>
            {(a) => (
              <path
                d={a}
                fill="none"
                style={{ stroke: 'var(--color-accent)' }}
                stroke-opacity="0.55"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
        </svg>

        <div class="relative flex flex-col gap-3 p-4">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
              <Icons.settings class="h-3.5 w-3.5 text-accent" />
              Chart settings
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-1.5 py-1"
              title="Close"
              aria-label="Close chart settings"
              onClick={() => props.onClose?.()}
            >
              <Icons.x />
            </button>
          </div>

          <div class="flex flex-col gap-1">
            <span class="sc-label !mb-0">Type</span>
            <div class="flex flex-wrap gap-1">
              <For each={CHART_TYPES}>
                {(t) => (
                  <button
                    type="button"
                    class={`sc-btn px-2 py-1.5 text-[11px] ${
                      store.chartType === t.id ? 'border-accent text-accent bg-accent/10' : ''
                    }`}
                    title={t.description}
                    data-testid={`axis-chart-settings-type-${t.id}`}
                    onClick={() => setChartType(t.id)}
                  >
                    {t.short}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <label class="sc-label !mb-0" for={`${uid}-interval`}>
              Interval
            </label>
            <select
              id={`${uid}-interval`}
              class="sc-input w-full text-[11px]"
              value={store.interval}
              data-testid="axis-chart-settings-interval"
              onChange={(e) => onInterval(e.currentTarget.value)}
            >
              <For each={WATCHLIST_INTERVALS}>
                {(iv) => <option value={iv}>{iv}</option>}
              </For>
            </select>
          </div>

          <div class="border-t border-border-soft pt-2.5">
            <div class="flex flex-col gap-2">
              <label class="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-text-dim">
                <span>Log scale</span>
                <input
                  type="checkbox"
                  checked={logScale()}
                  data-testid="axis-chart-settings-toggle-logscale"
                  onChange={onLog}
                />
              </label>
              <label class="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-text-dim">
                <span>Auto scale</span>
                <input
                  type="checkbox"
                  checked={autoScale()}
                  data-testid="axis-chart-settings-toggle-autoscale"
                  onChange={onAuto}
                />
              </label>
            </div>
          </div>

          <div class="border-t border-border-soft pt-2.5">
            <div class="flex flex-col gap-2">
              <For each={TOGGLES}>
                {({ key, label }) => (
                  <label class="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-text-dim">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={checked(key)}
                      data-testid={`axis-chart-settings-toggle-${key}`}
                      onChange={() => onToggle(key)}
                    />
                  </label>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
