/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Desktop: open one or more Pine / PYNE files via the native file dialog.
 *
 * Host command (`open_pine_scripts`) owns the dialog + disk read so the
 * frontend never needs a broad filesystem capability.
 */

import { invoke } from '@tauri-apps/api/core';
import type { PyneSourceInput } from '../storage/import-pyne-files';
import { isTauriShell } from './is-tauri';

/** Payload from the Rust `open_pine_scripts` command. */
export interface OpenedPineScript {
  /** Basename (e.g. `rsi.pyne`). */
  name: string;
  /** Absolute path from the dialog. */
  path: string;
  /** Full UTF-8 source. */
  content: string;
}

/**
 * Show the native multi-file picker and return sources, or `null` if cancelled.
 * Returns `[]` when the user picked only non-script files (host filters when possible).
 */
export async function pickPineScriptsFromDisk(): Promise<PyneSourceInput[] | null> {
  if (!isTauriShell()) return null;

  const rows = await invoke<OpenedPineScript[] | null>('open_pine_scripts');
  if (rows == null) return null;
  return rows.map((r) => ({
    name: r.name,
    path: r.path,
    content: r.content,
  }));
}
