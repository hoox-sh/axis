/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { isStreamEngineDisabled, isStreamEngineEnabled, setStreamEngineEnabled } from '../../src/engine/feature-flag';
import { routeEngineRun } from '../../src/engine/router';

describe('redesign2 feature flag + router (F-09, F-19 flip)', () => {
  test('flag toggles and opt-out wins', () => {
    setStreamEngineEnabled(false);
    expect(isStreamEngineEnabled()).toBe(false);
    expect(isStreamEngineDisabled()).toBe(true);
    setStreamEngineEnabled(true);
    expect(isStreamEngineEnabled()).toBe(true);
    expect(isStreamEngineDisabled()).toBe(false);
    setStreamEngineEnabled(false);
  });

  test('router defaults to stream on live_stream, calculator otherwise', () => {
    setStreamEngineEnabled(true);
    try {
      expect(routeEngineRun({ liveStream: true })).toEqual({ useStream: true, reason: 'stream' });
      expect(routeEngineRun({ liveStream: false })).toEqual({ useStream: false, reason: 'calculator' });
      expect(routeEngineRun(null)).toEqual({ useStream: false, reason: 'calculator' });
    } finally {
      setStreamEngineEnabled(true);
    }
  });

  test('opt-out forces legacy even with live_stream', () => {
    setStreamEngineEnabled(false);
    try {
      expect(routeEngineRun({ liveStream: true })).toEqual({ useStream: false, reason: 'flag-off' });
    } finally {
      setStreamEngineEnabled(true);
    }
  });
});
