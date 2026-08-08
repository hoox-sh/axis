/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain TVL / event alerts — pure engine matching + bridge delivery.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { installMemoryLocalStorage } from './setup';
import {
  DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT,
  _resetAlertsForTests,
  createAlert,
  createOnchainTvlSpikeAlert,
  evaluateOnchainEventAlertsPure,
  eventAbsPct,
  eventMatchesDirection,
  eventMatchesOnchainAlert,
  eventMatchesProtocol,
  formatAlertCondition,
  formatAlertKind,
  isOnchainTvlEventType,
  listAlerts,
  type Alert,
  type OnchainEvalEvent,
} from '../src/alerts/index';
import {
  evaluateOnchainEventAlerts,
  toOnchainEvalEvents,
} from '../src/onchain/alerts-bridge';
import {
  EVENT_TYPE_TVL_DROP,
  EVENT_TYPE_TVL_SPIKE,
} from '../src/onchain/events';
import type { EventPoint } from '../src/onchain/types';

const now = 1_700_000_100_000;

function baseOnchainAlert(over: Partial<Alert> = {}): Alert {
  return {
    id: over.id ?? 'oc1',
    name: over.name ?? 'TVL spike alert',
    enabled: over.enabled ?? true,
    symbol: over.symbol ?? 'aave',
    kind: over.kind ?? 'onchain_tvl_spike',
    params: over.params ?? { minAbsPct: 10, direction: 'both' },
    createdAt: over.createdAt ?? 1_700_000_000_000,
    cooldownMs: over.cooldownMs,
    lastFiredAt: over.lastFiredAt,
    webhookUrl: over.webhookUrl,
    notifyBrowser: over.notifyBrowser ?? false,
  };
}

function spikeEvent(over: Partial<OnchainEvalEvent> = {}): OnchainEvalEvent {
  return {
    time: over.time ?? 1_700_000_000,
    type: over.type ?? EVENT_TYPE_TVL_SPIKE,
    title: over.title ?? 'Aave TVL +20%',
    severity: over.severity ?? 'warn',
    price: over.price ?? 1_200_000_000,
    payload: over.payload ?? {
      pctChange: 20,
      absPct: 20,
      prevValue: 1_000_000_000,
      value: 1_200_000_000,
    },
  };
}

function dropEvent(over: Partial<OnchainEvalEvent> = {}): OnchainEvalEvent {
  return spikeEvent({
    type: EVENT_TYPE_TVL_DROP,
    title: 'Aave TVL -15%',
    price: 850_000_000,
    payload: {
      pctChange: -15,
      absPct: 15,
      prevValue: 1_000_000_000,
      value: 850_000_000,
    },
    ...over,
  });
}

beforeEach(() => {
  installMemoryLocalStorage();
  _resetAlertsForTests();
});

describe('isOnchainTvlEventType / eventAbsPct / direction', () => {
  it('recognizes tvl_spike and tvl_drop', () => {
    expect(isOnchainTvlEventType('tvl_spike')).toBe(true);
    expect(isOnchainTvlEventType('TVL_DROP')).toBe(true);
    expect(isOnchainTvlEventType('unlock')).toBe(false);
  });

  it('reads absPct / pctChange from payload', () => {
    expect(eventAbsPct(spikeEvent())).toBe(20);
    expect(eventAbsPct({ time: 1, type: 'x', payload: { pctChange: -12.5 } })).toBe(
      12.5,
    );
    expect(eventAbsPct({ time: 1, type: 'x' })).toBeNull();
  });

  it('direction up/down/both', () => {
    const up = spikeEvent();
    const down = dropEvent();
    expect(eventMatchesDirection(up, 'up')).toBe(true);
    expect(eventMatchesDirection(up, 'down')).toBe(false);
    expect(eventMatchesDirection(down, 'down')).toBe(true);
    expect(eventMatchesDirection(down, 'up')).toBe(false);
    expect(eventMatchesDirection(up, 'both')).toBe(true);
    expect(eventMatchesDirection(down, undefined)).toBe(true);
  });
});

describe('eventMatchesProtocol', () => {
  it('matches any when protocolId unset', () => {
    const a = baseOnchainAlert({ params: { minAbsPct: 10 } });
    expect(eventMatchesProtocol(a, spikeEvent(), { protocolId: 'aave' })).toBe(true);
    expect(eventMatchesProtocol(a, spikeEvent(), {})).toBe(true);
  });

  it('requires ctx or payload protocolId when set', () => {
    const a = baseOnchainAlert({
      params: { protocolId: 'aave', minAbsPct: 10 },
    });
    expect(eventMatchesProtocol(a, spikeEvent(), { protocolId: 'aave' })).toBe(true);
    expect(eventMatchesProtocol(a, spikeEvent(), { protocolId: 'AAVE' })).toBe(true);
    expect(eventMatchesProtocol(a, spikeEvent(), { protocolId: 'uniswap' })).toBe(
      false,
    );
    expect(eventMatchesProtocol(a, spikeEvent(), {})).toBe(false);
    expect(
      eventMatchesProtocol(
        a,
        spikeEvent({ payload: { absPct: 20, protocolId: 'aave' } }),
        {},
      ),
    ).toBe(true);
  });
});

