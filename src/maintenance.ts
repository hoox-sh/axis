/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Maintenance-mode flag — build/deploy gate for the maintenance page.
 *
 * Set `VITE_MAINTENANCE_MODE=1` (also accepts `true` / `yes`) in `.env` or
 * the build environment, and `index.tsx` mounts only
 * {@link src/ui/MaintenancePage} instead of the chart workspace or editor
 * popout — users see the maintenance screen, never a half-working app.
 * Vite inlines the value at build time, so flipping the flag always needs a
 * rebuild; there is no runtime toggle. Existing process env vars outrank
 * `.env` files, which is how e2e forces the flag off (see
 * `playwright.config.ts`).
 *
 * Lives in a tiny module (no JSX, no logo import) so the boot path in
 * `index.tsx` can import the check statically while the maintenance page
 * itself stays a lazy chunk.
 *
 * @module maintenance
 */

/** True when the build was flagged into maintenance mode (see module doc). */
export function isMaintenanceMode(): boolean {
  try {
    const raw = String(import.meta.env?.VITE_MAINTENANCE_MODE ?? '')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  } catch {
    /* non-Vite runtimes without env → no flag */
    return false;
  }
}
