/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ENGINE_CAPABILITIES,
  capabilitiesFromHealth,
} from '../../src/engines/catalog';

describe('live_stream capability gating (F-08)', () => {
  test('live_stream is strictly opt-in', () => {
    expect(
      capabilitiesFromHealth({ features: { live_stream: true } }).liveStream,
    ).toBe(true);
    expect(
      capabilitiesFromHealth({
        features: { live_modes: ['every-tick', 'bar-close'], data_session: true },
      }).liveStream,
    ).toBe(false);
    expect(capabilitiesFromHealth({ features: {} }).liveStream).toBe(false);
    expect(capabilitiesFromHealth(null).liveStream).toBe(false);
  });

  test('safe defaults stay calculator (fail-open)', () => {
    expect(DEFAULT_ENGINE_CAPABILITIES.liveStream).toBe(false);
  });
});
