import { describe, expect, test } from 'bun:test';
import {
  DATA_PLANE_DEFAULT_LEVERS,
  DEFAULT_DATA_PLANE_POLICY,
  profileForCapabilities,
} from '../../src/engine/policy';

describe('engine data-plane policy defaults', () => {
  test('documents backend truth and websocket preference', () => {
    expect(DEFAULT_DATA_PLANE_POLICY.backendTruthDefault).toBe(true);
    expect(DEFAULT_DATA_PLANE_POLICY.webSocketPreferred).toBe(true);
    expect(DEFAULT_DATA_PLANE_POLICY.clientVenueStreamMode).toBe('verification');
    expect(DEFAULT_DATA_PLANE_POLICY.serverOwnedPersistence).toBe('metadata-only');
    expect(DEFAULT_DATA_PLANE_POLICY.fullRunOnce).toBe(true);
    expect(DEFAULT_DATA_PLANE_POLICY.liveDeltaOnly).toBe(true);
  });

  test('lists every behavior-changing default lever', () => {
    expect(DATA_PLANE_DEFAULT_LEVERS).toContain('rollingWindowBars');
    expect(DATA_PLANE_DEFAULT_LEVERS).toContain('historyBars');
    expect(DATA_PLANE_DEFAULT_LEVERS).toContain('datasetPersistence');
    expect(DATA_PLANE_DEFAULT_LEVERS.length).toBeGreaterThan(5);
  });
});

describe('engine profile gating (F-08)', () => {
  test('stream only on explicit liveStream, calculator otherwise', () => {
    expect(profileForCapabilities({ liveStream: true })).toBe('stream');
    expect(profileForCapabilities({ liveStream: false })).toBe('calculator');
    expect(profileForCapabilities({})).toBe('calculator');
    expect(profileForCapabilities(null)).toBe('calculator');
    expect(profileForCapabilities(undefined)).toBe('calculator');
  });
});