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
 * Plugins registry host + Workers probe registration.
 * Call {@link registerPluginsAndWorkers} from extension activate once wiring lands.
 */

import type { ExtensionContext } from 'vscode';
import { commands } from 'vscode';
import {
  PROBE_ALL_COMMAND,
  registerWorkersTreeView,
  runProbeAllCommand,
  type WorkersTreeProvider,
} from '../views/workers';
import {
  PLUGINS_WEBVIEW_VIEW_ID,
  PluginsWebviewViewProvider,
  registerPluginsWebviewView,
} from './plugins-panel';
import {
  createMemoryWorkspaceState,
  isActivePlugin,
  parseActivePluginsV1,
  readActivePlugins,
  workspaceStateFromContext,
  writeActivePlugin,
} from './active';
import { registerActivatePluginCommand } from './activate-command';
import {
  chartPluginsFromActive,
  notifyActivePlugins,
  resetActivePluginsEventsForTests,
  subscribeActivePlugins,
  type ActivePluginsListener,
  type ChartPluginIds,
} from './events';
import {
  BUILTIN_ENGINE_IDS,
  BUILTIN_SOURCE_IDS,
  BUILTIN_PLUGIN_DESCRIPTORS,
  builtinIdsForKind,
} from './builtins';
import {
  ACTIVATE_PLUGIN_COMMAND,
  PLUGIN_KIND_VIEW_IDS,
  type KindViewDeps,
  type PluginKindViewId,
} from './kind-tree-model';
import {
  bindKindViewDeps,
  callKindViewRefresh,
  registerPluginKindViews,
} from './kind-views';
import {
  createMemoryGlobalState,
  parsePluginsV1,
  readPluginsV1,
  sanitizeInstalledPluginMeta,
  writePluginsV1,
} from './persist';
import {
  HostPluginRegistry,
  _resetHostPluginRegistryForTests,
  ensureBuiltinsRegistered,
  getHostPluginRegistry,
} from './registry';
import {
  PLUGINS_STATUS_MENU_COMMAND,
  refreshPluginsStatusBar,
  registerPluginsStatusBar,
} from './status-bar';
import {
  PluginsTreeProvider,
  registerPluginsTreeView,
} from './tree';
import {
  PLUGINS_VIEW_ID,
  pluginsKindChildren,
  pluginsRootChildren,
} from './tree-model';
import {
  ACTIVE_PLUGINS_WORKSPACE_STATE_KEY,
  DEFAULT_ACTIVE_PLUGINS_V1,
  EMPTY_PLUGINS_V1,
  PLUGINS_GLOBAL_STATE_KEY,
  PLUGIN_KINDS,
  type ActivePluginsV1,
  type GlobalStateHelpers,
  type InstalledPluginMeta,
  type PluginDescriptor,
  type PluginKind,
  type WorkspaceStateHelpers,
  pluginKey,
} from './types';

export type RegisterPluginsAndWorkersResult = {
  registry: HostPluginRegistry;
  pluginsProvider: PluginsTreeProvider;
  workersProvider: WorkersTreeProvider;
  pluginsWebview: PluginsWebviewViewProvider;
};

/**
 * Register Plugins WebviewView + Workers, ensure builtins, bind
 * `axis.plugins.v1` / `axis.plugins.active.v1`, and register
 * `axis.workers.probeAll` + `axis.plugins.activate` + StatusBar
 * `axis.plugins.statusMenu` (never-throw).
 *
 * Does not createTreeView for `axis.plugins` or the six kind views.
 * PluginsTreeProvider / kind TreeView classes stay exported for unit tests.
 *
 * Does not edit package.json / extension.ts — callers wire activate separately.
 */
export function registerPluginsAndWorkers(
  context: ExtensionContext,
  globalStateHelpers: GlobalStateHelpers,
): RegisterPluginsAndWorkersResult {
  const registry = ensureBuiltinsRegistered(getHostPluginRegistry());

  readPluginsV1(globalStateHelpers);
  const workspaceHelpers = workspaceStateFromContext(context);
  readActivePlugins(workspaceHelpers);

  const pluginsProvider = new PluginsTreeProvider(registry);
  const workersProvider = registerWorkersTreeView(context);

  const refreshAll = registerPluginKindViews(context, registry, workspaceHelpers);
  const pluginsWebview = registerPluginsWebviewView(
    context,
    registry,
    workspaceHelpers,
    () => {
      refreshAll();
      refreshPluginsStatusBar();
    },
  );
  registerActivatePluginCommand(context, workspaceHelpers, () => {
    refreshAll();
    pluginsWebview.postState();
    refreshPluginsStatusBar();
    notifyActivePlugins(readActivePlugins(workspaceHelpers));
  });
  registerPluginsStatusBar(context, workspaceHelpers, registry, () => {
    refreshAll();
    pluginsWebview.postState();
    notifyActivePlugins(readActivePlugins(workspaceHelpers));
  });

  const probeCmd = commands.registerCommand(PROBE_ALL_COMMAND, async () => {
    return runProbeAllCommand(workersProvider);
  });
  context.subscriptions.push(probeCmd);

  return { registry, pluginsProvider, workersProvider, pluginsWebview };
}

export {
  ACTIVATE_PLUGIN_COMMAND,
  ACTIVE_PLUGINS_WORKSPACE_STATE_KEY,
  BUILTIN_ENGINE_IDS,
  BUILTIN_SOURCE_IDS,
  BUILTIN_PLUGIN_DESCRIPTORS,
  DEFAULT_ACTIVE_PLUGINS_V1,
  bindKindViewDeps,
  callKindViewRefresh,
  builtinIdsForKind,
  chartPluginsFromActive,
  createMemoryGlobalState,
  createMemoryWorkspaceState,
  EMPTY_PLUGINS_V1,
  ensureBuiltinsRegistered,
  getHostPluginRegistry,
  HostPluginRegistry,
  isActivePlugin,
  notifyActivePlugins,
  parseActivePluginsV1,
  parsePluginsV1,
  PLUGIN_KIND_VIEW_IDS,
  PLUGINS_GLOBAL_STATE_KEY,
  PLUGINS_STATUS_MENU_COMMAND,
  PLUGINS_VIEW_ID,
  PLUGINS_WEBVIEW_VIEW_ID,
  PluginsWebviewViewProvider,
  PLUGIN_KINDS,
  pluginKey,
  PluginsTreeProvider,
  pluginsKindChildren,
  pluginsRootChildren,
  readActivePlugins,
  readPluginsV1,
  refreshPluginsStatusBar,
  resetActivePluginsEventsForTests,
  registerActivatePluginCommand,
  registerPluginKindViews,
  registerPluginsStatusBar,
  registerPluginsTreeView,
  registerPluginsWebviewView,
  sanitizeInstalledPluginMeta,
  subscribeActivePlugins,
  workspaceStateFromContext,
  writeActivePlugin,
  writePluginsV1,
  _resetHostPluginRegistryForTests,
};

export type {
  ActivePluginsListener,
  ActivePluginsV1,
  ChartPluginIds,
  GlobalStateHelpers,
  InstalledPluginMeta,
  KindViewDeps,
  PluginDescriptor,
  PluginKind,
  PluginKindViewId,
  WorkspaceStateHelpers,
};
