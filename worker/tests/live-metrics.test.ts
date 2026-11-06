/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { emitLiveMetric, frameBytes, RelayStats } from '../src/live-metrics';

describe('frameBytes', () => {
  it('measures strings, ArrayBuffers, and views', () => {
    expect(frameBytes('abcd')).toBe(4);
    expect(frameBytes(new Uint8Array([1, 2, 3]).buffer)).toBe(3);
    expect(frameBytes(new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4))).toBe(3);
  });

  it('returns 0 for unmeasurable payloads', () => {
    expect(frameBytes(null)).toBe(0);
    expect(frameBytes(undefined)).toBe(0);
    expect(frameBytes(42)).toBe(0);
  });
});

describe('RelayStats', () => {
  afterEach(() => {
    // console.warn is restored per-test inside the spy; nothing to reset here.
  });

  it('counts frames, bytes, and the binary/text split', () => {
    const s = new RelayStats();
    s.noteFrame('up', '{"type":"auth"}');
    s.noteFrame('down', new Uint8Array([0x41, 0x58, 0x42, 0x31]));
    expect(s.toUpstream).toBe(1);
    expect(s.toClient).toBe(1);
    expect(s.bytesUp).toBe(15);
    expect(s.bytesDown).toBe(4);
    expect(s.textFrames).toBe(1);
    expect(s.binaryFrames).toBe(1);
  });

  it('tracks max pending depth and dropped frames', () => {
    const s = new RelayStats();
    s.notePendingToUpstream(3);
    s.notePendingToUpstream(1);
    expect(s.maxPendingToUpstream).toBe(3);
    s.noteLanePending(5);
    s.noteLanePending(2);
    expect(s.maxLanePending).toBe(5);
    s.droppedToUpstream += 1;
    expect(s.droppedToUpstream).toBe(1);
  });

  it('finalize emits exactly one summary with the expected shape', () => {
    const warned: string[] = [];
    const original = console.warn;
    console.warn = ((line?: unknown) => warned.push(String(line))) as typeof console.warn;
    try {
      const s = new RelayStats();
      s.upstreamConnectMs = 12;
      s.upstreamHost = 'engine.internal:5002';
      s.noteFrame('up', 'x');
      s.finalize('upstream');
      s.finalize('client'); // idempotent — no second line
      expect(warned).toHaveLength(1);
      const parsed = JSON.parse(warned[0] as string) as Record<string, unknown>;
      expect(parsed.type).toBe('live_relay_close');
      expect(parsed.closed_by).toBe('upstream');
      expect(parsed.upstream_connect_ms).toBe(12);
      expect(parsed.to_upstream).toBe(1);
      expect(parsed.duration_ms).toBeTypeOf('number');
    } finally {
      console.warn = original;
    }
  });

  it('emitLiveMetric never throws', () => {
    expect(() => emitLiveMetric({ type: 'live_relay_probe' })).not.toThrow();
  });
});
