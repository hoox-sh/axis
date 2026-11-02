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
  class LanguageModelTextPart {
    value: string;
    constructor(value: string) {
      this.value = value;
    }
  }
  class LanguageModelToolResult {
    content: unknown[];
    constructor(content: unknown[]) {
      this.content = content;
    }
  }
  class MarkdownString {
    value: string;
    constructor(value = '') {
      this.value = value;
    }
  }
  class McpStdioServerDefinition {
    label: string;
    command: string;
    args: string[];
    env: Record<string, string | number | null>;
    constructor(
      label: string,
      command: string,
      args: string[] = [],
      env: Record<string, string | number | null> = {},
    ) {
      this.label = label;
      this.command = command;
      this.args = args;
      this.env = env;
    }
  }
  class Uri {
    fsPath: string;
    constructor(fsPath: string) {
      this.fsPath = fsPath;
    }
    static file(p: string) {
      return new Uri(p);
    }
    static joinPath(base: { fsPath?: string }, ...parts: string[]) {
      const root = base?.fsPath ?? '';
      if (root === '/throw-fs') {
        return {
          get fsPath(): string {
            throw new Error('fsPath');
          },
        };
      }
      return new Uri([root, ...parts].filter(Boolean).join('/'));
    }
    toString() {
      return `file://${this.fsPath}`;
    }
  }
  const ColorThemeKind = {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  };
  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ColorThemeKind,
    Uri,
    LanguageModelTextPart,
    LanguageModelToolResult,
    MarkdownString,
    McpStdioServerDefinition,
    window: {
      activeColorTheme: { kind: ColorThemeKind.Dark },
      createTreeView: (id: string) => {
        createdTreeViews.push(id);
        const bucket = (globalThis as { __axisPluginKindTreeViews?: Array<{ id: string }> })
          .__axisPluginKindTreeViews;
        if (bucket) bucket.push({ id });
        return { dispose() {} };
      },
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showWarningMessage: () => undefined,
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        show() {},
        dispose() {},
      }),
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
    },
    workspace: {
      getConfiguration(section?: string) {
        const gg = globalThis as {
          __axisEngineCfgThrow?: boolean;
          __axisAllowPyodide?: unknown;
          __axisLiveEnabled?: unknown;
          __axisAllowUrlInstall?: unknown;
        };
        if (gg.__axisEngineCfgThrow === true) throw new Error('cfg');
        return {
          get(key: string, def?: unknown) {
            if (section === 'axis.engine' && key === 'allowPyodide') {
              return gg.__axisAllowPyodide;
            }
            if (section === 'axis.live' && key === 'enabled') return gg.__axisLiveEnabled;
            if (section === 'axis.plugins' && key === 'allowUrlInstall') {
              return gg.__axisAllowUrlInstall;
            }
            return def;
          },
        };
      },
    },
    lm: {
      registerMcpServerDefinitionProvider: () => ({ dispose() {} }),
      registerTool: () => ({ dispose() {} }),
    },
  };
});

type ComponentMod = typeof import('./component');
type RegistryMod = typeof import('../registry');

let component: ComponentMod;
let registryMod: RegistryMod;

beforeAll(async () => {
  component = await import('./component');
  registryMod = await import('../registry');
});

afterEach(() => {
  registryMod._resetHostPluginRegistryForTests();
  createdTreeViews.length = 0;
});

function emptyDeps(
  overrides?: Partial<ComponentMod['KindViewDeps']>,
): ComponentMod['KindViewDeps'] {
  return {
    isActive() {
      return false;
    },
    onActivate() {},
    ...overrides,
  };
}

