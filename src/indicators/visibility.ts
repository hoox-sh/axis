// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart-script visibility = execution gate.
 *
 * Hidden scripts are removed from the pane and skipped by live re-runs.
 * Owner-scoped drawings / fills / barcolor are cleared on hide; exclusive
 * sub-panes are destroyed when empty. Showing a script re-runs it on current
 * bars (and keeps it in the live loop).
 *
 * @module indicators/visibility
 */

import { store, updateIndicator, removePane } from '../store';
import {
  getManager,
  clearScriptPaneLayer,
  clearScriptPaneLayers,
  getDrawingLayer,
  getActiveDrawingLayer,
} from '../chart/manager-access';
import { detectScriptKind } from './script-meta';

/** Clear this script’s overlays on its pane and the price pane (force_overlay). */
export function clearScriptChartOverlays(id: string, paneId?: string): void {
  const script = store.scripts.find((s) => s.id === id);
  const pane = paneId || script?.paneId || 'price';
  const manager = getManager();
  if (!manager) return;
  const isSubPane = pane !== 'price' && pane !== 'volume';
  const othersOnPane = store.scripts.filter(
    (s) => s.id !== id && (s.paneId || 'price') === pane,
  );
  const otherVisible = store.scripts.some((s) => s.id !== id && s.visible);

  try {
    if (typeof manager.removeOverlaysForOwner === 'function') {
      manager.removeOverlaysForOwner(pane, id);
      if (pane !== 'price') manager.removeOverlaysForOwner('price', id);
    } else if (typeof manager.removeOverlays === 'function' && othersOnPane.length === 0) {
      manager.removeOverlays(pane);
    }
  } catch {
    /* chart dispose races */
  }
  try {
    manager.clearShapeMarkers?.(id);
  } catch {
    /* optional */
  }
  try {
    manager.clearTradeMarkers?.(id);
  } catch {
    /* optional */
  }
  try {
    if (isSubPane) {
      clearScriptPaneLayer?.(pane);
      const stillOnPane = store.scripts.some(
        (s) => s.id !== id && (s.paneId || 'price') === pane,
      );
      if (!stillOnPane) {
        try {
          manager.destroyPane?.(pane);
        } catch {
          /* optional */
        }
        if (store.panes.some((p) => p.id === pane)) {
          try {
            removePane(pane);
          } catch {
            /* optional */
          }
        }
      }
    }
  } catch {
    /* optional */
  }
  try {
    const layer = getActiveDrawingLayer() ?? getDrawingLayer();
    if (otherVisible) {
      layer?.clearScriptDrawings?.(id);
      layer?.clearPlotFills?.(id);
      manager.clearBarColors?.(id);
    } else {
      layer?.clearScriptDrawings?.();
      clearScriptPaneLayers?.();
      layer?.clearPlotFills?.();
      manager.clearBarColors?.();
    }
  } catch {
    /* optional */
  }
}

/**
 * Show or hide an applied script. Hide stops live execution and clears plots.
 * Show re-runs on current bars so the script is live without a manual start.
 */
export function setScriptChartVisible(id: string, visible: boolean): boolean {
  if (!id) return false;
  const script = store.scripts.find((s) => s.id === id);
  if (!script) return false;
  const next = !!visible;
  if (script.visible === next) return next;

  updateIndicator(id, { visible: next });

  if (!next) {
    clearScriptChartOverlays(id, script.paneId);
    return false;
  }

  const code = String(script.code || '').trim();
  if (detectScriptKind(code) === 'library') return true;

  if (store.live?.active) {
    void import('../streams/multiplex')
      .then((m) => {
        m.scheduleLiveRerun?.();
      })
      .catch(() => {
        /* multiplex optional */
      });
    return true;
  }

  if (code && Array.isArray(store.bars) && store.bars.length) {
    void import('./runner')
      .then(({ runAndApply }) =>
        runAndApply(code, id, {
          silent: true,
          openResults: false,
          inputs: script.inputValues,
          strategyProps: script.strategyProps,
        }),
      )
      .catch(() => {
        /* live / chart optional */
      });
  }
  return true;
}

/** Flip visibility and apply chart / live side effects. Returns the new visible flag. */
export function toggleScriptChartVisible(id: string): boolean {
  const script = store.scripts.find((s) => s.id === id);
  if (!script) return false;
  return setScriptChartVisible(id, !script.visible);
}