describe('eventMatchesOnchainAlert', () => {
  it('matches tvl_spike above minAbsPct', () => {
    const a = baseOnchainAlert({
      params: { protocolId: 'aave', minAbsPct: 10, direction: 'both' },
    });
    expect(
      eventMatchesOnchainAlert(a, spikeEvent(), { protocolId: 'aave' }),
    ).toBe(true);
  });

  it('rejects below minAbsPct', () => {
    const a = baseOnchainAlert({
      params: { minAbsPct: 25, direction: 'both' },
    });
    expect(eventMatchesOnchainAlert(a, spikeEvent())).toBe(false); // 20 < 25
  });

  it('respects direction filter', () => {
    const a = baseOnchainAlert({
      params: { minAbsPct: 10, direction: 'down' },
    });
    expect(eventMatchesOnchainAlert(a, spikeEvent())).toBe(false);
    expect(eventMatchesOnchainAlert(a, dropEvent())).toBe(true);
  });

  it('ignores non-TVL types for onchain_tvl_spike', () => {
    const a = baseOnchainAlert();
    expect(
      eventMatchesOnchainAlert(a, { time: 1, type: 'token_unlock', payload: { absPct: 50 } }),
    ).toBe(false);
  });

  it('onchain_event matches optional eventType', () => {
    const a = baseOnchainAlert({
      kind: 'onchain_event',
      params: { eventType: 'token_unlock' },
    });
    expect(
      eventMatchesOnchainAlert(a, { time: 1, type: 'token_unlock' }),
    ).toBe(true);
    expect(eventMatchesOnchainAlert(a, spikeEvent())).toBe(false);
  });

  it('defaults minAbsPct to 10', () => {
    expect(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT).toBe(10);
    const a = baseOnchainAlert({ params: { direction: 'both' } });
    const small = spikeEvent({
      payload: { pctChange: 5, absPct: 5 },
    });
    expect(eventMatchesOnchainAlert(a, small)).toBe(false);
    expect(eventMatchesOnchainAlert(a, spikeEvent())).toBe(true);
  });

  it('disabled alerts never match', () => {
    const a = baseOnchainAlert({ enabled: false });
    expect(eventMatchesOnchainAlert(a, spikeEvent())).toBe(false);
  });
});

describe('evaluateOnchainEventAlertsPure', () => {
  it('fires once on most recent matching event', () => {
    const a = baseOnchainAlert({
      params: { protocolId: 'aave', minAbsPct: 10, direction: 'both' },
    });
    const events = [
      spikeEvent({ time: 100, payload: { absPct: 12, pctChange: 12 } }),
      dropEvent({ time: 200, payload: { absPct: 18, pctChange: -18 } }),
      spikeEvent({ time: 300, payload: { absPct: 22, pctChange: 22 } }),
    ];
    const fired = evaluateOnchainEventAlertsPure([a], events, {
      protocolId: 'aave',
      now,
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]!.event.time).toBe(300);
    expect(fired[0]!.alert.lastFiredAt).toBe(now);
    expect(fired[0]!.alert.params.lastEventTime).toBe(300);
  });

  it('respects lastEventTime watermark (no re-fire on reload)', () => {
    const a = baseOnchainAlert({
      params: {
        protocolId: 'aave',
        minAbsPct: 10,
        lastEventTime: 300,
      },
    });
    const events = [spikeEvent({ time: 300 }), spikeEvent({ time: 200 })];
    expect(
      evaluateOnchainEventAlertsPure([a], events, {
        protocolId: 'aave',
        now,
      }),
    ).toHaveLength(0);

    const newer = evaluateOnchainEventAlertsPure(
      [a],
      [spikeEvent({ time: 400, payload: { absPct: 30, pctChange: 30 } })],
      { protocolId: 'aave', now },
    );
    expect(newer).toHaveLength(1);
    expect(newer[0]!.event.time).toBe(400);
  });

  it('respects cooldown', () => {
    const a = baseOnchainAlert({
      cooldownMs: 60_000,
      lastFiredAt: now - 10_000,
      params: { minAbsPct: 10 },
    });
    expect(
      evaluateOnchainEventAlertsPure([a], [spikeEvent()], { now }),
    ).toHaveLength(0);
  });

  it('skips price-kind alerts', () => {
    const price: Alert = {
      id: 'p1',
      name: 'price',
      enabled: true,
      symbol: 'BTC',
      kind: 'price_cross',
      params: { price: 100 },
      createdAt: 1,
    };
    expect(
      evaluateOnchainEventAlertsPure([price], [spikeEvent()], { now }),
    ).toHaveLength(0);
  });
});

