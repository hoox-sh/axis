/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain scalar overlays on the price pane (apply / clear).
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'bun:test';
import {
  applyOnchainOverlays,
  clearOnchainOverlays,
  ONCHAIN_PRICE_SCALE_ID,
  ONCHAIN_SERIES_PREFIX,
} from '../src/chart/onchain-overlay';
import './setup';
import { installLightweightChartsMock } from './helpers/mock-lwc';

beforeAll(() => {
  installLightweightChartsMock();
});

const { PaneManager } = await import('../src/chart/pane-manager');

function pts(n = 2): Array<{ time: number; value: number }> {
  return Array.from({ length: n }, (_, i) => ({ time: i + 1, value: 100 + i }));
}

describe('applyOnchainOverlays / clearOnchainOverlays', () => {
  let root: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    pm = new PaneManager(root);
    pm.createPane('price', 'price', 'Price');
  });

  afterEach(() => {
    try {
      pm.dispose();
    } catch {
      /* ignore */
    }
    root?.remove();
  });

  it('creates onchain_* series on the left scale and clears them', () => {
    applyOnchainOverlays(pm, [
      {
        key: 'tvl-aave',
        title: 'Aave TVL',
        color: '#7C3AED',
        points: pts(3),
      },
    ]);
    const pane = pm.getPane('price')!;
    const key = `${ONCHAIN_SERIES_PREFIX}tvl-aave`;
    expect(pane.series[key]).toBeDefined();
    expect(ONCHAIN_PRICE_SCALE_ID).toBe('left');

    clearOnchainOverlays(pm);
    expect(pane.series[key]).toBeUndefined();
  });

  it('keeps keys that already have the onchain_ prefix', () => {
    const key = `${ONCHAIN_SERIES_PREFIX}fees-1`;
    applyOnchainOverlays(pm, [
      {
        key,
        title: 'Fees',
        color: '#f59e0b',
        points: pts(),
      },
    ]);
    expect(pm.getPane('price')!.series[key]).toBeDefined();
  });

  it('removes stale onchain series not in the next apply set', () => {
    applyOnchainOverlays(pm, [
      { key: 'a', title: 'A', color: '#fff', points: pts() },
      { key: 'b', title: 'B', color: '#eee', points: pts() },
    ]);
    const pane = pm.getPane('price')!;
    expect(pane.series[`${ONCHAIN_SERIES_PREFIX}a`]).toBeDefined();
    expect(pane.series[`${ONCHAIN_SERIES_PREFIX}b`]).toBeDefined();

    applyOnchainOverlays(pm, [
      { key: 'a', title: 'A', color: '#fff', points: pts() },
    ]);
    expect(pane.series[`${ONCHAIN_SERIES_PREFIX}a`]).toBeDefined();
    expect(pane.series[`${ONCHAIN_SERIES_PREFIX}b`]).toBeUndefined();
  });

  it('skips invisible lines and empty points; clears when nothing remains', () => {
    applyOnchainOverlays(pm, [
      { key: 'hidden', title: 'H', color: '#0f0', points: pts(), visible: false },
      { key: 'empty', title: 'E', color: '#0f0', points: [] },
    ]);
    const pane = pm.getPane('price')!;
    expect(Object.keys(pane.series).filter((k) => k.startsWith(ONCHAIN_SERIES_PREFIX))).toEqual(
      [],
    );
  });

  it('no-ops when manager missing or price pane absent', () => {
    expect(() => clearOnchainOverlays(undefined)).not.toThrow();
    expect(() => clearOnchainOverlays(null)).not.toThrow();
    expect(() => applyOnchainOverlays(undefined, [{ key: 'x', title: 'X', color: '', points: pts() }])).not.toThrow();

    const bareRoot = document.createElement('div');
    document.body.appendChild(bareRoot);
    const bare = new PaneManager(bareRoot);
    try {
      expect(() =>
        applyOnchainOverlays(bare, [{ key: 'x', title: 'X', color: '', points: pts() }]),
      ).not.toThrow();
    } finally {
      bare.dispose();
      bareRoot.remove();
    }
  });

  it('caps at 8 on-chain lines', () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({
      key: `line-${i}`,
      title: `L${i}`,
      color: '#abc',
      points: pts(),
    }));
    applyOnchainOverlays(pm, lines);
    const keys = Object.keys(pm.getPane('price')!.series).filter((k) =>
      k.startsWith(ONCHAIN_SERIES_PREFIX),
    );
    expect(keys).toHaveLength(8);
  });
});
