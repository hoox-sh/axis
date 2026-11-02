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
 * `axis.plugins.activate` — TreeItem.command argument `{ kind, id }`.
 * Never throws.
 */

import type { Disposable, ExtensionContext } from 'vscode';
import { commands, window } from 'vscode';
import { isActivePlugin, readActivePlugins, writeActivePlugin, type WorkspaceStateHelpers } from './active';
import { notifyActivePlugins } from './events';
import { ACTIVATE_PLUGIN_COMMAND } from './kind-tree-model';
import { PLUGIN_KINDS, type PluginKind } from './types';

export { ACTIVATE_PLUGIN_COMMAND };

export type ActivatePluginArg = {
  kind: PluginKind;
  id: string;
};

function warn(message: string): void {
  try {
    window.showWarningMessage(message);
  } catch {
    // UI host unavailable
  }
}

/** Decode TreeItem.command argument (never throws). */
export function parseActivatePluginArg(arg: unknown): ActivatePluginArg | null {
  try {
    if (arg == null || typeof arg !== 'object' || Array.isArray(arg)) {
      return null;
    }
    const rec = arg as Record<string, unknown>;
    const kindRaw = rec.kind;
    const idRaw = rec.id;
    if (typeof kindRaw !== 'string' || typeof idRaw !== 'string') return null;
    const kind = kindRaw.trim();
    const id = idRaw.trim();
    if (!id || !(PLUGIN_KINDS as readonly string[]).includes(kind)) return null;
    return { kind: kind as PluginKind, id };
  } catch {
    return null;
  }
}

/**
 * Write the active plugin id then invoke `onChanged` so kind trees can refresh.
 * Never throws.
 */
export async function runActivatePluginCommand(
  helpers: WorkspaceStateHelpers,
  arg: unknown,
  onChanged?: () => void | Thenable<void>,
): Promise<boolean> {
  const parsed = parseActivatePluginArg(arg);
  if (!parsed) {
    warn('AXIS: Activate Plugin requires { kind, id }.');
    return false;
  }
  const ok = await writeActivePlugin(helpers, parsed.kind, parsed.id);
  if (!ok) {
    warn('AXIS: Could not activate plugin.');
    return false;
  }
  notifyActivePlugins(readActivePlugins(helpers));
  if (onChanged) {
    try {
      await onChanged();
    } catch {
      // refresh is best-effort
    }
  }
  return isActivePlugin(helpers, parsed.kind, parsed.id);
}

export function registerActivatePluginCommand(
  context: ExtensionContext,
  helpers: WorkspaceStateHelpers,
  onChanged?: () => void | Thenable<void>,
): Disposable {
  const disp = commands.registerCommand(
    ACTIVATE_PLUGIN_COMMAND,
    async (arg?: unknown) => {
      await runActivatePluginCommand(helpers, arg, onChanged);
    },
  );
  context.subscriptions.push(disp);
  return disp;
}
