/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Test fixture engine plugin (ES module). */
export default {
  id: 'test-fake-engine',
  name: 'Fake Engine',
  kind: 'engine',
  description: 'Fixture for loader tests',
  configSchema: {},
  async isReady() {
    return true;
  },
  async run({ bars }) {
    return {
      status: 'success',
      plots: bars.map((b) => b.close),
      series: {},
      events: [],
      meta: { ms: 1 },
    };
  },
};
