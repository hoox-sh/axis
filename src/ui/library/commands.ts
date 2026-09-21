// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Command-palette intents for the docked Script Library.
 *
 * The panel is unmounted while closed, so a window event fired in the same
 * turn as "open the panel" is lost. The intent is buffered until the panel
 * takes it on mount, and also dispatched for an already-open panel.
 *
 * @module ui/library/commands
 */

export type LibraryCommand = 'find' | 'recent';

let pending: LibraryCommand | null = null;

export function noteLibraryCommand(cmd: LibraryCommand): void {
  pending = cmd;
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('axis-library-command', { detail: cmd }));
    window.dispatchEvent(
      new CustomEvent(cmd === 'find' ? 'axis-library-find' : 'axis-library-recent'),
    );
  } catch {
    /* ignore */
  }
}

/** Read and clear the buffered command. Safe to call when nothing is pending. */
export function takeLibraryCommand(): LibraryCommand | null {
  const cmd = pending;
  pending = null;
  return cmd;
}
