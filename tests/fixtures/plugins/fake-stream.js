/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Loader fixture: valid live stream (default export).
 * start() only toggles status open/closed — no real socket.
 */
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
