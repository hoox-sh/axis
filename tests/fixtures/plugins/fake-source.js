/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Loader fixture: valid historical source (default export).
 * Returns a single synthetic bar for install/registry tests.
 */
export default {
  id: 'test-fake-source',
  name: 'Fake Source',
  kind: 'source',
  description: 'Fixture for loader tests',
  configSchema: {},
  async fetchHistorical() {
    return [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  },
};
