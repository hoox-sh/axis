/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * AXIS e2e — Chromium smoke by default.
 * webServer starts Vite on :4173 (preview) or :3000 (dev) via package scripts.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Loaded CI runners starve `vite preview` into dropped asset requests
  // (boot fallback → cascading timeouts); retry absorbs the infra flake.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.AXIS_E2E_BASE || 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.AXIS_E2E_CMD || 'bun run build && bun run preview -- --host 127.0.0.1 --port 4173',
    url: process.env.AXIS_E2E_BASE || 'http://127.0.0.1:4173',
    // Always test the real app: a local `.env` may have the maintenance gate
    // on (VITE_MAINTENANCE_MODE), and process env outranks `.env` files in
    // Vite — so force the flag off for the e2e build + preview.
    env: { VITE_MAINTENANCE_MODE: '0' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
