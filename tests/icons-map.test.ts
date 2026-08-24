/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ICON_MAP integrity — one Lucide glyph per canonical Icons key.
 */

import { describe, expect, it } from 'bun:test';
import { ICON_MAP, findDuplicateIconGlyphs } from '../src/ui/icon-map';

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
