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
 * Right-click menu for one chart cell.
 *
 * Plot, price scale, time scale, indicator / volume panes, script chips, and
 * user drawings each get the actions that already exist for that surface.
 * A place-tool right-click still only cancels the draft.
 *
 * @module chart/ChartContextMenu
 */

import { type Component, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { createAlert } from '../alerts';
import { openScriptSourceInEditor } from '../editor/open-script-source';
import {
  openScriptSettings,
  persist,
  setActiveChartSlot,
  setChartType,
  setPaneVisible,
  setPanelOpen,
  setStatus,
  setStore,
  store,
} from '../store';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuEntry } from '../ui/context-menu';
import { getActiveSlotId, getSlotDrawingLayer, getSlotManager } from './chart-registry';
import {
  CHART_SCALE_EVENT,
  dispatchChartMenu,
  scrollChartToLatest,
  type ChartMenuEnv,
} from './context-actions';
import {
  buildChartMenu,
  chartMenuLabel,
  classifyChartPointer,
  pointerPrice,
  type ChartMenuContext,
  type PaneHitBox,
} from './context-menu';
import { resolveDrawingStyle, toolLabel, type Drawing } from './drawing-types';
import type { PaneManager, ManagedPane } from './pane-manager';
import { measureChartPlotRect } from './plot-rect';
import { formatPriceWithDecimals, resolvePriceDecimals } from './price-precision';
import { copyScreenshot, downloadScreenshot } from './screenshot';

function primarySeries(pane: ManagedPane | undefined) {
  if (!pane) return null;
  for (const key of ['candle', 'volume', 'equity'] as const) {
    const s = pane.series[key];
    if (s && typeof s.coordinateToPrice === 'function') return s;
  }
  for (const s of Object.values(pane.series)) {
    if (s && typeof s.coordinateToPrice === 'function') return s;
  }
  return null;
}

function paneBoxes(mgr: PaneManager): PaneHitBox[] {
  const out: PaneHitBox[] = [];
  for (const pane of mgr.getAllPanes()) {
    if (!pane.visible) continue;
    let el: HTMLElement | null = null;
    try {
      el = document.getElementById(mgr.paneDomId(pane.id));
    } catch {
      el = null;
    }
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    out.push({
      paneId: pane.id,
      paneType: pane.type,
      host: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      plot: measureChartPlotRect(pane.chart, el),
    });
  }
  return out;
}

function scaleSnapshot(mgr: PaneManager | undefined) {
  return {
    auto: mgr?.isPriceAutoScale?.() ?? true,
    log: mgr?.isPriceLogScale?.() ?? false,
    labels: mgr?.isPriceScaleLabelsVisible?.() ?? store.priceScaleLabelsVisible !== false,
    last: mgr?.isLastValueLabelsVisible?.() ?? store.lastValueLabelsVisible !== false,
    names: mgr?.isLastValueNamesVisible?.() ?? store.lastValueNamesVisible !== false,
  };
}

function notifyScale(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CHART_SCALE_EVENT));
}

