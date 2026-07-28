/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Test fixture source plugin (ES module). */
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
