/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Manager events plane — loadTvlSpikeEventsFromAttachment with fake points
 * (no network).
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  loadTvlSpikeEventsFromAttachment,
  clearOnchainEvents,
  onchainManagerState,
  _resetOnchainManagerState,
  _seedOnchainAttachmentsForTests,
  type OnchainSeriesRow,
} from '../src/onchain/manager';
import {
  EVENT_TYPE_TVL_DROP,
  EVENT_TYPE_TVL_SPIKE,
} from '../src/onchain/events';
import type { TimePoint } from '../src/onchain/types';

function fakeAttachment(
  id: string,
  points: TimePoint[],
  extras?: Partial<OnchainSeriesRow>,
): OnchainSeriesRow {
  const key = extras?.key ?? 'aave';
  const label =
    extras?.label ?? extras?.instrument?.symbol ?? `${key} TVL`;
  // loadTvlSpikeEventsFromAttachment prefers instrument.symbol for titles
  const symbol = extras?.instrument?.symbol ?? label;
  const { instrument: _inst, key: _k, label: _l, ...rest } = extras || {};
  return {
    id,
    datasetId: 'defillama-tvl',
    providerId: 'defillama',
    provider: 'defillama',
    key,
    instrument: {
      chainId: 'all',
      protocolId: key,
      metric: 'tvl',
      symbol,
      ...extras?.instrument,
      protocolId: extras?.instrument?.protocolId ?? key,
      symbol,
    },
    label,
    color: '#939fff',
    visible: true,
    scale: 'left',
    points,
    provenance: { provider: 'defillama' },
    finality: 'unknown',
    lastTvl: points.length ? points[points.length - 1]!.value : null,
    ...rest,
    key,
    label,
  };
}

beforeEach(() => {
  _resetOnchainManagerState();
});

describe('loadTvlSpikeEventsFromAttachment', () => {
  it('derives spike/drop events from attachment points (no network)', async () => {
    // day0: 100 → day1: 120 (+20%) → day2: 90 (−25%)
    const points: TimePoint[] = [
      { time: 100, value: 100 },
      { time: 200, value: 120 },
      { time: 300, value: 90 },
    ];
    _seedOnchainAttachmentsForTests([fakeAttachment('att-1', points)]);

    await loadTvlSpikeEventsFromAttachment('att-1');

    expect(onchainManagerState.eventsLoading).toBe(false);
    expect(onchainManagerState.eventsError).toBeNull();
    expect(onchainManagerState.events).toHaveLength(2);
    expect(onchainManagerState.events[0]!.type).toBe(EVENT_TYPE_TVL_SPIKE);
    expect(onchainManagerState.events[0]!.time).toBe(200);
    expect(onchainManagerState.events[1]!.type).toBe(EVENT_TYPE_TVL_DROP);
    expect(onchainManagerState.events[1]!.time).toBe(300);
    expect(onchainManagerState.eventSourceLabel).toMatch(/aave/i);
    expect(onchainManagerState.eventSourceLabel).toMatch(/TVL spikes/i);
  });

  it('respects custom thresholdPct', async () => {
    const points: TimePoint[] = [
      { time: 1, value: 1000 },
      { time: 2, value: 1050 }, // +5%
    ];
    _seedOnchainAttachmentsForTests([
      fakeAttachment('att-soft', points, { key: 'lido', label: 'Lido TVL' }),
    ]);

    // Default 10% → no events
    await loadTvlSpikeEventsFromAttachment('att-soft');
    expect(onchainManagerState.events).toHaveLength(0);

    // 5% threshold → one spike
    await loadTvlSpikeEventsFromAttachment('att-soft', 5);
    expect(onchainManagerState.events).toHaveLength(1);
    expect(onchainManagerState.events[0]!.type).toBe(EVENT_TYPE_TVL_SPIKE);
    expect(onchainManagerState.events[0]!.title).toMatch(/Lido/i);
  });

  it('errors when attachment is missing', async () => {
    await expect(loadTvlSpikeEventsFromAttachment('missing')).rejects.toThrow(
      /not found/i,
    );
    expect(onchainManagerState.eventsLoading).toBe(false);
    expect(onchainManagerState.events).toHaveLength(0);
    expect(onchainManagerState.eventsError).toMatch(/not found/i);
    expect(onchainManagerState.eventSourceLabel).toBeNull();
  });

  it('errors when points are insufficient', async () => {
    _seedOnchainAttachmentsForTests([
      fakeAttachment('att-short', [{ time: 1, value: 100 }]),
    ]);
    await expect(
      loadTvlSpikeEventsFromAttachment('att-short'),
    ).rejects.toThrow(/insufficient/i);
    expect(onchainManagerState.eventsError).toMatch(/insufficient/i);
    expect(onchainManagerState.events).toHaveLength(0);
  });

  it('clearOnchainEvents resets the events plane', async () => {
    const points: TimePoint[] = [
      { time: 1, value: 100 },
      { time: 2, value: 150 },
    ];
    _seedOnchainAttachmentsForTests([fakeAttachment('att-clr', points)]);
    await loadTvlSpikeEventsFromAttachment('att-clr');
    expect(onchainManagerState.events.length).toBeGreaterThan(0);

    clearOnchainEvents();
    expect(onchainManagerState.events).toEqual([]);
    expect(onchainManagerState.eventsLoading).toBe(false);
    expect(onchainManagerState.eventsError).toBeNull();
    expect(onchainManagerState.eventSourceLabel).toBeNull();
  });
});
