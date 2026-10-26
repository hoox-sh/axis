/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AXIS_DEBUG?: string;
  readonly VITE_DEBUG?: string;
  readonly VITE_MAINTENANCE_MODE?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_PYNE_API?: string;
  readonly VITE_ALLOW_REMOTE_PLUGINS?: string;
  readonly VITE_PLUGIN_REMOTE_ALLOW?: string;
}
