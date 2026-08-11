// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Panel hover-slide preference + layout peek helpers.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  HOVER_SLIDE_PEEK_SIDE,
  HOVER_SLIDE_PEEK_BOTTOM,
  clearPanelHoverSlideExpanded,
  hoverSlideLayoutSize,
  isPanelHoverSlideExpanded,
  setPanelHoverSlideExpanded,
} from '../src/ui/panels/hover-slide.ts';
import { isHoverSlideEligible } from '../src/ui/panels/types.ts';
import {
  dockColumnWidth,
  panelDockLayoutWidth,
  panelDockLayoutHeight,
} from '../src/ui/panels/dock-layout.ts';
import {
  store,
  setStore,
  setPanelOpen,
  setPanelDock,
  setPanelGeometry,
  setPanelHoverSlide,
  togglePanelHoverSlide,
  isPanelHoverSlide,
  getPanelChrome,
} from '../src/store/index.ts';
import { defaultPanelChromeMap } from '../src/ui/panels/types.ts';

beforeEach(() => {
  const chrome = defaultPanelChromeMap();
  for (const id of Object.keys(chrome) as (keyof typeof chrome)[]) {
    chrome[id] = { ...chrome[id], open: false, hoverSlide: false };
    clearPanelHoverSlideExpanded(id);
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

describe('isHoverSlideEligible', () => {
  it('allows left/right/bottom only', () => {
    expect(isHoverSlideEligible('left')).toBe(true);
    expect(isHoverSlideEligible('right')).toBe(true);
    expect(isHoverSlideEligible('bottom')).toBe(true);
    expect(isHoverSlideEligible('float')).toBe(false);
    expect(isHoverSlideEligible('window')).toBe(false);
  });
});

describe('hoverSlideLayoutSize', () => {
  it('returns full size when hover-slide is off', () => {
    expect(
      hoverSlideLayoutSize('editor', 'right', 460, {
        hoverSlide: false,
        expanded: false,
      }),
    ).toBe(460);
  });

  it('returns peek when collapsed', () => {
    expect(
      hoverSlideLayoutSize('editor', 'right', 460, {
        hoverSlide: true,
        expanded: false,
      }),
    ).toBe(HOVER_SLIDE_PEEK_SIDE);
    expect(
      hoverSlideLayoutSize('results', 'bottom', 220, {
        hoverSlide: true,
        expanded: false,
      }),
    ).toBe(HOVER_SLIDE_PEEK_BOTTOM);
  });

  it('returns full size when expanded', () => {
    expect(
      hoverSlideLayoutSize('editor', 'right', 460, {
        hoverSlide: true,
        expanded: true,
      }),
    ).toBe(460);
  });

  it('ignores hover-slide for float dock', () => {
    expect(
      hoverSlideLayoutSize('dataview', 'float', 240, {
        hoverSlide: true,
        expanded: false,
      }),
    ).toBe(240);
  });
});

describe('setPanelHoverSlide / layout', () => {
  it('persists preference and starts collapsed when docked+open', () => {
    setPanelDock('watchlist', 'left');
    setPanelGeometry('watchlist', { w: 200 });
    setPanelOpen('watchlist', true);

    expect(isPanelHoverSlide('watchlist')).toBe(false);
    expect(dockColumnWidth('left')).toBe(200);

    setPanelHoverSlide('watchlist', true);
    expect(isPanelHoverSlide('watchlist')).toBe(true);
    expect(getPanelChrome('watchlist').hoverSlide).toBe(true);
    expect(isPanelHoverSlideExpanded('watchlist')).toBe(false);
    expect(panelDockLayoutWidth('watchlist')).toBe(HOVER_SLIDE_PEEK_SIDE);
    expect(dockColumnWidth('left')).toBe(HOVER_SLIDE_PEEK_SIDE);

    setPanelHoverSlideExpanded('watchlist', true);
    expect(panelDockLayoutWidth('watchlist')).toBe(200);
    expect(dockColumnWidth('left')).toBe(200);

    setPanelHoverSlideExpanded('watchlist', false);
    expect(dockColumnWidth('left')).toBe(HOVER_SLIDE_PEEK_SIDE);
  });

  it('togglePanelHoverSlide flips preference', () => {
    setPanelDock('editor', 'right');
    setPanelOpen('editor', true);
    expect(togglePanelHoverSlide('editor')).toBe(true);
    expect(isPanelHoverSlide('editor')).toBe(true);
    expect(togglePanelHoverSlide('editor')).toBe(false);
    expect(isPanelHoverSlide('editor')).toBe(false);
  });

  it('clears expand when undocked to float', () => {
    setPanelDock('layers', 'left');
    setPanelOpen('layers', true);
    setPanelHoverSlide('layers', true);
    setPanelHoverSlideExpanded('layers', true);
    expect(isPanelHoverSlideExpanded('layers')).toBe(true);

    setPanelDock('layers', 'float');
    expect(isPanelHoverSlideExpanded('layers')).toBe(false);
    // Preference stays; only runtime expand clears
    expect(isPanelHoverSlide('layers')).toBe(true);
  });

  it('bottom dock uses peek height when collapsed', () => {
    setPanelDock('results', 'bottom');
    setPanelGeometry('results', { h: 220 });
    setPanelOpen('results', true);
    setPanelHoverSlide('results', true);
    expect(panelDockLayoutHeight('results')).toBe(HOVER_SLIDE_PEEK_BOTTOM);
    setPanelHoverSlideExpanded('results', true);
    expect(panelDockLayoutHeight('results')).toBe(220);
  });
});
