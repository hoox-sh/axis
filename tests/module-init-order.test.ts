/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Module-init regression: `data/data-manager-source` must be importable as the
 * **first** module in a graph.
 *
 * It used to import the store, which closes the cycle
 * `data-manager-source → store → storage/service → plugins/bootstrap →
 * sources/catalog → expand-cache → data-manager-source`. `expand-cache` reads
 * `DATA_MANAGER_SOURCE_ID` while it evaluates, so importing the data-manager
 * module first crashed with:
 *
 *   ReferenceError: Cannot access 'DATA_MANAGER_SOURCE_ID' before initialization
 *
 * The import order in this file is the test: `data-manager-source` must stay the
 * first import. Do not reorder it below `bun:test`.
 */

import {
  DATA_MANAGER_SOURCE_ID,
  clearDataManagerSelection,
  resolveDataManagerVenueSource,
  setDataManagerSelection,
} from '../src/data/data-manager-source';
import { describe, expect, it } from 'bun:test';

describe('module init order', () => {
  it('initializes the data-manager module without a cyclic TDZ', () => {
    expect(DATA_MANAGER_SOURCE_ID).toBe('data-manager');
  });

  it('resolves the venue from an explicit stream id', () => {
    clearDataManagerSelection();
    expect(resolveDataManagerVenueSource('binance-ws')).toBe('binance-rest');
    expect(resolveDataManagerVenueSource('okx-ws')).toBe('okx-rest');
    expect(resolveDataManagerVenueSource('bybit-ws')).toBe('bybit-rest');
    expect(resolveDataManagerVenueSource()).toBe('binance-rest');
  });

  it('prefers an explicit dataset selection over the stream id', () => {
    setDataManagerSelection('kraken-rest', 'BTCUSDT', '1d');
    try {
      expect(resolveDataManagerVenueSource('okx-ws')).toBe('kraken-rest');
    } finally {
      clearDataManagerSelection();
    }
  });

  it('does not import the store from the data-manager module graph', async () => {
    const source = await Bun.file(
      new URL('../src/data/data-manager-source.ts', import.meta.url),
    ).text();
    expect(source).not.toMatch(/from '\.\.\/store'/);
    expect(source).not.toMatch(/from '\.\.\/store\/index'/);
  });
});
