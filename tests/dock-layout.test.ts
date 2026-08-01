// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dock column helpers — open panels share left/right side-by-side
 * (DOCK_STACK_ORDER is left→right); bottom stacks top→bottom.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  DOCK_STACK_ORDER,
  dockColumnWidth,
  dockStackCount,
  dockStackCssOrder,
  isLastInDockStack,
  panelsOnDock,
} from '../src/ui/panels/dock-layout.ts';
import {
  store,
  setStore,
  setPanelOpen,
  setPanelDock,
  setPanelGeometry,
  getPanelChrome,
} from '../src/store/index.ts';
import { defaultPanelChromeMap } from '../src/ui/panels/types.ts';

beforeEach(() => {
  // All panels closed (defaults open watchlist+editor)
  const chrome = defaultPanelChromeMap();
  for (const id of Object.keys(chrome) as (keyof typeof chrome)[]) {
    chrome[id] = { ...chrome[id], open: false };
  }
  setStore('panelChrome', chrome);
  setStore('watchlist', 'open', false);
  setStore('editor', { open: false, width: 460, mode: 'docked' });
  setStore('indicatorPanel', { open: false, width: 224 });
  setStore('layerPanel', { open: false, width: 240 });
  setStore('dataViewPanel', { open: false, width: 240 });
  setStore('alertsPanel', { open: false, width: 280 });
  setStore('resultsPanel', { open: false, height: 220 });
  setStore('logsPanel', { open: false, height: 160 });
});

describe('panelsOnDock / stack order', () => {
  it('returns empty when nothing is open on a side', () => {
    expect(panelsOnDock('left')).toEqual([]);
    expect(dockStackCount('left')).toBe(0);
    expect(dockColumnWidth('left')).toBe(0);
  });

  it('orders two left-docked panels start→end (side-by-side)', () => {
    setPanelDock('watchlist', 'left');
    setPanelOpen('watchlist', true);
    setPanelDock('layers', 'left');
    setPanelOpen('layers', true);

    expect(panelsOnDock('left')).toEqual(['watchlist', 'layers']);
    expect(dockStackCount('left')).toBe(2);
    expect(isLastInDockStack('layers', 'left')).toBe(true);
    expect(isLastInDockStack('watchlist', 'left')).toBe(false);
    expect(dockStackCssOrder('watchlist')).toBeLessThan(dockStackCssOrder('layers'));
  });

  it('sums widths for side-by-side right dock (indicators left of editor)', () => {
    setPanelDock('indicators', 'right');
    setPanelGeometry('indicators', { w: 224 });
    setPanelOpen('indicators', true);
    setPanelDock('editor', 'right');
    setPanelGeometry('editor', { w: 460 });
    setPanelOpen('editor', true);

    expect(panelsOnDock('right')).toEqual(['indicators', 'editor']);
    // indicators before editor in order ⇒ left of editor in a row
    expect(dockStackCssOrder('indicators')).toBeLessThan(dockStackCssOrder('editor'));
    expect(dockColumnWidth('right')).toBe(224 + 460);
  });

  it('single panel width is not summed', () => {
    setPanelDock('editor', 'right');
    setPanelGeometry('editor', { w: 460 });
    setPanelOpen('editor', true);
    expect(dockColumnWidth('right')).toBe(460);
  });

  it('ignores panels docked elsewhere', () => {
    setPanelDock('watchlist', 'left');
    setPanelOpen('watchlist', true);
    setPanelDock('editor', 'right');
    setPanelOpen('editor', true);

    expect(panelsOnDock('left')).toEqual(['watchlist']);
    expect(panelsOnDock('right')).toEqual(['editor']);
  });

  it('covers every PanelId in stack order', () => {
    for (const id of Object.keys(store.panelChrome)) {
      expect(DOCK_STACK_ORDER.includes(id as (typeof DOCK_STACK_ORDER)[number])).toBe(true);
    }
  });
});

describe('side-by-side column width', () => {
  it('keeps independent widths when one peer is resized', () => {
    setPanelDock('watchlist', 'left');
    setPanelGeometry('watchlist', { w: 200 });
    setPanelOpen('watchlist', true);
    setPanelDock('layers', 'left');
    setPanelGeometry('layers', { w: 240 });
    setPanelOpen('layers', true);

    setPanelGeometry('watchlist', { w: 280 });
    expect(getPanelChrome('watchlist').w).toBe(280);
    // Peer keeps its own width (side-by-side, not shared strip width)
    expect(getPanelChrome('layers').w).toBe(240);
    expect(dockColumnWidth('left')).toBe(280 + 240);
  });

  it('rebalances height weights when a second panel docks left', () => {
    setPanelDock('watchlist', 'left');
    setPanelOpen('watchlist', true);
    setPanelGeometry('watchlist', { h: 400 });

    setPanelDock('layers', 'left');
    setPanelOpen('layers', true);

    // Equal height weights (both full-height in a row; h is chrome weight)
    expect(getPanelChrome('watchlist').h).toBe(100);
    expect(getPanelChrome('layers').h).toBe(100);
  });
});
