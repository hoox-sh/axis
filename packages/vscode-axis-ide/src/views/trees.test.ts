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
      createTreeView: () => ({
        dispose() {},
        onDidChangeSelection: () => ({ dispose() {} }),
      }),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showWarningMessage: () => undefined,
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        name: '',
        command: '',
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

type LibraryMod = typeof import('./library');
type LayersMod = typeof import('./layers');
type IndicatorsMod = typeof import('./indicators');

let library: LibraryMod;
let layers: LayersMod;
let indicators: IndicatorsMod;

beforeAll(async () => {
  library = await import('./library');
  layers = await import('./layers');
  indicators = await import('./indicators');
});

function tooltipValue(item: { tooltip?: unknown }): string {
  const t = item.tooltip;
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object' && 'value' in t) {
    return String((t as { value: unknown }).value);
  }
  return '';
}

function iconId(item: { iconPath?: unknown }): string | undefined {
  const icon = item.iconPath;
  if (icon && typeof icon === 'object' && 'id' in icon) {
    return String((icon as { id: unknown }).id);
  }
  return undefined;
}

describe('empty TreeDataProvider getChildren', () => {
  test('library root shows Apply a builtin', () => {
    const provider = new library.LibraryTreeProvider();
    const roots = provider.getChildren();
    expect(roots.map((n) => n.label)).toEqual(['Apply a builtin']);
    expect(library.libraryRootChildren().map((n) => n.label)).toEqual(['Apply a builtin']);
    expect(provider.getChildren(roots[0])).toEqual([]);
  });

  test('indicators root shows Apply a builtin', () => {
    const provider = new indicators.IndicatorsTreeProvider();
    const roots = provider.getChildren();
    expect(roots.map((n) => n.label)).toEqual(['Apply a builtin']);
    expect(indicators.indicatorsRootChildren().map((n) => n.label)).toEqual([
      'Apply a builtin',
    ]);
    expect(provider.getChildren(roots[0])).toEqual([]);
  });

  test('layers root keeps Scripts → Panes → Overlays → On-chain → Drawings', () => {
    const provider = new layers.LayersTreeProvider();
    const roots = provider.getChildren();
    expect(roots.map((n) => n.label)).toEqual([
      'Scripts',
      'Panes',
      'Overlays',
      'On-chain',
      'Drawings',
    ]);
    expect([...layers.LAYER_SECTION_ORDER]).toEqual([
      'Scripts',
      'Panes',
      'Overlays',
      'On-chain',
      'Drawings',
    ]);

    const scripts = roots[0];
    expect(scripts).toBeDefined();
    if (!scripts) throw new Error('expected Scripts section');
    const underScripts = provider.getChildren(scripts);
    expect(underScripts.map((n) => n.label)).toEqual(['Apply a builtin']);
    expect(provider.getChildren(underScripts[0])).toEqual([]);
  });

  test('library/layers/indicators view ids stay distinct from watchlist', () => {
    expect(library.LIBRARY_VIEW_ID).toBe('axis.library');
    expect(layers.LAYERS_VIEW_ID).toBe('axis.layers');
    expect(indicators.INDICATORS_VIEW_ID).toBe('axis.indicators');
    // Watchlist is contributed + registered separately (Task 20), not via trees.ts.
    expect([
      library.LIBRARY_VIEW_ID,
      layers.LAYERS_VIEW_ID,
      indicators.INDICATORS_VIEW_ID,
    ]).not.toContain('axis.watchlist');
  });
});

describe('TreeItem polish (icons, tooltips, descriptions)', () => {
  test('library empty uses book icon and untrusted tooltip', () => {
    const provider = new library.LibraryTreeProvider();
    const node = provider.getChildren()[0]!;
    const item = provider.getTreeItem(node);
    expect(item.contextValue).toBe('axis.library.empty');
    expect(iconId(item)).toBe('book');
    const tip = item.tooltip as {
      value: string;
      isTrusted: boolean;
      supportThemeIcons: boolean;
    };
    expect(tooltipValue(item)).toContain('kind: library');
    expect(tooltipValue(item)).toContain('library.empty');
    expect(tip.isTrusted).toBe(false);
    expect(tip.supportThemeIcons).toBe(false);
  });

  test('indicators empty uses graph icon', () => {
    const provider = new indicators.IndicatorsTreeProvider();
    const item = provider.getTreeItem(provider.getChildren()[0]!);
    expect(item.contextValue).toBe('axis.indicators.empty');
    expect(iconId(item)).toBe('graph');
    expect(tooltipValue(item)).toContain('kind: indicators');
  });

  test('layers section roots show (0) and layers icon; empty uses circle-slash', () => {
    const provider = new layers.LayersTreeProvider();
    const scripts = provider.getChildren()[0]!;
    const section = provider.getTreeItem(scripts);
    expect(section.contextValue).toBe('axis.layers.section');
    expect(section.description).toBe('(0)');
    expect(iconId(section)).toBe('layers');
    expect(tooltipValue(section)).toContain('kind: layers');
    expect(tooltipValue(section)).toContain(scripts.id);

    const empty = provider.getChildren(scripts)[0]!;
    const emptyItem = provider.getTreeItem(empty);
    expect(emptyItem.contextValue).toBe('axis.layers.empty');
    expect(iconId(emptyItem)).toBe('circle-slash');
  });
});
