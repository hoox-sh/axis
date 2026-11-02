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
 * Pure Plugins TreeView model helpers (no vscode import).
 */

import {
  ensureBuiltinsRegistered,
  getHostPluginRegistry,
  type HostPluginRegistry,
} from './registry';
import { PLUGIN_KINDS, type PluginKind } from './types';

export const PLUGINS_VIEW_ID = 'axis.plugins';

export type PluginTreeNode = {
  id: string;
  label: string;
  collapsible: boolean;
  kind?: PluginKind;
  contextValue: string;
};

export function pluginsKindChildren(
  kind: PluginKind,
  registry: HostPluginRegistry = getHostPluginRegistry(),
): PluginTreeNode[] {
  ensureBuiltinsRegistered(registry);
  return registry.list(kind).map((p) => ({
    id: `plugin:${p.kind}:${p.id}`,
    label: p.builtIn ? `${p.id}` : `${p.id} (dynamic)`,
    collapsible: false,
    kind: p.kind,
    contextValue: p.builtIn ? 'axis.plugins.builtin' : 'axis.plugins.dynamic',
  }));
}

export function pluginsRootChildren(
  registry: HostPluginRegistry = getHostPluginRegistry(),
): PluginTreeNode[] {
  ensureBuiltinsRegistered(registry);
  return PLUGIN_KINDS.map((kind) => {
    const count = registry.list(kind).length;
    return {
      id: `kind:${kind}`,
      label: `${kind} (${count})`,
      collapsible: true,
      kind,
      contextValue: 'axis.plugins.kind',
    };
  });
}