export const ChartContextMenu: Component<{
  host: HTMLElement | undefined;
  slotId: string;
}> = (props) => {
  const [open, setOpen] = createSignal<{
    x: number;
    y: number;
    label: string;
    items: ContextMenuEntry[];
    env: ChartMenuEnv;
  } | null>(null);

  createEffect(() => {
    const host = props.host;
    if (!host || typeof host.addEventListener !== 'function') return;

    const onCtx = (ev: Event) => {
      const e = ev as MouseEvent;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      // Drawing rail and style bar own their own chrome.
      if (target?.closest?.('.axis-draw-overlay')) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const slotId = props.slotId;
      if (getActiveSlotId() !== slotId) {
        try {
          setActiveChartSlot(slotId);
        } catch {
          /* layout may not list this host */
        }
      }

      const mgr = getSlotManager(slotId);
      const layer = getSlotDrawingLayer(slotId);
      if (layer && layer.getTool() !== 'cursor') {
        layer.abortPlacement();
        setOpen(null);
        return;
      }

      const hit = mgr ? classifyChartPointer(e.clientX, e.clientY, paneBoxes(mgr)) : null;
      const chip = target?.closest?.('[data-script-id]');
      const scriptId = chip?.getAttribute?.('data-script-id') || '';
      const scriptRow = scriptId ? store.scripts.find((s) => s.id === scriptId) : undefined;

      let drawing: Drawing | undefined;
      if (
        !scriptRow &&
        layer &&
        hit &&
        hit.region === 'plot' &&
        (hit.paneId === 'price' || hit.paneType === 'price')
      ) {
        const id = layer.hitTestClient(e.clientX, e.clientY);
        if (id) drawing = layer.getDrawings().find((d) => d.id === id);
      }

      let price: number | null = null;
      let priceLabel: string | null = null;
      if (mgr && hit && (hit.region === 'plot' || hit.region === 'price-scale') && !drawing) {
        const pane = mgr.getPane(hit.paneId);
        const series = primarySeries(pane);
        let hostEl: HTMLElement | null = null;
        try {
          hostEl = document.getElementById(mgr.paneDomId(hit.paneId));
        } catch {
          hostEl = null;
        }
        if (pane && hostEl && series) {
          const rect = hostEl.getBoundingClientRect();
          const plot = measureChartPlotRect(pane.chart, hostEl);
          price = pointerPrice(e.clientY, rect.top, plot.top, (y) => series.coordinateToPrice(y));
          if (price != null) {
            const decimals = resolvePriceDecimals(store.priceScaleDecimals, {
              symbol: store.symbol,
              bars: store.bars,
            });
            priceLabel = formatPriceWithDecimals(price, decimals);
          }
        }
      }

      const scale = scaleSnapshot(mgr);
      const pane = hit && mgr ? mgr.getPane(hit.paneId) : undefined;
      const isPrice = !!hit && (hit.paneId === 'price' || hit.paneType === 'price');
      const paneScripts = hit
        ? store.scripts
            .filter((s) => (s.paneId || 'price') === hit.paneId)
            .map((s) => ({ id: s.id, name: s.name || 'Script', visible: s.visible !== false }))
        : [];

      let ctx: ChartMenuContext;
      if (scriptRow) {
        ctx = {
          kind: 'script',
          script: {
            id: scriptRow.id,
            name: scriptRow.name || 'Script',
            visible: scriptRow.visible !== false,
          },
        };
      } else if (drawing) {
        const st = resolveDrawingStyle(drawing);
        ctx = {
          kind: 'drawing',
          drawing: {
            label: toolLabel(drawing.kind),
            locked: st.locked,
            hidden: !!drawing.meta?.hidden,
            lockAll: !!store.drawingUi.lockAll,
          },
        };
      } else if (!hit) {
        ctx = { kind: 'chart' };
      } else if (hit.region === 'price-scale') {
        ctx = { kind: 'price-scale', scale, priceLabel };
      } else if (hit.region === 'time-scale') {
        ctx = { kind: 'time-scale' };
      } else if (!isPrice) {
        ctx = {
          kind: 'pane',
          paneLabel: pane?.label || hit.paneType || 'Pane',
          paneScripts,
          canHidePane: true,
        };
      } else {
        ctx = {
          kind: 'plot',
          scale,
          chartType: store.chartType,
          priceLabel,
        };
      }

      const drawingId = drawing?.id ?? null;
      const paneId = hit?.paneId ?? null;
      const alertPrice = price;
      const alertLabel = priceLabel;

      const env: ChartMenuEnv = {
        resetView: () => {
          try {
            mgr?.fitContent();
          } catch {
            /* ignore */
          }
        },
        scrollLatest: () => {
          try {
            scrollChartToLatest(mgr?.getPane('price')?.chart);
            mgr?.alignTimeRangesFromPrice();
          } catch {
            /* ignore */
          }
        },
        toggleAuto: () => {
          try {
            mgr?.togglePriceAutoScale();
          } catch {
            /* ignore */
          }
          notifyScale();
        },
        toggleLog: () => {
          try {
            mgr?.togglePriceLogScale();
          } catch {
            /* ignore */
          }
          notifyScale();
        },
        resetScale: () => {
          try {
            mgr?.applyPriceScaleOptions({ autoScale: true });
            mgr?.fitContent();
          } catch {
            /* ignore */
          }
          notifyScale();
        },
        toggleLabels: () => {
          const next = mgr
            ? mgr.togglePriceScaleLabelsVisible()
            : !(store.priceScaleLabelsVisible !== false);
          setStore('priceScaleLabelsVisible', next);
          persist();
          notifyScale();
        },
        toggleLast: () => {
          const next = mgr
            ? mgr.toggleLastValueLabelsVisible()
            : !(store.lastValueLabelsVisible !== false);
          setStore('lastValueLabelsVisible', next);
          persist();
          notifyScale();
        },
        toggleNames: () => {
          const next = mgr
            ? mgr.toggleLastValueNamesVisible()
            : !(store.lastValueNamesVisible !== false);
          setStore('lastValueNamesVisible', next);
          persist();
          notifyScale();
        },
        setChartType: (id) => setChartType(id),
        copyPrice: () => {
          if (!alertLabel) return;
          const done = () => setStatus('ready', `Copied ${alertLabel}`, { toast: true, source: 'chart' });
          const fail = () => setStatus('ready', alertLabel, { toast: true, source: 'chart' });
          try {
            const p = navigator.clipboard?.writeText(alertLabel);
            if (p && typeof p.then === 'function') void p.then(done, fail);
            else done();
          } catch {
            fail();
          }
        },
        addAlert: () => {
          if (alertPrice == null || !alertLabel) return;
          const symbol = store.symbol || '';
          createAlert({
            name: `${symbol || 'Price'} cross ${alertLabel}`,
            symbol,
            kind: 'price_cross',
            interval: store.interval,
            params: { price: alertPrice },
          });
          setPanelOpen('alerts', true);
          setStatus('ready', `Alert at ${alertLabel}`, { toast: true, source: 'alerts' });
        },
        saveShot: () => {
          void downloadScreenshot().catch(() => {
            setStatus('error', 'Screenshot failed', { toast: true, source: 'screenshot' });
          });
        },
        copyShot: () => {
          void copyScreenshot().catch(() => {
            setStatus('error', 'Screenshot failed', { toast: true, source: 'screenshot' });
          });
        },
        openSettings: () => {
          window.dispatchEvent(new CustomEvent('axis-open-settings'));
        },
        hidePane: () => {
          if (!paneId || paneId === 'price') return;
          setPaneVisible(paneId, false);
          try {
            mgr?.setVisible(paneId, false);
          } catch {
            /* ignore */
          }
        },
        scriptSettings: (id) => openScriptSettings(id),
        scriptVisible: (id) => {
          void import('../indicators/visibility').then(({ toggleScriptChartVisible }) => {
            toggleScriptChartVisible(id);
          });
        },
        scriptSource: (id) => {
          const s = store.scripts.find((x) => x.id === id);
          if (!s) return;
          openScriptSourceInEditor(s.code || '', s.name);
        },
        scriptRerun: (id) => {
          const s = store.scripts.find((x) => x.id === id);
          if (!s?.code?.trim()) return;
          void import('../indicators/runner').then(({ runAndApply }) => {
            void runAndApply(s.code, id, {
              silent: false,
              openResults: false,
              inputs: s.inputValues,
            });
          });
        },
        scriptRemove: (id) => {
          const s = store.scripts.find((x) => x.id === id);
          const name = s?.name || 'script';
          if (typeof confirm === 'function' && !confirm(`Remove “${name}” from the chart?`)) return;
          void import('../indicators/detach').then(({ detachIndicatorFromChart }) => {
            detachIndicatorFromChart(id);
          });
        },
        drawingDuplicate: () => {
          if (!drawingId) return;
          getSlotDrawingLayer(slotId)?.duplicateById(drawingId);
        },
        drawingLock: () => {
          if (!drawingId) return;
          const live = getSlotDrawingLayer(slotId);
          const d = live?.getDrawings().find((x) => x.id === drawingId);
          if (!live || !d) return;
          const locked = !resolveDrawingStyle(d).locked;
          live.setSelectedId(drawingId);
          live.updateSelected({ locked, meta: { ...(d.meta || {}), locked } }, { allowLocked: true });
        },
        drawingHide: () => {
          if (!drawingId) return;
          const live = getSlotDrawingLayer(slotId);
          const d = live?.getDrawings().find((x) => x.id === drawingId);
          if (!live || !d) return;
          const hidden = !d.meta?.hidden;
          live.setSelectedId(drawingId);
          live.updateSelected({ meta: { ...(d.meta || {}), hidden } }, { allowLocked: true });
        },
        drawingFront: () => {
          if (!drawingId) return;
          getSlotDrawingLayer(slotId)?.reorderDrawing(drawingId, 'front');
        },
        drawingBack: () => {
          if (!drawingId) return;
          getSlotDrawingLayer(slotId)?.reorderDrawing(drawingId, 'back');
        },
        drawingDelete: () => {
          if (!drawingId) return;
          const live = getSlotDrawingLayer(slotId);
          if (!live) return;
          live.setSelectedId(drawingId);
          live.deleteSelected();
        },
      };

      setOpen({
        x: e.clientX,
        y: e.clientY,
        label: chartMenuLabel(ctx),
        items: buildChartMenu(ctx),
        env,
      });
    };

    host.addEventListener('contextmenu', onCtx, true);
    onCleanup(() => host.removeEventListener('contextmenu', onCtx, true));
  });

  return (
    <Show when={open()}>
      {(menu) => (
        <ContextMenu
          x={menu().x}
          y={menu().y}
          label={menu().label}
          items={menu().items}
          onClose={() => setOpen(null)}
          onSelect={(id) => dispatchChartMenu(id, menu().env)}
        />
      )}
    </Show>
  );
};
