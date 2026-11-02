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
 * Per-kind Sources TreeView (`axis.plugins.source`).
 */

import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import {
  ACTIVATE_PLUGIN_COMMAND,
  PLUGIN_KIND_VIEW_IDS,
  type KindViewDeps,
} from '../kind-tree-model';
import {
  ensureBuiltinsRegistered,
  type HostPluginRegistry,
} from '../registry';
import type { PluginKind } from '../types';

export type { KindViewDeps };

export const SOURCE_PLUGINS_VIEW_ID = PLUGIN_KIND_VIEW_IDS.source;

const KIND: PluginKind = 'source';
const TOOLTIP_LEAD = 'Historical OHLCV';

export type SourcePluginTreeNode = {
  id: string;
  label: string;
  pluginId: string;
  builtIn: boolean;
  pluginDescription?: string;
};

function newTreeItem(label: string, state: number): vscode.TreeItem {
  try {
    return new vscode.TreeItem(label, state);
  } catch {
    return { label, collapsibleState: state } as vscode.TreeItem;
  }
}

function createTreeChangeEmitter<T>(): {
  event: vscode.Event<T>;
  fire(data: T): void;
} {
  // Local listeners — bun mock.module('vscode') last-wins often omits EventEmitter.
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

function safeIsActive(
  deps: KindViewDeps,
  kind: PluginKind,
  id: string,
): boolean {
  try {
    return deps.isActive(kind, id) === true;
  } catch {
    return false;
  }
}

function sourceChildren(
  registry: HostPluginRegistry,
): SourcePluginTreeNode[] {
  const rows = registry.list(KIND);
  const out: SourcePluginTreeNode[] = [];
  if (!Array.isArray(rows)) return out;
  for (const plugin of rows) {
    if (!plugin || typeof plugin !== 'object') continue;
    const pluginId = String(plugin.id || '').trim();
    if (!pluginId) continue;
    const nameRaw = plugin.name;
    const label =
      typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : pluginId;
    const builtIn = plugin.builtIn === true;
    const node: SourcePluginTreeNode = {
      id: `plugin:${KIND}:${pluginId}`,
      label,
      pluginId,
      builtIn,
    };
    const d = plugin.description;
    if (typeof d === 'string' && d.trim()) {
      node.pluginDescription = d.trim();
    }
    out.push(node);
  }
  return out;
}

/** Sources TreeDataProvider (`axis.plugins.source`). */
export class SourcePluginsTreeProvider
  implements vscode.TreeDataProvider<SourcePluginTreeNode>
{
  private readonly _onDidChangeTreeData = createTreeChangeEmitter<
    SourcePluginTreeNode | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly registry: HostPluginRegistry,
    private readonly deps: KindViewDeps,
  ) {
    try {
      ensureBuiltinsRegistered(this.registry);
    } catch {
      /* still serve getChildren empty-safe */
    }
  }

  refresh(): void {
    try {
      this._onDidChangeTreeData.fire(undefined);
    } catch {
      /* never throw from public refresh */
    }
  }

  getTreeItem(element: SourcePluginTreeNode): vscode.TreeItem {
    try {
      const label =
        element && typeof element.label === 'string' ? element.label : '';
      const item = newTreeItem(label, 0);
      const pluginId =
        element && typeof element.pluginId === 'string' ? element.pluginId : '';
      const builtIn = Boolean(element && element.builtIn === true);
      const active = pluginId ? safeIsActive(this.deps, KIND, pluginId) : false;
      const role = builtIn ? 'builtin' : 'dynamic';
      item.id =
        element && typeof element.id === 'string' ? element.id : pluginId;
      const descId = builtIn ? pluginId : `${pluginId} (dynamic)`;
      item.description = active ? `● ${descId}` : descId;
      item.contextValue = active
        ? `axis.plugins.source.${role}.active`
        : `axis.plugins.source.${role}`;
      const rawDesc =
        element && typeof element.pluginDescription === 'string'
          ? element.pluginDescription.trim()
          : '';
      item.tooltip = rawDesc ? `${TOOLTIP_LEAD}\n${rawDesc}` : TOOLTIP_LEAD;
      item.command = {
        command: ACTIVATE_PLUGIN_COMMAND,
        title: label || 'Activate',
        arguments: [{ kind: KIND, id: pluginId }],
      };
      return item;
    } catch {
      return newTreeItem('', 0);
    }
  }

  getChildren(element?: SourcePluginTreeNode): SourcePluginTreeNode[] {
    try {
      if (element) return [];
      ensureBuiltinsRegistered(this.registry);
      return sourceChildren(this.registry);
    } catch {
      return [];
    }
  }
}

function bindActivationRefresh(
  deps: KindViewDeps,
  provider: SourcePluginsTreeProvider,
): void {
  const innerActivate = deps.onActivate;
  const extra = deps as KindViewDeps & { refresh?: () => void };
  const priorRefresh = extra.refresh;
  deps.onActivate = (kind, id) => {
    let result: ReturnType<KindViewDeps['onActivate']>;
    try {
      result = innerActivate(kind, id);
    } catch {
      result = undefined;
    }
    provider.refresh();
    return result;
  };
  extra.refresh = () => {
    provider.refresh();
    if (typeof priorRefresh === 'function') {
      try {
        priorRefresh();
      } catch {
        /* ignore */
      }
    }
  };
}

export function registerSourcePluginsView(
  context: ExtensionContext,
  registry: HostPluginRegistry,
  deps: KindViewDeps,
): SourcePluginsTreeProvider {
  const provider = new SourcePluginsTreeProvider(registry, deps);
  try {
    ensureBuiltinsRegistered(registry);
    const view = vscode.window.createTreeView(SOURCE_PLUGINS_VIEW_ID, {
      treeDataProvider: provider,
      showCollapseAll: false,
    });
    const subs = context.subscriptions;
    if (subs && typeof subs.push === 'function') {
      subs.push(view);
    }
    bindActivationRefresh(deps, provider);
  } catch {
    /* view registration is best-effort */
  }
  return provider;
}
