/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Loader fixture: valid engine plugin (default export).
 * `run` echoes bar closes as plots — used by plugin-install / loader tests.
 */
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
