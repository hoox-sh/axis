// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared run-result envelope mapper.
 *
 * The engine result arrived over the REST path, the WebSocket path and the
 * batch path, and each built the same envelope with its own copy of the body
 * — plus a byte-identical copy of the bar-time-axis extractor.
 *
 * The differences between the paths are stated per call site, not hidden
 * inside three copies — so this test pins each policy.
 */

import { describe, expect, it } from 'bun:test';
import {
  mapEnginePayload,
  normalizeOverlayFlag,
  payloadEngineTimes,
} from '../src/engines/result-mapper';

describe('normalizeOverlayFlag', () => {
  it('treats falsy engine flags as false', () => {
    expect(normalizeOverlayFlag(false)).toBe(false);
    expect(normalizeOverlayFlag(0)).toBe(false);
    expect(normalizeOverlayFlag('0')).toBe(false);
    expect(normalizeOverlayFlag('false')).toBe(false);
  });

  it('treats anything else as true', () => {
    expect(normalizeOverlayFlag(true)).toBe(true);
    expect(normalizeOverlayFlag(1)).toBe(true);
    expect(normalizeOverlayFlag('1')).toBe(true);
  });

  it('reports "not specified" for a missing flag', () => {
    expect(normalizeOverlayFlag(undefined)).toBeUndefined();
    expect(normalizeOverlayFlag(null)).toBeUndefined();
  });
});

describe('payloadEngineTimes', () => {
  it('reads a top-level axis', () => {
    expect(payloadEngineTimes({ times: [1, 2, 3] })).toEqual([1, 2, 3]);
    expect(payloadEngineTimes({ bar_times: [4] })).toEqual([4]);
    expect(payloadEngineTimes({ barTimes: [5] })).toEqual([5]);
  });

  it('reads a bars time column', () => {
    expect(
      payloadEngineTimes({
        bars: [
          [10, 1],
          [20, 2],
        ],
      }),
    ).toEqual([10, 20]);
    expect(payloadEngineTimes({ bars: [{ time: 7 }] })).toEqual([7]);
  });

  it('reports no axis when the payload carries none', () => {
    expect(payloadEngineTimes({})).toBeUndefined();
    expect(payloadEngineTimes(null)).toBeUndefined();
    expect(payloadEngineTimes([])).toBeUndefined();
  });
});

