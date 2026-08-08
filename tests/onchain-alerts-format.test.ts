/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure alert formatters for on-chain kinds (`src/alerts/format.ts`).
 */

import { describe, expect, it } from 'bun:test';
import {
  formatAlertCondition,
  formatAlertKind,
} from '../src/alerts/format';

describe('formatAlertKind (on-chain)', () => {
  it('labels onchain_tvl_spike and onchain_event', () => {
    expect(formatAlertKind('onchain_tvl_spike')).toBe('TVL spike');
    expect(formatAlertKind('onchain_event')).toBe('on-chain event');
  });
});

describe('formatAlertCondition (on-chain)', () => {
  it('formats tvl spike with direction both and default minAbsPct', () => {
    const s = formatAlertCondition({
      kind: 'onchain_tvl_spike',
      params: {},
    });
    expect(s).toContain('TVL spike');
    expect(s).toContain('±');
    expect(s).toContain('10');
    expect(s).toContain('%');
  });

  it('formats up / down direction labels', () => {
    const up = formatAlertCondition({
      kind: 'onchain_tvl_spike',
      params: { minAbsPct: 15, direction: 'up' },
    });
    expect(up).toContain('TVL spike');
    expect(up).toContain('≥+');
    expect(up).toContain('15');

    const down = formatAlertCondition({
      kind: 'onchain_tvl_spike',
      params: { minAbsPct: 12, direction: 'down' },
    });
    expect(down).toContain('TVL spike');
    expect(down).toContain('≤−');
    expect(down).toContain('12');
  });

  it('appends protocolId when set', () => {
    const s = formatAlertCondition({
      kind: 'onchain_tvl_spike',
      params: { minAbsPct: 20, direction: 'both', protocolId: 'aave' },
    });
    expect(s).toContain('TVL spike');
    expect(s).toContain('20');
    expect(s).toContain('aave');
  });

  it('appends eventType for onchain_event when no protocol', () => {
    const s = formatAlertCondition({
      kind: 'onchain_event',
      params: { minAbsPct: 8, direction: 'up', eventType: 'tvl_spike' },
    });
    expect(s).toContain('on-chain event');
    expect(s).toContain('≥+');
    expect(s).toContain('8');
    expect(s).toContain('tvl_spike');
  });

  it('prefers protocolId over eventType when both set', () => {
    const s = formatAlertCondition({
      kind: 'onchain_event',
      params: {
        minAbsPct: 5,
        direction: 'down',
        protocolId: 'lido',
        eventType: 'tvl_drop',
      },
    });
    expect(s).toContain('on-chain event');
    expect(s).toContain('lido');
    expect(s).toContain('≤−');
    expect(s).not.toContain('tvl_drop');
  });

  it('accepts string minAbsPct', () => {
    const s = formatAlertCondition({
      kind: 'onchain_tvl_spike',
      params: { minAbsPct: '7.5', direction: 'both' },
    });
    expect(s).toMatch(/TVL spike/);
    expect(s).toMatch(/7\.5/);
    expect(s).toMatch(/%/);
  });
});
