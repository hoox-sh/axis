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
 * Per-kind Components TreeView (`axis.plugins.component`).
 * TreeView actions only — no Solid mount and no WebviewView assets in this slice.
 */

import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import {
  ensureBuiltinsRegistered,
  type HostPluginRegistry,
} from '../registry';
import type { PluginKind } from '../types';

/** Duplicated from plumbing `kind-tree-model` (module not in this tree). */
export const COMPONENT_PLUGINS_VIEW_ID = 'axis.plugins.component';

/** Duplicated from plumbing `kind-tree-model`. */
export const ACTIVATE_PLUGIN_COMMAND = 'axis.plugins.activate';

const KIND: PluginKind = 'component';
const TOOLTIP_LEAD = 'Host contribution (no Solid mount)';

/** Host callbacks for active-id persist (`axis.plugins.active.v1`). */
export type KindViewDeps = {
  isActive(kind: PluginKind, id: string): boolean;
  onActivate(kind: PluginKind, id: string): void | Thenable<void>;
};

export type ComponentPluginTreeNode = {
  id: string;
  pluginId: string;
  name: string;
  builtIn: boolean;
  pluginDescription?: string;
};

function treeItemNoneState(): number {
  const collapsible = (
    vscode as {
      TreeItemCollapsibleState?: { None?: number };
    }
  ).TreeItemCollapsibleState;
  if (collapsible && typeof collapsible.None === 'number') {
    return collapsible.None;
  }
  return 0;
}

function createTreeChangeEmitter<T>(): {
  event: vscode.Event<T>;
  fire(data: T): void;
} {
  const Emitter = (
    vscode as {
      EventEmitter?: new () => { event: vscode.Event<T>; fire(data: T): void };
    }
  ).EventEmitter;
  if (typeof Emitter === 'function') {
    return new Emitter();
  }
  const listeners = new Set<(data: T) => void>();
  return {
    event: ((listener: (data: T) => void) => {
      listeners.add(listener);
      return {
        dispose() {
          listeners.delete(listener);
        },
      };
    }) as vscode.Event<T>,
    fire(data: T) {
      for (const listener of listeners) listener(data);
    },
  };
}

function pluginIsActive(deps: KindViewDeps, id: string): boolean {
  try {
    return deps.isActive(KIND, id) === true;
  } catch {
    return false;
  }
}

function componentDescription(
  pluginId: string,
  builtIn: boolean,
  active: boolean,
): string {
  let desc = pluginId;
  if (!builtIn) desc = `${desc} (dynamic)`;
  if (active) desc = `● ${desc}`;
  return desc;
}

function componentContextValue(builtIn: boolean, active: boolean): string {
  if (active) return 'axis.plugins.component.active';
  if (builtIn) return 'axis.plugins.component.builtin';
  return 'axis.plugins.component.dynamic';
}

function componentTooltip(pluginDescription?: string): string {
  const extra =
    typeof pluginDescription === 'string' ? pluginDescription.trim() : '';
  if (extra) return `${TOOLTIP_LEAD}\n${extra}`;
  return TOOLTIP_LEAD;
}

/** Flat catalog rows (never throws). */
export function componentRootChildren(
  registry: HostPluginRegistry,
): ComponentPluginTreeNode[] {
  try {
    const rows = registry.list(KIND);
    if (!Array.isArray(rows)) return [];
    const out: ComponentPluginTreeNode[] = [];
    for (const plugin of rows) {
      if (!plugin || typeof plugin !== 'object') continue;
      const pluginId = String(plugin.id || '').trim();
      if (!pluginId) continue;
      const nameRaw = plugin.name;
      const name =
        typeof nameRaw === 'string' && nameRaw.trim()
          ? nameRaw.trim()
          : pluginId;
      const node: ComponentPluginTreeNode = {
        id: `plugin:${KIND}:${pluginId}`,
        pluginId,
        name,
        builtIn: plugin.builtIn === true,
      };
      const d = plugin.description;
      if (typeof d === 'string' && d.trim()) {
        node.pluginDescription = d.trim();
      }
      out.push(node);
    }
    return out;
  } catch {
    return [];
  }
}