describe('axis.plugins.component TreeView', () => {
  test('view id and contribute fragment', () => {
    expect(component.COMPONENT_PLUGINS_VIEW_ID).toBe('axis.plugins.component');
    expect(component.ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
    const fragment = JSON.parse(
      readFileSync(
        join(import.meta.dir, 'dataset-component-contributes.fragment.json'),
        'utf8',
      ),
    ) as {
      activationEvents: string[];
      contributes: { views: { axis: Array<{ id: string }> } };
    };
    expect(fragment.activationEvents).toContain('onView:axis.plugins.component');
    expect(
      fragment.contributes.views.axis.some(
        (v) => v.id === 'axis.plugins.component',
      ),
    ).toBe(true);
  });

  test('builtin row: hyperparameter-optimisation', () => {
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    const provider = new component.ComponentPluginsTreeProvider(
      reg,
      emptyDeps(),
    );
    const rows = provider.getChildren();
    const builtin = rows.find(
      (r) => r.pluginId === 'hyperparameter-optimisation',
    );
    expect(builtin).toBeDefined();
    if (!builtin) return;
    expect(builtin.name).toBe('Hyperparameter Optimisation');
    expect(builtin.builtIn).toBe(true);

    const item = provider.getTreeItem(builtin);
    expect(item.label).toBe('Hyperparameter Optimisation');
    expect(item.description).toBe('hyperparameter-optimisation');
    expect(item.contextValue).toBe('axis.plugins.component.builtin');
    expect(
      String(item.tooltip).startsWith('Host contribution (no Solid mount)'),
    ).toBe(true);
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate plugin',
      arguments: [
        { kind: 'component', id: 'hyperparameter-optimisation' },
      ],
    });
  });

  test('dynamic row gets (dynamic) description and .dynamic contextValue', () => {
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    reg.register({
      id: 'pyne-agent',
      name: 'PYNE Agent',
      kind: 'component',
    });
    const provider = new component.ComponentPluginsTreeProvider(
      reg,
      emptyDeps(),
    );
    const rows = provider.getChildren();
    const dyn = rows.find((r) => r.pluginId === 'pyne-agent');
    expect(dyn).toBeDefined();
    if (!dyn) return;
    expect(dyn.name).toBe('PYNE Agent');
    expect(dyn.builtIn).toBe(false);
    const item = provider.getTreeItem(dyn);
    expect(item.label).toBe('PYNE Agent');
    expect(item.description).toBe('pyne-agent (dynamic)');
    expect(item.contextValue).toBe('axis.plugins.component.dynamic');
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate plugin',
      arguments: [{ kind: 'component', id: 'pyne-agent' }],
    });
  });

  test('active marker prefixes ● and uses .active contextValue', () => {
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    const provider = new component.ComponentPluginsTreeProvider(
      reg,
      emptyDeps({
        isActive(kind, id) {
          return kind === 'component' && id === 'hyperparameter-optimisation';
        },
      }),
    );
    const rows = provider.getChildren();
    const builtin = rows.find(
      (r) => r.pluginId === 'hyperparameter-optimisation',
    );
    expect(builtin).toBeDefined();
    if (!builtin) return;
    const item = provider.getTreeItem(builtin);
    expect(item.label).toBe('Hyperparameter Optimisation');
    expect(item.description).toBe('● hyperparameter-optimisation');
    expect(item.contextValue).toBe('axis.plugins.component.active');
  });

  test('registerComponentPluginsView calls createTreeView', () => {
    const ctx = { subscriptions: [] as { dispose(): void }[] };
    const reg = registryMod.ensureBuiltinsRegistered(
      new registryMod.HostPluginRegistry(),
    );
    const provider = component.registerComponentPluginsView(
      ctx as never,
      reg,
      emptyDeps(),
    );
    expect(provider).toBeInstanceOf(component.ComponentPluginsTreeProvider);
    expect(createdTreeViews).toContain('axis.plugins.component');
    expect(ctx.subscriptions.length).toBeGreaterThan(0);
  });

  test('getChildren is empty-safe', () => {
    const throwing = {
      list() {
        throw new Error('boom');
      },
    } as never;
    const provider = new component.ComponentPluginsTreeProvider(
      throwing,
      emptyDeps(),
    );
    expect(provider.getChildren()).toEqual([]);
    expect(provider.getChildren(undefined)).toEqual([]);
    const leaf: ComponentMod['ComponentPluginTreeNode'] = {
      id: 'plugin:component:x',
      pluginId: 'x',
      name: 'X',
      builtIn: true,
    };
    expect(provider.getChildren(leaf)).toEqual([]);
  });
});
