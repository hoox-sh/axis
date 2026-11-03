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
 * Kind-view helpers. Per-kind TreeView classes stay on disk for unit tests;
 * `registerPluginKindViews` does not createTreeView — `axis.plugins` is a webview.
 */

import type { ExtensionContext } from 'vscode';
import { isActivePlugin, writeActivePlugin, type WorkspaceStateHelpers } from './active';
import type { KindViewDeps } from './kind-tree-model';
import type { HostPluginRegistry } from './registry';

export function bindKindViewDeps(helpers: WorkspaceStateHelpers): KindViewDeps {
  return {
    isActive: (kind, id) => isActivePlugin(helpers, kind, id),
    onActivate: async (kind, id) => {
      await writeActivePlugin(helpers, kind, id);
    },
  };
}

export type KindViewRegistrar = (
  context: ExtensionContext,
  registry: HostPluginRegistry,
  deps: KindViewDeps,
) => unknown;

/** Call one kind-view registrar without letting it fail the others. */
export function safeCallKindViewRegistrar(
  fn: KindViewRegistrar,
  context: ExtensionContext,
  registry: HostPluginRegistry,
  deps: KindViewDeps,
): unknown {
  try {
    return fn(context, registry, deps);
  } catch {
    return undefined;
  }
}

/** Invoke `provider.refresh()` when present. Never throws. */
export function callKindViewRefresh(provider: unknown): void {
  try {
    if (!provider || typeof provider !== 'object') return;
    const rec = provider as { refresh?: unknown };
    const refresh = rec.refresh;
    if (typeof refresh !== 'function') return;
    refresh.call(provider);
  } catch {
    // never throw
  }
}

/**
 * Kind TreeViews are not registered — `axis.plugins` is a WebviewView.
 * Returns a no-op refresh so activate plumbing can still call it.
 */
export function registerPluginKindViews(
  _context: ExtensionContext,
  _registry: HostPluginRegistry,
  workspaceStateHelpers: WorkspaceStateHelpers,
): () => void {
  bindKindViewDeps(workspaceStateHelpers);
  return function refreshAll() {
    // no TreeViews to refresh
  };
}
