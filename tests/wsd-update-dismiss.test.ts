/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** D10 — "Later" survives poll/focus/online re-checks within the session. */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  markUpdateAvailable,
  dismissUpdate,
  checkForUpdates,
  getUpdateState,
  getDismissedVersions,
  _resetUpdateManagerForTests,
} from '../src/update/update-manager';

const RUNNING = '9.9.8-test';
const NEXT = '9.9.9-test';
const NEWER = '9.9.10-test';

function fetchJson(version: unknown) {
  return (async () => ({
    ok: true,
    json: async () => ({ version }),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  _resetUpdateManagerForTests();
});

describe('dismissUpdate remembers the version', () => {
  it('poll re-detection of the dismissed version stays quiet', async () => {
    const hooks = { canNotify: () => false };
    expect(markUpdateAvailable(NEXT, 'version-poll', hooks, RUNNING)).not.toBeNull();
    expect(getUpdateState().status).toBe('update-available');
    dismissUpdate();
    expect(getUpdateState().status).toBe('current');
    expect(getDismissedVersions()).toContain(NEXT);
    // Same version re-detected (interval poll, focus, online) → no banner.
    expect(markUpdateAvailable(NEXT, 'version-poll', hooks, RUNNING)).toBeNull();
    expect(
      await checkForUpdates({ fetchImpl: fetchJson(NEXT), runningVersion: RUNNING, hooks }),
    ).toBeNull();
    expect(getUpdateState().status).toBe('current');
  });

  it('a *different* deployed version re-prompts after dismiss', async () => {
    const hooks = { canNotify: () => false };
    markUpdateAvailable(NEXT, 'version-poll', hooks, RUNNING);
    dismissUpdate();
    const info = await checkForUpdates({
      fetchImpl: fetchJson(NEWER),
      runningVersion: RUNNING,
      hooks,
    });
    expect(info?.latestVersion).toBe(NEWER);
    expect(getUpdateState().status).toBe('update-available');
  });
});
