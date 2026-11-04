/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Run-cache key must change when the evaluated window changes, even when the
 * bar-plane generation and the (chunked) engine length are unchanged.
 */
import { describe, expect, it } from 'bun:test';
import { buildRunCacheKey } from '../src/indicators/run-cache';

const base = {
  engineId: 'server',
  engineEndpoint: 'http://127.0.0.1:5002',
  scriptId: 'script',
  scriptSource: '//@version=6\nindicator("x")\nplot(close)',
  inputs: {},
  config: {},
  barsGen: 7,
  barsLength: 1100,
  barsFirst: 1_700_000_000,
  barsLast: 1_700_066_000,
};

describe('buildRunCacheKey window edges', () => {
  it('changes when a live bar appends without a generation bump', () => {
    const next = buildRunCacheKey({ ...base, barsLast: base.barsLast + 60 });
    expect(next).not.toBe(buildRunCacheKey(base));
  });

  it('changes when the window slides (same length, new edges)', () => {
    const slid = buildRunCacheKey({
      ...base,
      barsFirst: base.barsFirst + 60,
      barsLast: base.barsLast + 60,
    });
    expect(slid).not.toBe(buildRunCacheKey(base));
  });

  it('is stable for an identical request', () => {
    expect(buildRunCacheKey({ ...base })).toBe(buildRunCacheKey({ ...base }));
  });

  it('still keys on script / inputs / engine', () => {
    expect(buildRunCacheKey({ ...base, scriptSource: 'other' })).not.toBe(
      buildRunCacheKey(base),
    );
    expect(buildRunCacheKey({ ...base, inputs: { length: 20 } })).not.toBe(
      buildRunCacheKey(base),
    );
  });
});
