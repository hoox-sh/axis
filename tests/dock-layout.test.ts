// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dock column stacking helpers — open panels share left/right and stack
 * top-to-bottom in DOCK_STACK_ORDER.
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
  setStore('resultsPanel', { open: false, height: 220 });
  setStore('logsPanel', { open: false, height: 160 });
});

describe('panelsOnDock / stack order', () => {
  it('returns empty when nothing is open on a side', () => {
    expect(panelsOnDock('left')).toEqual([]);
    expect(dockStackCount('left')).toBe(0);
    expect(dockColumnWidth('left')).toBe(0);
  });

  it('stacks two left-docked panels in stable order', () => {
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

describe('shared column width', () => {
  it('syncs width across left peers when one is resized', () => {
    setPanelDock('watchlist', 'left');
    setPanelOpen('watchlist', true);
    setPanelDock('layers', 'left');
    setPanelOpen('layers', true);

    setPanelGeometry('watchlist', { w: 280 });
    expect(getPanelChrome('watchlist').w).toBe(280);
    expect(getPanelChrome('layers').w).toBe(280);
    expect(dockColumnWidth('left')).toBe(280);
  });

  it('rebalances flex heights when a second panel docks left', () => {
    setPanelDock('watchlist', 'left');
    setPanelOpen('watchlist', true);
    setPanelGeometry('watchlist', { h: 400 });

    setPanelDock('layers', 'left');
    setPanelOpen('layers', true);

    // Equal weights for flex stack
    expect(getPanelChrome('watchlist').h).toBe(100);
    expect(getPanelChrome('layers').h).toBe(100);
  });
});
