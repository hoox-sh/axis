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
 * Kind TreeView for calculation engines (`axis.plugins.engine`).
 * Activate command is owned by plumbing — this view only contributes rows.
 */

import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import {
  ensureBuiltinsRegistered,
  type HostPluginRegistry,
} from '../registry';
import type { PluginKind } from '../types';

/** Duplicated from plumbing `kind-tree-model` (module not in this tree). */
export const PLUGIN_KIND_VIEW_IDS = {
  engine: 'axis.plugins.engine',
} as const;

/** Duplicated from plumbing `kind-tree-model`. */
export const ACTIVATE_PLUGIN_COMMAND = 'axis.plugins.activate';

export const ENGINE_PLUGINS_VIEW_ID = PLUGIN_KIND_VIEW_IDS.engine;

const ENGINE_KIND: PluginKind = 'engine';
const TOOLTIP_LEAD = 'Pine runtime';
const PYODIDE_ID = 'pyodide';

/** Duplicated from plumbing `kind-tree-model`. */
export type KindViewDeps = {
  isActive(kind: PluginKind, id: string): boolean;
  onActivate(kind: PluginKind, id: string): void | Thenable<void>;
};

export type EnginePluginTreeNode = {
  id: string;
  pluginId: string;
  name: string;
  builtIn: boolean;
  pluginDescription?: string;
};

/**
 * Tree change emitter that works under Bun unit mocks (last `mock.module`
 * may omit `EventEmitter`).
 */
function createTreeChangeEmitter<T>(): {
  event: vscode.Event<T>;
  fire(data: T): void;
} {
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

/** `axis.engine.allowPyodide` — only explicit `true` enables; never throws. */
export function readAllowPyodide(): boolean {
  try {
    return (
      vscode.workspace.getConfiguration('axis.engine').get('allowPyodide') ===
      true
    );
  } catch {
    return false;
  }
}

function pluginIsActive(deps: KindViewDeps, id: string): boolean {
  try {
    return deps.isActive(ENGINE_KIND, id) === true;
  } catch {
    return false;
  }
}

function engineDescription(
  pluginId: string,
  builtIn: boolean,
  active: boolean,
  allowPyodide: boolean,
): string {
  let desc = pluginId;
  if (!builtIn) desc = `${desc} (dynamic)`;
  if (pluginId === PYODIDE_ID && allowPyodide !== true) {
    desc = `${desc} flag off`;
  }
  if (active) desc = `● ${desc}`;
  return desc;
}

function engineContextValue(builtIn: boolean, active: boolean): string {
  if (active) return 'axis.plugins.engine.active';
  return builtIn
    ? 'axis.plugins.engine.builtin'
    : 'axis.plugins.engine.dynamic';
}

function engineTooltip(pluginDescription?: string): string {
  const extra =
    typeof pluginDescription === 'string' ? pluginDescription.trim() : '';
  if (extra) return `${TOOLTIP_LEAD}\n${extra}`;
  return TOOLTIP_LEAD;
}

function thenableThen(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return undefined;
  return (value as { then?: unknown }).then;
}

export function engineRootChildren(
  registry: HostPluginRegistry,
): EnginePluginTreeNode[] {
  try {
    ensureBuiltinsRegistered(registry);
    const rows = registry.list(ENGINE_KIND);
    if (!Array.isArray(rows)) return [];
    const out: EnginePluginTreeNode[] = [];
    for (const p of rows) {
      if (!p || typeof p !== 'object') continue;
      const id = typeof p.id === 'string' ? p.id.trim() : '';
      if (!id) continue;
      const name =
        typeof p.name === 'string' && p.name.trim() ? p.name.trim() : id;
      const pluginDescription =
        p.description != null ? String(p.description) : undefined;
      out.push({
        id: `${ENGINE_KIND}:${id}`,
        pluginId: id,
        name,
        builtIn: p.builtIn === true,
        pluginDescription,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Engines TreeDataProvider (`axis.plugins.engine`). */
export class EnginePluginsTreeProvider
  implements vscode.TreeDataProvider<EnginePluginTreeNode>
{
  private readonly _onDidChangeTreeData = createTreeChangeEmitter<
    EnginePluginTreeNode | undefined | null
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

  /** Plumbing owns `axis.plugins.activate`; fire so ● / contextValue update. */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Call after plumbing activate (or from tests). Never throws.
   * Fires the tree EventEmitter so the ● marker refreshes.
   */
  activate(id: string): void | Thenable<void> {
    try {
      const result = this.deps.onActivate(ENGINE_KIND, id);
      if (typeof thenableThen(result) === 'function') {
        return Promise.resolve(result).then(
          () => {
            this.refresh();
          },
          () => {
            this.refresh();
          },
        );
      }
    } catch {
      /* still refresh so the tree recovers */
    }
    this.refresh();
  }

  getTreeItem(element: EnginePluginTreeNode): vscode.TreeItem {
    const none = vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(element.name, none);
    item.id = element.id;
    const active = pluginIsActive(this.deps, element.pluginId);
    const allowPyodide = readAllowPyodide();
    item.description = engineDescription(
      element.pluginId,
      element.builtIn,
      active,
      allowPyodide,
    );
    item.tooltip = engineTooltip(element.pluginDescription);
    item.contextValue = engineContextValue(element.builtIn, active);
    item.command = {
      command: ACTIVATE_PLUGIN_COMMAND,
      title: 'Activate',
      arguments: [{ kind: ENGINE_KIND, id: element.pluginId }],
    };
    return item;
  }

  getChildren(element?: EnginePluginTreeNode): EnginePluginTreeNode[] {
    if (element) return [];
    return engineRootChildren(this.registry);
  }
}

export function registerEnginePluginsView(
  context: ExtensionContext,
  registry: HostPluginRegistry,
  deps: KindViewDeps,
): EnginePluginsTreeProvider {
  try {
    ensureBuiltinsRegistered(registry);
  } catch {
    /* provider getChildren never-throws */
  }
  const provider = new EnginePluginsTreeProvider(registry, deps);
  const view = vscode.window.createTreeView(ENGINE_PLUGINS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(view);
  return provider;
}