describe('format labels', () => {
  it('labels onchain kinds', () => {
    expect(formatAlertKind('onchain_tvl_spike')).toBe('TVL spike');
    expect(formatAlertKind('onchain_event')).toBe('on-chain event');
  });

  it('formats condition with minAbsPct and protocol', () => {
    const s = formatAlertCondition({
      kind: 'onchain_tvl_spike',
      params: { minAbsPct: 15, direction: 'up', protocolId: 'aave' },
    });
    expect(s).toContain('TVL spike');
    expect(s).toContain('15');
    expect(s).toContain('aave');
  });
});

describe('toOnchainEvalEvents', () => {
  it('filters invalid points', () => {
    const raw: EventPoint[] = [
      { time: 1, type: 'tvl_spike', payload: { absPct: 10 } },
      { time: NaN, type: 'tvl_spike' } as EventPoint,
      { time: 2, type: '' },
    ];
    const out = toOnchainEvalEvents(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.time).toBe(1);
  });
});

describe('evaluateOnchainEventAlerts (bridge + storage + deliver)', () => {
  it('persists lastFiredAt and lastEventTime, delivers webhook', async () => {
    const posts: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    createAlert({
      id: 'bridge1',
      name: 'Aave TVL',
      symbol: 'aave',
      kind: 'onchain_tvl_spike',
      params: { protocolId: 'aave', minAbsPct: 10, direction: 'up' },
      webhookUrl: 'https://example.test/hook',
      notifyBrowser: false,
    });

    const events: EventPoint[] = [
      {
        time: 500,
        type: EVENT_TYPE_TVL_SPIKE,
        price: 99,
        payload: { absPct: 20, pctChange: 20 },
      },
    ];

    const fired = await evaluateOnchainEventAlerts(events, {
      protocolId: 'aave',
      now,
      fetchImpl,
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]!.lastFiredAt).toBe(now);
    expect(fired[0]!.params.lastEventTime).toBe(500);

    const stored = listAlerts().find((a) => a.id === 'bridge1');
    expect(stored?.lastFiredAt).toBe(now);
    expect(stored?.params.lastEventTime).toBe(500);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://example.test/hook');
    const payload = JSON.parse(posts[0]!.body) as { kind: string; price: number };
    expect(payload.kind).toBe('onchain_tvl_spike');
    expect(payload.price).toBe(99);

    // Second pass with same events: watermark blocks re-fire
    const again = await evaluateOnchainEventAlerts(events, {
      protocolId: 'aave',
      now: now + 1,
      deliver: false,
    });
    expect(again).toHaveLength(0);
  });

  it('returns empty when no matching alerts', async () => {
    createAlert({
      name: 'price only',
      symbol: 'BTC',
      kind: 'price_above',
      params: { price: 1 },
    });
    const fired = await evaluateOnchainEventAlerts(
      [{ time: 1, type: EVENT_TYPE_TVL_SPIKE, payload: { absPct: 50 } }],
      { deliver: false, now },
    );
    expect(fired).toHaveLength(0);
  });
});

describe('createOnchainTvlSpikeAlert', () => {
  it('persists onchain_tvl_spike with defaults', () => {
    const a = createOnchainTvlSpikeAlert({ protocolId: 'aave' });
    expect(a.kind).toBe('onchain_tvl_spike');
    expect(a.symbol).toBe('aave');
    expect(a.params.protocolId).toBe('aave');
    expect(a.params.minAbsPct).toBe(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT);
    expect(a.params.direction).toBe('both');
    expect(a.enabled).toBe(true);
    expect(listAlerts().some((x) => x.id === a.id)).toBe(true);
  });

  it('accepts minAbsPct, direction, webhook, cooldown', () => {
    const a = createOnchainTvlSpikeAlert({
      protocolId: 'uniswap',
      minAbsPct: 25,
      direction: 'down',
      webhookUrl: 'https://example.test/h',
      cooldownMs: 60_000,
      name: 'Uni drop',
    });
    expect(a.name).toBe('Uni drop');
    expect(a.params.minAbsPct).toBe(25);
    expect(a.params.direction).toBe('down');
    expect(a.webhookUrl).toBe('https://example.test/h');
    expect(a.cooldownMs).toBe(60_000);
  });

  it('requires protocolId', () => {
    expect(() => createOnchainTvlSpikeAlert({ protocolId: '  ' })).toThrow(/protocolId/);
  });
});
