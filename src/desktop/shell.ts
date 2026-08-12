/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Bootstrap native desktop integrations for the AXIS Tauri shell.
 */

import { message } from '@tauri-apps/plugin-dialog';
import {
  importAndOpenPyneSources,
  type ImportEditorHost,
} from '../storage/import-pyne-open';
import { appendLog, setStatus } from '../store';
import { isTauriShell } from './is-tauri';
import { installDesktopMenu } from './menu';
import { pickPineScriptsFromDisk } from './open-scripts';

export interface DesktopShellOptions {
  editorRef: ImportEditorHost;
}

/** About AXIS — prefer in-app modal (ethos); fall back to native message. */
export async function showAboutDialog(): Promise<void> {
  try {
    const { openAboutModal } = await import('../ui/AboutModal');
    openAboutModal();
    return;
  } catch (err) {
    console.warn('[axis-desktop] about modal import failed', err);
  }
  if (!isTauriShell()) return;
  try {
    await message(
      'AXIS — open charting for Pine Script™\n\n' +
        'Part of HOOX · hoox.sh/axis\n' +
        'Desktop shell: Tauri 2\n' +
        'License: AGPL-3.0-only',
      { title: 'About AXIS', kind: 'info' },
    );
  } catch (err) {
    console.warn('[axis-desktop] about dialog failed', err);
  }
}

/** File → Open Script… — native picker → library + editor tabs. */
export async function openScriptsFromMenu(
  editorRef: ImportEditorHost,
): Promise<void> {
  if (!isTauriShell()) return;
  try {
    const sources = await pickPineScriptsFromDisk();
    if (sources == null) return; // cancelled
    if (!sources.length) {
      setStatus('error', 'No Pine scripts selected (.pyne / .pine / …)');
      appendLog('warn', 'Open Script: no matching files', 'library');
      return;
    }
    await importAndOpenPyneSources(sources, {
      editorRef,
      emptyContext: 'open',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus('error', `Open script failed: ${msg}`);
    appendLog('error', `Open script failed: ${msg}`, 'library');
  }
}

/**
 * Install menu listeners and wire File → Open / Help → About.
 * @returns cleanup function
 */
export async function installDesktopShell(
  opts: DesktopShellOptions,
): Promise<() => void> {
  if (!isTauriShell()) return () => {};

  return installDesktopMenu({
    onOpenScript: () => openScriptsFromMenu(opts.editorRef),
    onAbout: () => showAboutDialog(),
  });
}
