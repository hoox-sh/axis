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

import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    description?: string;
    contextValue?: string;
    tooltip?: unknown;
    iconPath?: unknown;
    constructor(label: string, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeIcon {
    id: string;
    constructor(id: string) {
      this.id = id;
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
    isTrusted = false;
    supportThemeIcons = false;
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
    QuickPickItemKind: { Separator: -1, Default: 0 },
    TreeItem,
    ThemeIcon,
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
      createTreeView: () => ({ dispose() {} }),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      showInformationMessage: () => undefined,
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
            if (section === 'axis.engine' && key === 'allowPyodide') return gg.__axisAllowPyodide;
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

type AlertsMod = typeof import('./alerts');

let alerts: AlertsMod;

beforeAll(async () => {
  alerts = await import('./alerts');
});

describe('axis.alerts.v1 persist (mock Memento)', () => {
  test('constants and empty parse', () => {
    expect(alerts.ALERTS_STORAGE_KEY).toBe('axis.alerts.v1');
    expect(alerts.ALERTS_VIEW_ID).toBe('axis.alerts');
    expect(alerts.ALERTS_ADD_COMMAND).toBe('axis.alerts.add');
    expect(alerts.ALERTS_REMOVE_COMMAND).toBe('axis.alerts.remove');
    expect(alerts.parseAlertsV1(undefined)).toEqual([]);
    expect(alerts.parseAlertsV1(null)).toEqual([]);
    expect(alerts.parseAlertsV1({})).toEqual([]);
    expect(alerts.readAlertsV1(alerts.createMemoryWorkspaceState())).toEqual([]);
  });

  test('sanitize + round-trip add/remove via workspaceState', async () => {
    const mem = alerts.createMemoryWorkspaceState();
    expect(alerts.sanitizeAlertEntry({ id: '', title: 'x' })).toBeNull();
    expect(alerts.sanitizeAlertEntry({ id: 'a1', title: '  ' })).toBeNull();
    expect(
      alerts.sanitizeAlertEntry({
        id: 'a1',
        title: ' BTC cross ',
        condition: ' close > 1 ',
        enabled: false,
        extra: 'ignored',
      }),
    ).toEqual({
      id: 'a1',
      title: 'BTC cross',
      condition: 'close > 1',
      enabled: false,
    });

    const created = await alerts.addAlert(mem, {
      id: 'a1',
      title: 'BTC cross',
      condition: 'close > 100000',
    });
    expect(created).toEqual({
      id: 'a1',
      title: 'BTC cross',
      condition: 'close > 100000',
      enabled: true,
    });
    expect(mem.map.get(alerts.ALERTS_STORAGE_KEY)).toEqual([created]);
    expect(alerts.readAlertsV1(mem)).toEqual([created!]);

    const second = await alerts.addAlert(mem, { title: 'ETH drop' });
    expect(second?.title).toBe('ETH drop');
    expect(second?.enabled).toBe(true);
    expect(alerts.readAlertsV1(mem).map((a) => a.title)).toEqual([
      'BTC cross',
      'ETH drop',
    ]);

    expect(await alerts.removeAlert(mem, 'missing')).toBe(false);
    expect(await alerts.removeAlert(mem, 'a1')).toBe(true);
    expect(alerts.readAlertsV1(mem).map((a) => a.id)).toEqual([second!.id]);
    expect(await alerts.removeAlert(mem, second!.id)).toBe(true);
    expect(alerts.readAlertsV1(mem)).toEqual([]);
  });

  test('dedupes ids and drops invalid rows on parse', () => {
    const parsed = alerts.parseAlertsV1([
      { id: 'x', title: 'One' },
      { id: 'x', title: 'Dup' },
      { id: 'y' },
      null,
      { id: 'z', title: 'Two', enabled: false },
    ]);
    expect(parsed).toEqual([
      { id: 'x', title: 'One', enabled: true },
      { id: 'z', title: 'Two', enabled: false },
    ]);
  });
});

describe('AlertsTreeProvider + command flows', () => {
  test('tree lists empty placeholder then entries after add', async () => {
    const mem = alerts.createMemoryWorkspaceState();
    const provider = new alerts.AlertsTreeProvider(mem);
    const empty = provider.getChildren();
    expect(empty.map((n) => n.label)).toEqual(['Add an alert']);
    expect(alerts.alertsRootChildren([]).map((n) => n.label)).toEqual([
      'Add an alert',
    ]);
    expect(provider.getChildren(empty[0])).toEqual([]);
    const emptyItem = provider.getTreeItem(empty[0]!);
    expect(emptyItem.contextValue).toBe('axis.alerts.empty');
    expect((emptyItem.iconPath as { id?: string } | undefined)?.id).toBe('bell');

    await alerts.addAlert(mem, {
      id: 'n1',
      title: 'Notify',
      condition: 'price_cross',
    });
    provider.refresh();
    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.label).toBe('Notify');
    expect(roots[0]?.alertId).toBe('n1');
    const item = provider.getTreeItem(roots[0]!);
    expect(item.label).toBe('Notify');
    expect(item.contextValue).toBe('axis.alerts.entry');
    expect((item.iconPath as { id?: string } | undefined)?.id).toBe('bell');
    const tip = item.tooltip as {
      value: string;
      isTrusted: boolean;
      supportThemeIcons: boolean;
    };
    expect(tip.value).toContain('kind: alert');
    expect(tip.value).toContain('id: n1');
    expect(tip.value).toContain('condition: price_cross');
    expect(tip.isTrusted).toBe(false);
    expect(tip.supportThemeIcons).toBe(false);
  });

  test('disabled alert uses bell-slash', async () => {
    const mem = alerts.createMemoryWorkspaceState();
    await alerts.addAlert(mem, {
      id: 'off',
      title: 'Quiet',
      enabled: false,
    });
    const provider = new alerts.AlertsTreeProvider(mem);
    const item = provider.getTreeItem(provider.getChildren()[0]!);
    expect(item.contextValue).toBe('axis.alerts.entry');
    expect((item.iconPath as { id?: string } | undefined)?.id).toBe('bell-slash');
  });

  test('runAddAlertCommand / runRemoveAlertCommand with mock UI', async () => {
    const mem = alerts.createMemoryWorkspaceState();
    const provider = new alerts.AlertsTreeProvider(mem);
    let inputs = ['Alpha', 'close > 1'];
    const ui: AlertsMod['AlertsUi'] = {
      showInputBox: async () => inputs.shift(),
      showQuickPick: async (items) => items[0],
      showInformationMessage() {},
      showWarningMessage() {},
    };

    const added = await alerts.runAddAlertCommand(mem, ui, provider);
    expect(added?.title).toBe('Alpha');
    expect(added?.condition).toBe('close > 1');
    expect(provider.list()).toHaveLength(1);

    const cancelled = await alerts.runAddAlertCommand(
      mem,
      {
        ...ui,
        showInputBox: async () => undefined,
      },
      provider,
    );
    expect(cancelled).toBeNull();

    const removed = await alerts.runRemoveAlertCommand(mem, ui, provider);
    expect(removed).toBe(true);
    expect(provider.list()).toEqual([]);

    const none = await alerts.runRemoveAlertCommand(mem, ui, provider);
    expect(none).toBe(false);
  });

  test('add rejects blank title; cancel on condition returns null', async () => {
    const mem = alerts.createMemoryWorkspaceState();
    let step = 0;
    const ui: AlertsMod['AlertsUi'] = {
      showInputBox: async () => {
        step += 1;
        if (step === 1) return '   ';
        return undefined;
      },
      showQuickPick: async () => undefined,
      showWarningMessage() {},
    };
    expect(await alerts.runAddAlertCommand(mem, ui)).toBeNull();

    step = 0;
    const ui2: AlertsMod['AlertsUi'] = {
      showInputBox: async () => {
        step += 1;
        return step === 1 ? 'Keep' : undefined;
      },
      showQuickPick: async () => undefined,
    };
    expect(await alerts.runAddAlertCommand(mem, ui2)).toBeNull();
    expect(alerts.readAlertsV1(mem)).toEqual([]);
  });
});
