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
  BUILTIN_ENGINE_IDS,
  BUILTIN_SOURCE_IDS,
  BUILTIN_PLUGIN_DESCRIPTORS,
  builtinIdsForKind,
} from './builtins';
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
  PluginsTreeProvider,
  registerPluginsTreeView,
} from './tree';
import {
  PLUGINS_VIEW_ID,
  pluginsKindChildren,
  pluginsRootChildren,
} from './tree-model';
import {
  EMPTY_PLUGINS_V1,
  PLUGINS_GLOBAL_STATE_KEY,
  PLUGIN_KINDS,
  type GlobalStateHelpers,
  type InstalledPluginMeta,
  type PluginDescriptor,
  type PluginKind,
  pluginKey,
} from './types';

export type RegisterPluginsAndWorkersResult = {
  registry: HostPluginRegistry;
  pluginsProvider: PluginsTreeProvider;
  workersProvider: WorkersTreeProvider;
};

/**
 * Register Plugins + Workers TreeViews, ensure builtins, bind `axis.plugins.v1`
 * helpers, and register `axis.workers.probeAll` (never-throw).
 *
 * Does not edit package.json / extension.ts — callers wire activate separately.
 */
export function registerPluginsAndWorkers(
  context: ExtensionContext,
  globalStateHelpers: GlobalStateHelpers,
): RegisterPluginsAndWorkersResult {
  const registry = ensureBuiltinsRegistered(getHostPluginRegistry());

  // Touch persist API so wiring can round-trip metadata (no secrets).
  readPluginsV1(globalStateHelpers);

  const pluginsProvider = registerPluginsTreeView(context, registry);
  const workersProvider = registerWorkersTreeView(context);

  const probeCmd = commands.registerCommand(PROBE_ALL_COMMAND, async () => {
    return runProbeAllCommand(workersProvider);
  });
  context.subscriptions.push(probeCmd);

  return { registry, pluginsProvider, workersProvider };
}

export {
  BUILTIN_ENGINE_IDS,
  BUILTIN_SOURCE_IDS,
  BUILTIN_PLUGIN_DESCRIPTORS,
  builtinIdsForKind,
  createMemoryGlobalState,
  EMPTY_PLUGINS_V1,
  ensureBuiltinsRegistered,
  getHostPluginRegistry,
  HostPluginRegistry,
  parsePluginsV1,
  PLUGINS_GLOBAL_STATE_KEY,
  PLUGINS_VIEW_ID,
  PLUGIN_KINDS,
  pluginKey,
  PluginsTreeProvider,
  pluginsKindChildren,
  pluginsRootChildren,
  readPluginsV1,
  sanitizeInstalledPluginMeta,
  writePluginsV1,
  _resetHostPluginRegistryForTests,
};

export type {
  GlobalStateHelpers,
  InstalledPluginMeta,
  PluginDescriptor,
  PluginKind,
};