describe('mapEnginePayload', () => {
  const payload = {
    plots: [1, 2],
    series: { a: [{ time: 1, value: 2 }] },
    events: [{ time: 1 }],
    drawings: [{ id: 'd' }],
    inputs: { length: 14 },
    script_name: 'My Script',
    script_id: 's_1',
    run_id: 'r_1',
    mode: 'interpret',
    plot_meta: { p: { color: '#fff' } },
    meta: { kind: 'strategy', extra: 1 },
  };

  it('builds the shared envelope shape', () => {
    const r = mapEnginePayload(payload, { transport: 'rest', ms: 12, mode: 'interpret' });
    expect(r.status).toBe('success');
    expect(r.plots).toEqual([1, 2]);
    expect(r.series).toEqual({ a: [{ time: 1, value: 2 }] });
    expect(r.events).toEqual([{ time: 1 }]);
    expect(r.drawings).toEqual([{ id: 'd' }]);
    expect(r.inputs).toEqual({ length: 14 });
    expect(r.meta?.ms).toBe(12);
    expect(r.meta?.transport).toBe('rest');
    expect(r.meta?.script_name).toBe('My Script');
    expect(r.meta?.script_id).toBe('s_1');
    expect(r.meta?.run_id).toBe('r_1');
    expect(r.meta?.plot_meta).toEqual({ p: { color: '#fff' } });
  });

  it('stamps the transport and the resolved mode', () => {
    const rest = mapEnginePayload(payload, { transport: 'rest', ms: 1, mode: 'interpret' });
    const ws = mapEnginePayload(payload, { transport: 'ws', ms: 1, mode: 'compile' });
    expect(rest.meta?.transport).toBe('rest');
    expect(rest.meta?.mode).toBe('interpret');
    expect(ws.meta?.transport).toBe('ws');
    expect(ws.meta?.mode).toBe('compile');
  });

  it('infers script_type from the payload kind only on the REST policy', () => {
    const rest = mapEnginePayload(payload, {
      transport: 'rest',
      ms: 1,
      scriptType: 'payload+meta+kind',
    });
    expect(rest.meta?.script_type).toBe('strategy');

    const ws = mapEnginePayload(payload, { transport: 'ws', ms: 1, scriptType: 'meta' });
    expect(ws.meta?.script_type).toBeUndefined();

    const batch = mapEnginePayload(payload, { transport: 'rest', ms: 1, batch: true });
    expect(batch.meta?.script_type).toBeUndefined();
  });

  it('reads an explicit script_type from the payload', () => {
    const r = mapEnginePayload(
      { ...payload, script_type: 'indicator' },
      {
        transport: 'rest',
        ms: 1,
        scriptType: 'payload+meta+kind',
      },
    );
    expect(r.meta?.script_type).toBe('indicator');
  });

  it('carries the engine axis only when asked', () => {
    const withAxis = mapEnginePayload(
      { ...payload, times: [1, 2] },
      {
        transport: 'rest',
        ms: 1,
        engineTimes: true,
      },
    );
    expect(withAxis.meta?.engineTimes).toEqual([1, 2]);

    const without = mapEnginePayload({ ...payload, times: [1, 2] }, { transport: 'rest', ms: 1 });
    expect(without.meta?.engineTimes).toBeUndefined();
  });

  it('stamps the batch flag only on the batch policy', () => {
    expect(mapEnginePayload(payload, { transport: 'rest', ms: 1, batch: true }).meta?.batch).toBe(
      true,
    );
    expect(mapEnginePayload(payload, { transport: 'rest', ms: 1 }).meta?.batch).toBeUndefined();
  });

  it('normalizes the overlay flag except on the boolean-only policy', () => {
    expect(
      mapEnginePayload({ ...payload, overlay: '0' }, { transport: 'rest', ms: 1 }).meta?.overlay,
    ).toBe(false);
    expect(
      mapEnginePayload(
        { ...payload, overlay: '0' },
        {
          transport: 'rest',
          ms: 1,
          overlay: 'boolean-only',
        },
      ).meta?.overlay,
    ).toBeUndefined();
    expect(
      mapEnginePayload(
        { ...payload, overlay: true },
        {
          transport: 'rest',
          ms: 1,
          overlay: 'boolean-only',
        },
      ).meta?.overlay,
    ).toBe(true);
  });

  it('carries the profile, the logs and the alert conditions', () => {
    const r = mapEnginePayload(
      {
        ...payload,
        profile: { cpu: 1 },
        logs: ['a'],
        alerts: [{ id: 'x' }],
        alert_conditions: [{ id: 'y' }],
      },
      { transport: 'rest', ms: 1 },
    );
    expect(r.profile).toEqual({ cpu: 1 });
    expect(r.logs).toEqual(['a']);
    expect(r.meta?.profile).toEqual({ cpu: 1 });
    expect(r.meta?.logs).toEqual(['a']);
    expect(r.meta?.alerts).toEqual([{ id: 'x' }]);
    expect(r.meta?.alert_conditions).toEqual([{ id: 'y' }]);
  });

  it('survives a malformed payload', () => {
    const r = mapEnginePayload({ meta: 'not-an-object' }, { transport: 'rest', ms: 1 });
    expect(r.status).toBe('success');
    expect(r.plots).toEqual([]);
    expect(r.series).toEqual({});
    expect(r.meta?.script_name).toBe('plot');
    expect(r.meta?.plot_meta).toEqual({});
  });
});
