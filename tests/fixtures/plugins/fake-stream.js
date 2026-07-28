/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Test fixture stream plugin (ES module). */
export default {
  id: 'test-fake-stream',
  name: 'Fake Stream',
  kind: 'stream',
  description: 'Fixture for loader tests',
  configSchema: {},
  start({ onStatus }) {
    onStatus?.({ state: 'open' });
    return () => onStatus?.({ state: 'closed' });
  },
};
