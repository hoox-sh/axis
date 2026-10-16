/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Calculator-profile parity (F-26): engines without `live_stream` resolve to
 * the bars-in path, with or without `/health`.
 */

import { describe, expect, test } from 'bun:test';
import { profileForCapabilities } from '../../src/engine/policy';
import {
  DEFAULT_ENGINE_CAPABILITIES,
  capabilitiesFromHealth,
  pyodideEngine,
  pyneWorkerEngine,
} from '../../src/engines/catalog';

describe('redesign2 calculator profile (F-26)', () => {
  test('pyodide resolves calculator without network', async () => {
    const caps = await pyodideEngine.getCapabilities!();
    expect(caps.liveModes).toEqual(['bar-close']);
    expect(profileForCapabilities(caps)).toBe('calculator');
  });

  test('pyne-worker resolves calculator without network', async () => {
    const caps = await pyneWorkerEngine.getCapabilities!();
    expect(caps.liveModes).toEqual(['bar-close']);
    expect(profileForCapabilities(caps)).toBe('calculator');
  });

  test('unreachable backend fails open to calculator', () => {
    expect(profileForCapabilities(DEFAULT_ENGINE_CAPABILITIES)).toBe('calculator');
    expect(profileForCapabilities(capabilitiesFromHealth(null))).toBe('calculator');
    expect(profileForCapabilities(capabilitiesFromHealth({ status: 'ok' }))).toBe('calculator');
  });

  test('old Pro backend (data_session, no live_stream) stays calculator', () => {
    const caps = capabilitiesFromHealth({
      features: { live_modes: ['every-tick', 'bar-close'], data_session: true },
    });
    expect(profileForCapabilities(caps)).toBe('calculator');
  });
});
