// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `axis.applyBuiltin` — QuickPick offline builtins and open an untitled pinescript doc.
 */

import type { ExtensionContext } from 'vscode';
import { commands, window, workspace } from 'vscode';
import {
  type BuiltinCatalogEntry,
  loadBuiltinCatalog,
  type ReadFileUtf8,
} from './builtins';
import { PINE_LANGUAGE_ID } from './open-chart';

export const APPLY_BUILTIN_COMMAND = 'axis.applyBuiltin';

export const APPLY_BUILTIN_EMPTY_MESSAGE =
  'AXIS: No builtin scripts found in the offline catalog (media/builtins).';

export const APPLY_BUILTIN_LOAD_FAILED_PREFIX = 'AXIS: Could not load builtin catalog:';

/** QuickPick row shaped for VS Code (label/description/detail + payload). */
export interface BuiltinQuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  builtin: BuiltinCatalogEntry;
}

export type ApplyBuiltinStatus = 'applied' | 'cancelled' | 'empty' | 'error';

export interface ApplyBuiltinResult {
  status: ApplyBuiltinStatus;
  builtin?: BuiltinCatalogEntry;
  message?: string;
}

/** Injectable UI so unit tests stay free of a real VS Code window. */
export interface ApplyBuiltinUi {
  showQuickPick(
    items: BuiltinQuickPickItem[],
    options: { matchOnDescription?: boolean; matchOnDetail?: boolean; placeHolder?: string },
  ): Promise<BuiltinQuickPickItem | undefined>;
  openUntitledPine(code: string, languageId: string): Promise<void>;
  showErrorMessage(message: string): void;
}

/** Build QuickPick rows from catalog entries (stable id in description). */
export function builtinQuickPickItems(
  scripts: readonly BuiltinCatalogEntry[],
): BuiltinQuickPickItem[] {
  return scripts.map((builtin) => ({
    label: builtin.title,
    description: `${builtin.categoryLabel} · ${builtin.id}`,
    detail: builtin.description || builtin.covers || undefined,
    builtin,
  }));
}

/**
 * Pure apply flow: QuickPick → open untitled pinescript document with source.
 * Optional auto-run is left to the wiring agent when `axis.runScript` is clean.
 */
export async function runApplyBuiltin(deps: {
  scripts: readonly BuiltinCatalogEntry[];
  ui: ApplyBuiltinUi;
  languageId?: string;
}): Promise<ApplyBuiltinResult> {
  const scripts = deps.scripts;
  if (!scripts || scripts.length === 0) {
    deps.ui.showErrorMessage(APPLY_BUILTIN_EMPTY_MESSAGE);
    return { status: 'empty', message: APPLY_BUILTIN_EMPTY_MESSAGE };
  }

  const picked = await deps.ui.showQuickPick(builtinQuickPickItems(scripts), {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: 'Apply AXIS builtin script (offline catalog)',
  });
  if (!picked) {
    return { status: 'cancelled' };
  }

  const languageId = deps.languageId || PINE_LANGUAGE_ID;
  try {
    await deps.ui.openUntitledPine(picked.builtin.code, languageId);
    return { status: 'applied', builtin: picked.builtin };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = `AXIS: Apply Builtin failed: ${message}`;
    deps.ui.showErrorMessage(err);
    return { status: 'error', message: err, builtin: picked.builtin };
  }
}

function defaultUi(): ApplyBuiltinUi {
  return {
    async showQuickPick(items, options) {
      const picked = await window.showQuickPick(items, {
        matchOnDescription: options.matchOnDescription,
        matchOnDetail: options.matchOnDetail,
        placeHolder: options.placeHolder,
      });
      return picked;
    },
    async openUntitledPine(code, languageId) {
      const doc = await workspace.openTextDocument({ content: code, language: languageId });
      await window.showTextDocument(doc);
    },
    showErrorMessage(message) {
      void window.showErrorMessage(message);
    },
  };
}

/**
 * Register `axis.applyBuiltin`. Reads catalog from extensionPath/media/builtins.
 * Wiring agent should call this from activate and merge the contributes fragment.
 */
export function registerApplyBuiltin(
  context: ExtensionContext,
  opts?: { readFile?: ReadFileUtf8; ui?: ApplyBuiltinUi },
): { dispose(): void } {
  const readFile = opts?.readFile;
  const ui = opts?.ui ?? defaultUi();

  const disposable = commands.registerCommand(APPLY_BUILTIN_COMMAND, async () => {
    const loaded = loadBuiltinCatalog(context.extensionPath, readFile);
    if (!loaded.ok) {
      const err = `${APPLY_BUILTIN_LOAD_FAILED_PREFIX}${loaded.error}`;
      ui.showErrorMessage(err);
      return { status: 'error' as const, message: err };
    }
    return runApplyBuiltin({ scripts: loaded.catalog.scripts, ui });
  });

  context.subscriptions.push(disposable);
  return disposable;
}
