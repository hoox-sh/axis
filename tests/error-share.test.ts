/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Error diagnostic transfer: payload shape, opt-in gating, endpoint host only.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  buildErrorDiagnosticPayload,
  endpointHostOnly,
  isErrorShareEnabled,
  maybeOfferErrorShare,
  dismissErrorShareOffer,
  _resetErrorShareThrottleForTests,
  AXIS_DIAGNOSTIC_VERSION,
} from '../src/ui/error-share';
import { store, setStore } from '../src/store';

describe('endpointHostOnly', () => {
  it('keeps host:port and drops path/query', () => {
    expect(endpointHostOnly('http://162.254.38.194:5002/run?x=1')).toBe(
      '162.254.38.194:5002',
    );
    expect(endpointHostOnly('https://user:pass@example.com/v1')).toBe('example.com');
  });

  it('handles bare host and empty', () => {
    expect(endpointHostOnly('127.0.0.1:5002')).toBe('127.0.0.1:5002');
    expect(endpointHostOnly('')).toBeUndefined();
    expect(endpointHostOnly(null)).toBeUndefined();
  });
});

describe('buildErrorDiagnosticPayload', () => {
  beforeEach(() => {
    setStore('symbol', 'BTCUSDT');
    setStore('interval', '1h');
    setStore('engine', 'server');
    setStore('endpoint', 'http://secret:token@api.example.com:5002/v1');
    setStore('bars', [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }] as never);
    setStore('scripts', [
      { id: 'x', name: 'RSI', code: 'secret pine', paneId: 'price', visible: true, plots: {} },
    ] as never);
  });

  it('builds redacted payload without bars or pine source', () => {
    const p = buildErrorDiagnosticPayload(new Error('boom'), {
      source: 'run',
      context: 'Chart apply failed',
    });
    expect(p.kind).toBe('axis-error-diagnostic');
    expect(p.version).toBe(AXIS_DIAGNOSTIC_VERSION);
    expect(p.error.message).toMatch(/boom/);
    expect(p.error.source).toBe('run');
    expect(p.error.context).toBe('Chart apply failed');
    expect(p.session.symbol).toBe('BTCUSDT');
    expect(p.session.endpointHost).toBe('api.example.com:5002');
    expect(p.session.barCount).toBe(1);
    expect(p.session.scriptCount).toBe(1);
    const json = JSON.stringify(p);
    expect(json).not.toContain('secret pine');
    expect(json).not.toContain('token');
    expect(json).not.toMatch(/"open"\s*:\s*1/);
  });
});

describe('maybeOfferErrorShare', () => {
  beforeEach(() => {
    _resetErrorShareThrottleForTests();
    setStore('telemetry', 'shareOnError', false);
  });

  it('is disabled by default', () => {
    expect(isErrorShareEnabled()).toBe(false);
    expect(maybeOfferErrorShare(new Error('x'), { source: 'test' })).toBe(false);
    expect(store.errorShareOffer).toBeNull();
  });

  it('queues offer when shareOnError is true', () => {
    setStore('telemetry', 'shareOnError', true);
    expect(isErrorShareEnabled()).toBe(true);
    expect(maybeOfferErrorShare(new Error('series blew up'), { source: 'chart' })).toBe(
      true,
    );
    expect(store.errorShareOffer).not.toBeNull();
    expect(store.errorShareOffer?.summary).toMatch(/series blew up/);
    expect(store.errorShareOffer?.payload.kind).toBe('axis-error-diagnostic');
    dismissErrorShareOffer();
    expect(store.errorShareOffer).toBeNull();
  });

  it('throttles identical offers', () => {
    setStore('telemetry', 'shareOnError', true);
    expect(maybeOfferErrorShare(new Error('same'), { source: 'a' })).toBe(true);
    dismissErrorShareOffer();
    expect(maybeOfferErrorShare(new Error('same'), { source: 'a' })).toBe(false);
  });
});
