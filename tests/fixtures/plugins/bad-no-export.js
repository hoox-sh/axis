/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Negative loader fixture: module loads but is not a plugin.
 * Used to assert `loadPluginFromUrl` / install reject missing kind/export.
 */
// Intentionally no default plugin export
export const notAPlugin = 1;
