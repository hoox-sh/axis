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
 * Plugins Manager TreeView (`axis.plugins`) — kind sections → builtin ids.
 */

import * as vscode from 'vscode';
import {
  ensureBuiltinsRegistered,
  getHostPluginRegistry,
  type HostPluginRegistry,
} from './registry';
import {
  PLUGINS_VIEW_ID,
  type PluginTreeNode,
  pluginsKindChildren,
  pluginsRootChildren,
} from './tree-model';

export {
  PLUGINS_VIEW_ID,
  type PluginTreeNode,
  pluginsKindChildren,
  pluginsRootChildren,
} from './tree-model';

/** Plugins Manager TreeDataProvider. */
export class PluginsTreeProvider
  implements vscode.TreeDataProvider<PluginTreeNode>
{
  constructor(
    private readonly registry: HostPluginRegistry = getHostPluginRegistry(),
  ) {
    ensureBuiltinsRegistered(this.registry);
  }

  getTreeItem(element: PluginTreeNode): vscode.TreeItem {
    const state = element.collapsible
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(element.label, state);
    item.id = element.id;
    item.contextValue = element.contextValue;
    return item;
  }

  getChildren(element?: PluginTreeNode): PluginTreeNode[] {
    if (!element) return pluginsRootChildren(this.registry);
    if (element.kind && element.collapsible) {
      return pluginsKindChildren(element.kind, this.registry);
    }
    return [];
  }
}

export function registerPluginsTreeView(
  context: vscode.ExtensionContext,
  registry?: HostPluginRegistry,
): PluginsTreeProvider {
  const provider = new PluginsTreeProvider(registry ?? getHostPluginRegistry());
  const view = vscode.window.createTreeView(PLUGINS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);
  return provider;
}
