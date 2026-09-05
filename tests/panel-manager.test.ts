// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Panel manager defaults, chart-overlay geometry, and bulk overlay control.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  chartOverlayGeometry,
  defaultPanelPosition,
  effectivePortalDock,
  getDefaultPanelChrome,
  isChartOverlayEligible,
  isPanelInChartOverlayMode,
  PANEL_IDS,
} from '../src/ui/panels/panel-manager.ts';
import { PANEL_META, defaultPanelChromeMap } from '../src/ui/panels/types.ts';
import {
  getPanelChrome,
  isAllPanelsChartOverlay,
  isPanelChartOverlay,
  resetPanelToDefault,
  setAllPanelsChartOverlay,
  setPanelChartOverlay,
  setPanelDock,
  setPanelGeometry,
  setPanelOpen,
  setStore,
} from '../src/store/index.ts';

describe('panel defaults', () => {
  it('PANEL_META has defaultX/defaultY for every panel', () => {
    for (const id of PANEL_IDS) {
      expect(PANEL_META[id].defaultX).toBeGreaterThanOrEqual(0);
      expect(PANEL_META[id].defaultY).toBeGreaterThanOrEqual(0);
      expect(getDefaultPanelChrome(id).x).toBe(PANEL_META[id].defaultX);
      expect(getDefaultPanelChrome(id).y).toBe(PANEL_META[id].defaultY);
    }
  });

  it('defaultPanelPosition places right docks on the right edge', () => {
    const pos = defaultPanelPosition('editor', 1200, 800);
    expect(pos.x).toBeGreaterThan(400);
    expect(pos.w).toBe(PANEL_META.editor.defaultW);
  });
});

describe('chart overlay geometry', () => {
  it('left/right/bottom snap to edges', () => {
    const base = defaultPanelChromeMap().editor;
    const L = chartOverlayGeometry({ ...base, dock: 'left', w: 200, chartOverlay: true }, 1000, 800);
    expect(L.x).toBe(0);
    expect(L.w).toBe(200);

    const R = chartOverlayGeometry({ ...base, dock: 'right', w: 300, chartOverlay: true }, 1000, 800);
    expect(R.x).toBe(700);
    expect(R.w).toBe(300);

    const B = chartOverlayGeometry({ ...base, dock: 'bottom', h: 180, chartOverlay: true }, 1000, 800);
    expect(B.y + B.h).toBeLessThanOrEqual(800);
    expect(B.w).toBe(1000);
  });

  it('effectivePortalDock routes overlay edge docks to float host', () => {
    const c = { ...defaultPanelChromeMap().watchlist, chartOverlay: true, dock: 'left' as const };
    expect(effectivePortalDock(c)).toBe('float');
    expect(isPanelInChartOverlayMode(c)).toBe(true);
    expect(isChartOverlayEligible('left')).toBe(true);
    expect(isChartOverlayEligible('float')).toBe(false);
  });
});

describe('resetPanelToDefault / setAllPanelsChartOverlay', () => {
  beforeEach(() => {
    setStore('panelChrome', defaultPanelChromeMap());
    setPanelOpen('editor', true);
    setPanelDock('editor', 'left');
    setPanelGeometry('editor', { x: 12, y: 12, w: 111, h: 222 });
    setPanelChartOverlay('editor', false);
  });

  it('resetPanelToDefault restores factory dock and size (keeps open)', () => {
    resetPanelToDefault('editor');
    const c = getPanelChrome('editor');
    expect(c.open).toBe(true);
    expect(c.dock).toBe('right');
    // Factory editor width is ~30vw (clamped)
    const expectW =
      typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
        ? Math.min(
            Math.max(Math.round(window.innerWidth * 0.3), 1),
            Math.floor(window.innerWidth * 0.9),
          )
        : 384;
    expect(c.w).toBe(expectW);
    expect(c.chartOverlay).toBe(false);
  });

  it('setPanelChartOverlay enables overlay flag', () => {
    setPanelDock('editor', 'right');
    setPanelChartOverlay('editor', true);
    expect(isPanelChartOverlay('editor')).toBe(true);
    expect(getPanelChrome('editor').dock).toBe('right');
  });

  it('setAllPanelsChartOverlay toggles every managed panel', () => {
    setAllPanelsChartOverlay(true);
    expect(isAllPanelsChartOverlay()).toBe(true);
    expect(isPanelChartOverlay('watchlist')).toBe(true);
    expect(isPanelChartOverlay('editor')).toBe(true);
    // Fixed strips also get the flag written but are not floatable shells
    setAllPanelsChartOverlay(false);
    expect(isAllPanelsChartOverlay()).toBe(false);
  });
});