/** Components TreeDataProvider — native TreeView only (no webview html). */
export class ComponentPluginsTreeProvider
  implements vscode.TreeDataProvider<ComponentPluginTreeNode>
{
  private readonly _onDidChangeTreeData = createTreeChangeEmitter<
    ComponentPluginTreeNode | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly registry: HostPluginRegistry,
    private readonly deps: KindViewDeps,
  ) {
    try {
      ensureBuiltinsRegistered(this.registry);
    } catch {
      /* getChildren stays never-throw */
    }
  }

  refresh(): void {
    try {
      this._onDidChangeTreeData.fire(undefined);
    } catch {
      /* never throw from public refresh */
    }
  }

  getTreeItem(element: ComponentPluginTreeNode): vscode.TreeItem {
    try {
      const name =
        element && typeof element.name === 'string' ? element.name : '';
      const item = new vscode.TreeItem(name, treeItemNoneState());
      const pluginId =
        element && typeof element.pluginId === 'string' ? element.pluginId : '';
      const builtIn = Boolean(element && element.builtIn === true);
      const active = pluginId ? pluginIsActive(this.deps, pluginId) : false;
      item.id =
        element && typeof element.id === 'string' ? element.id : pluginId;
      item.description = componentDescription(pluginId, builtIn, active);
      item.tooltip = componentTooltip(element ? element.pluginDescription : undefined);
      item.contextValue = componentContextValue(builtIn, active);
      item.command = {
        command: ACTIVATE_PLUGIN_COMMAND,
        title: 'Activate plugin',
        arguments: [{ kind: KIND, id: pluginId }],
      };
      return item;
    } catch {
      const fallback = element ? element.name : KIND;
      return new vscode.TreeItem(fallback || KIND);
    }
  }

  getChildren(element?: ComponentPluginTreeNode): ComponentPluginTreeNode[] {
    try {
      if (element) return [];
      return componentRootChildren(this.registry);
    } catch {
      return [];
    }
  }
}

function wrapDeps(deps: KindViewDeps, refresh: () => void): KindViewDeps {
  return {
    isActive: (kind, id) => {
      try {
        return deps.isActive(kind, id) === true;
      } catch {
        return false;
      }
    },
    onActivate: (kind, id) => {
      try {
        const result = deps.onActivate(kind, id);
        if (
          result != null &&
          typeof (result as { then?: unknown }).then === 'function'
        ) {
          return Promise.resolve(result).then(
            () => {
              refresh();
            },
            () => {
              refresh();
            },
          );
        }
      } catch {
        /* still refresh so the tree recovers */
      }
      refresh();
    },
  };
}

/**
 * Register the Components TreeView. Does not register `axis.plugins.activate`
 * (plumbing owns that command) and does not create WebviewView assets.
 */
export function registerComponentPluginsView(
  context: ExtensionContext,
  registry: HostPluginRegistry,
  deps: KindViewDeps,
): ComponentPluginsTreeProvider {
  try {
    ensureBuiltinsRegistered(registry);
  } catch {
    /* provider getChildren never-throws */
  }
  const box: { refresh: () => void } = {
    refresh() {},
  };
  const provider = new ComponentPluginsTreeProvider(
    registry,
    wrapDeps(deps, () => {
      box.refresh();
    }),
  );
  box.refresh = () => {
    provider.refresh();
  };
  try {
    const view = vscode.window.createTreeView(COMPONENT_PLUGINS_VIEW_ID, {
      treeDataProvider: provider,
      showCollapseAll: false,
    });
    const subs = context.subscriptions;
    if (subs && typeof subs.push === 'function') {
      subs.push(view);
    }
  } catch {
    /* view registration is best-effort */
  }
  return provider;
}
