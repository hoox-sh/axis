// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart-script visibility = execution gate.
 *
 * Hidden scripts are removed from the pane and skipped by live re-runs.
 * Showing a script re-runs it on current bars (and keeps it in the live loop).
 *
 * @module indicators/visibility
 */

import { store, updateIndicator } from '../store';
import { getManager } from '../chart/manager-access';

/** Clear this script’s overlays on its pane and the price pane (force_overlay). */
export function clearScriptChartOverlays(id: string, paneId?: string): void {
  const script = store.scripts.find((s) => s.id === id);
  const pane = paneId || script?.paneId || 'price';
  const manager = getManager();
  if (!manager) return;
  try {
    if (typeof manager.removeOverlaysForOwner === 'function') {
      manager.removeOverlaysForOwner(pane, id);
      if (pane !== 'price') manager.removeOverlaysForOwner('price', id);
    } else if (typeof manager.removeOverlays === 'function') {
      manager.removeOverlays(pane);
    }
  } catch {
    /* chart dispose races */
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
  if (store.live?.active) {
    void import('../streams/multiplex')
      .then((m) => {
        m.scheduleLiveRerun?.();
      })
      .catch(() => {
        /* multiplex optional */
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
