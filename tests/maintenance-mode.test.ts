/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Maintenance-mode build flag (`src/maintenance.ts`) — the gate that makes
 * `index.tsx` mount only `ui/MaintenancePage` instead of the app.
 *
 * Bun maps `import.meta.env` onto `process.env`, so the flag is exercised by
 * mutating `process.env.VITE_MAINTENANCE_MODE` around each assertion and
 * restoring the previous value afterwards (Bun auto-loads the repo `.env`,
 * which may set it — the test must not depend on or leak that state).
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { isMaintenanceMode } from '../src/maintenance';

const KEY = 'VITE_MAINTENANCE_MODE';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe('isMaintenanceMode', () => {
  it('is off when the flag is absent', () => {
    delete process.env[KEY];
    expect(isMaintenanceMode()).toBe(false);
  });

  it('accepts the documented truthy values', () => {
    for (const value of ['1', 'true', 'yes', ' TRUE ', 'Yes']) {
      process.env[KEY] = value;
      expect(isMaintenanceMode()).toBe(true);
    }
  });

  it('rejects everything else (including the e2e override)', () => {
    for (const value of ['0', 'false', 'no', 'off', '', 'nope']) {
      process.env[KEY] = value;
      expect(isMaintenanceMode()).toBe(false);
    }
  });
});
