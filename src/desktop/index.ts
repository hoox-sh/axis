/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXIS desktop (Tauri) shell helpers.
 */

export { isTauriShell } from './is-tauri';
export { pickPineScriptsFromDisk, type OpenedPineScript } from './open-scripts';
export {
  installDesktopMenu,
  AXIS_MENU_EVENT,
  type AxisMenuAction,
  type DesktopMenuHandlers,
} from './menu';
export { showAboutDialog, installDesktopShell } from './shell';
