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

import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const createdTreeViews: string[] = [];

mock.module('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    description?: string;
    contextValue?: string;
    tooltip?: string;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(label: string, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class EventEmitter {
    event = () => ({ dispose() {} });
    fire(_v?: unknown) {}
  }
  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter,
    window: {
      createTreeView: (id: string) => {
        createdTreeViews.push(id);
        return { dispose() {} };
      },
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
    },
  };
});

type DatasetMod = typeof import('./dataset');
type RegistryMod = typeof import('../registry');

let dataset: DatasetMod;
let registryMod: RegistryMod;

beforeAll(async () => {
  dataset = await import('./dataset');
  registryMod = await import('../registry');
});

afterEach(() => {
  registryMod._resetHostPluginRegistryForTests();
  createdTreeViews.length = 0;
});

function emptyDeps(
  overrides?: Partial<DatasetMod['KindViewDeps']>,
): DatasetMod['KindViewDeps'] {
  return {
    isActive() {
      return false;
    },
    onActivate() {},
    ...overrides,
  };
}

describe('axis.plugins.dataset TreeView', () => {
  test('view id and contribute fragment', () => {
    expect(dataset.DATASET_PLUGINS_VIEW_ID).toBe('axis.plugins.dataset');
    expect(dataset.ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
    const fragment = JSON.parse(
      readFileSync(
        join(import.meta.dir, 'dataset-component-contributes.fragment.json'),
        'utf8',
      ),
    ) as {
      activationEvents: string[];
      contributes: { views: { axis: Array<{ id: string }> } };
    };
    expect(fragment.activationEvents).toContain('onView:axis.plugins.dataset');
    expect(
      fragment.contributes.views.axis.some((v) => v.id === 'axis.plugins.dataset'),
    ).toBe(true);
  });

  test('builtin row: defillama-tvl', () => {
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    const provider = new dataset.DatasetPluginsTreeProvider(reg, emptyDeps());
    const rows = provider.getChildren();
    const builtin = rows.find((r) => r.pluginId === 'defillama-tvl');
    expect(builtin).toBeDefined();
    if (!builtin) return;
    expect(builtin.name).toBe('DefiLlama TVL');
    expect(builtin.builtIn).toBe(true);

    const item = provider.getTreeItem(builtin);
    expect(item.label).toBe('DefiLlama TVL');
    expect(item.description).toBe('defillama-tvl');
    expect(item.contextValue).toBe('axis.plugins.dataset.builtin');
    expect(String(item.tooltip).startsWith('On-chain dataset')).toBe(true);
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate plugin',
      arguments: [{ kind: 'dataset', id: 'defillama-tvl' }],
    });
  });

  test('dynamic row gets (dynamic) description and .dynamic contextValue', () => {
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    reg.register({
      id: 'onchain-jobs',
      name: 'On-chain Jobs',
      kind: 'dataset',
    });
    const provider = new dataset.DatasetPluginsTreeProvider(reg, emptyDeps());
    const rows = provider.getChildren();
    const dyn = rows.find((r) => r.pluginId === 'onchain-jobs');
    expect(dyn).toBeDefined();
    if (!dyn) return;
    expect(dyn.name).toBe('On-chain Jobs');
    expect(dyn.builtIn).toBe(false);
    const item = provider.getTreeItem(dyn);
    expect(item.label).toBe('On-chain Jobs');
    expect(item.description).toBe('onchain-jobs (dynamic)');
    expect(item.contextValue).toBe('axis.plugins.dataset.dynamic');
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate plugin',
      arguments: [{ kind: 'dataset', id: 'onchain-jobs' }],
    });
  });

  test('active marker prefixes ● and uses .active contextValue', () => {
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    const provider = new dataset.DatasetPluginsTreeProvider(
      reg,
      emptyDeps({
        isActive(kind, id) {
          return kind === 'dataset' && id === 'defillama-tvl';
        },
      }),
    );
    const rows = provider.getChildren();
    const builtin = rows.find((r) => r.pluginId === 'defillama-tvl');
    expect(builtin).toBeDefined();
    if (!builtin) return;
    const item = provider.getTreeItem(builtin);
    expect(item.label).toBe('DefiLlama TVL');
    expect(item.description).toBe('● defillama-tvl');
    expect(item.contextValue).toBe('axis.plugins.dataset.active');
  });

  test('registerDatasetPluginsView calls createTreeView', () => {
    const ctx = { subscriptions: [] as { dispose(): void }[] };
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    const provider = dataset.registerDatasetPluginsView(
      ctx as never,
      reg,
      emptyDeps(),
    );
    expect(provider).toBeInstanceOf(dataset.DatasetPluginsTreeProvider);
    expect(createdTreeViews).toContain('axis.plugins.dataset');
    expect(ctx.subscriptions.length).toBeGreaterThan(0);
  });

  test('getChildren is empty-safe', () => {
    const throwing = {
      list() {
        throw new Error('boom');
      },
    } as never;
    const provider = new dataset.DatasetPluginsTreeProvider(
      throwing,
      emptyDeps(),
    );
    expect(provider.getChildren()).toEqual([]);
    expect(provider.getChildren(undefined)).toEqual([]);
    const leaf: DatasetMod['DatasetPluginTreeNode'] = {
      id: 'plugin:dataset:x',
      pluginId: 'x',
      name: 'X',
      builtIn: true,
    };
    expect(provider.getChildren(leaf)).toEqual([]);
  });
});
