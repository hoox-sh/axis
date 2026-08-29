/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ICON_MAP integrity — one Lucide glyph per canonical Icons key.
 */

import { describe, expect, it } from 'bun:test';
import { ICON_MAP, PANEL_ICON, findDuplicateIconGlyphs } from '../src/ui/icon-map';
import { PANEL_IDS } from '../src/ui/panels/panel-manager.ts';

describe('ICON_MAP', () => {
  it('has no duplicate Lucide glyphs among canonical keys', () => {
    expect(findDuplicateIconGlyphs()).toEqual([]);
  });

  it('maps every key to a non-empty Lucide name', () => {
    for (const [key, lucide] of Object.entries(ICON_MAP)) {
      expect(lucide.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('includes topbar panel intents', () => {
    const need = [
      'watchlist',
      'editor',
      'library',
      'scripts',
      'inputs',
      'layers',
      'dataSource',
      'onchain',
      'alerts',
      'dataView',
      'results',
      'scriptLogs',
      'systemLogs',
      'status',
      'architecture',
      'runtimes',
      'studio',
      'settings',
      'fullscreen',
      'maximize',
      'minimize',
    ] as const;
    for (const k of need) {
      expect(ICON_MAP[k]).toBeTruthy();
    }
  });
});

describe('PANEL_ICON', () => {
  it('covers every PanelId', () => {
    for (const id of PANEL_IDS) {
      expect(PANEL_ICON[id]).toBeTruthy();
    }
  });

  it('resolves each entry to a real ICON_MAP key', () => {
    for (const id of PANEL_IDS) {
      const key = PANEL_ICON[id];
      // Type system already enforces this; assert at runtime too in case
      // ICON_MAP is mutated independently of PANEL_ICON.
      expect((ICON_MAP as Record<string, string>)[key]).toBeTruthy();
    }
  });
});
