/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Listen for native app-menu events emitted by the Tauri host.
 *
 * Menu construction lives in Rust (`src-tauri/src/lib.rs`) so accelerators and
 * platform Quit/About conventions work without a JS rebuild of the menu tree.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauriShell } from './is-tauri';

/** Event name must match the Rust `app.emit` target. */
export const AXIS_MENU_EVENT = 'axis-menu';

export type AxisMenuAction = 'open_script' | 'about';

export interface DesktopMenuHandlers {
  onOpenScript: () => void | Promise<void>;
  onAbout: () => void | Promise<void>;
}

/**
 * Subscribe to host menu actions. No-op outside Tauri.
 * @returns unsubscribe function
 */
export async function installDesktopMenu(
  handlers: DesktopMenuHandlers,
): Promise<() => void> {
  if (!isTauriShell()) return () => {};

  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<string>(AXIS_MENU_EVENT, (event) => {
      const action = String(event.payload || '') as AxisMenuAction | string;
      if (action === 'open_script') {
        void handlers.onOpenScript();
      } else if (action === 'about') {
        void handlers.onAbout();
      }
    });
  } catch (err) {
    console.warn('[axis-desktop] menu listen failed', err);
    return () => {};
  }

  return () => {
    try {
      unlisten?.();
    } catch {
      /* ignore */
    }
  };
}
