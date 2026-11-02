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
      createTreeView: (id: string) => {
        const bag = globalThis as { __workersTreeViews?: string[] };
        (bag.__workersTreeViews ??= []).push(id);
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

type WorkersMod = typeof import('./workers');

let workers: WorkersMod;

beforeAll(async () => {
  workers = await import('./workers');
});

describe('axis.workers.probeAll offline', () => {
  test('probeAllWorkers never throws when fetch fails (offline)', async () => {
    const fetchImpl: workers.ProbeFetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };

    let snap: workers.WorkersOverviewSnapshot | undefined;
    await expect(
      (async () => {
        snap = await workers.probeAllWorkers({
          timeoutMs: 100,
          fetchImpl,
        });
      })(),
    ).resolves.toBeUndefined();

    expect(snap).toBeDefined();
    if (!snap) throw new Error('expected snapshot');
    expect(snap.results.length).toBe(workers.listWorkerCatalog().length);
    const http = snap.results.filter((r) => {
      const e = workers.getWorkerCatalogEntry(r.id);
      return e?.probe === 'http-health';
    });
    expect(http.length).toBeGreaterThan(0);
    for (const r of http) {
      expect(r.status).toBe('down');
      expect(r.error).toBeTruthy();
    }
    const skipped = snap.results.filter((r) => r.status === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
  });

  test('runProbeAllCommand never throws even if probeAll were hostile', async () => {
    const fetchImpl: workers.ProbeFetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    // No TreeDataProvider — avoids vscode.EventEmitter; command path still safe.
    const snap = await workers.runProbeAllCommand(undefined, {
      timeoutMs: 80,
      fetchImpl,
    });
    expect(snap.results.length).toBeGreaterThan(0);
    expect(workers.getLastWorkersSnapshot()?.checkedAt).toBe(snap.checkedAt);
  });

  test('probeWorker healthy path and unknown id', async () => {
    const fetchImpl: workers.ProbeFetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => '{"status":"ok"}',
    });
    const ok = await workers.probeWorker('pyne-pro', {
      timeoutMs: 200,
      fetchImpl,
    });
    expect(ok.status).toBe('healthy');
    expect(ok.error).toBeNull();

    const unknown = await workers.probeWorker('nope' as workers.WorkerId, {
      fetchImpl,
    });
    expect(unknown.status).toBe('unknown');
  });

  test('workers tree lists catalog entries', () => {
    workers._setLastWorkersSnapshotForTests(null);
    const roots = workers.workersRootChildren();
    expect(roots.map((n) => n.workerId)).toEqual(
      workers.listWorkerCatalog().map((e) => e.id),
    );
    expect(workers.WORKERS_VIEW_ID).toBe('axis.workers');
    expect(workers.PROBE_ALL_COMMAND).toBe('axis.workers.probeAll');
  });

  test('getTreeItem uses server-environment/vm icons and endpoint tooltip', () => {
    workers._setLastWorkersSnapshotForTests(null);
    const provider = new workers.WorkersTreeProvider();
    const nodes = provider.getChildren();
    const http = nodes.find((n) => n.workerId === 'pyne-pro');
    const wasm = nodes.find((n) => n.workerId === 'pyodide');
    expect(http).toBeDefined();
    expect(wasm).toBeDefined();
    const httpItem = provider.getTreeItem(http!);
    const wasmItem = provider.getTreeItem(wasm!);
    expect(httpItem.contextValue).toBe('axis.workers.entry');
    expect((httpItem.iconPath as { id?: string } | undefined)?.id).toBe(
      'server-environment',
    );
    expect((wasmItem.iconPath as { id?: string } | undefined)?.id).toBe('vm');
    const tip = httpItem.tooltip as {
      value: string;
      isTrusted: boolean;
      supportThemeIcons: boolean;
    };
    expect(tip.value).toContain('kind: worker');
    expect(tip.value).toContain('id: pyne-pro');
    expect(tip.value).toContain('endpoint: http://127.0.0.1:5002');
    expect(tip.isTrusted).toBe(false);
    expect(tip.supportThemeIcons).toBe(false);
  });

  test('description shows last probe status when present', () => {
    const checkedAt = Date.now();
    const results = workers.listWorkerCatalog().map((e) => {
      if (e.id === 'pyne-pro') {
        return {
          id: e.id,
          status: 'healthy' as const,
          latencyMs: 12,
          detail: 'ok',
          endpoint: e.defaultEndpoint,
          checkedAt,
          error: null,
        };
      }
      if (e.id === 'axis-worker') {
        return {
          id: e.id,
          status: 'down' as const,
          latencyMs: 80,
          detail: 'ECONNREFUSED',
          endpoint: e.defaultEndpoint,
          checkedAt,
          error: 'ECONNREFUSED',
        };
      }
      return {
        id: e.id,
        status: 'unknown' as const,
        latencyMs: null,
        detail: '',
        endpoint: e.defaultEndpoint,
        checkedAt,
        error: null,
      };
    });
    workers._setLastWorkersSnapshotForTests({
      results,
      healthy: 1,
      degraded: 0,
      down: 1,
      unknown: results.length - 2,
      checkedAt,
    });
    const roots = workers.workersRootChildren();
    expect(roots.find((n) => n.workerId === 'pyne-pro')?.description).toBe(
      'ok 12ms',
    );
    expect(roots.find((n) => n.workerId === 'axis-worker')?.description).toBe(
      'down',
    );
    expect(workers.formatWorkerProbeDescription(undefined)).toBeUndefined();
    expect(
      workers.formatWorkerProbeDescription({
        id: 'pyne-pro',
        status: 'healthy',
        latencyMs: null,
        detail: 'ok',
        endpoint: '',
        checkedAt,
        error: null,
      }),
    ).toBe('ok');
  });

  test('registerWorkersTreeView skips createTreeView when tree is false', () => {
    const bag = globalThis as { __workersTreeViews?: string[] };
    bag.__workersTreeViews = [];
    const skipped = workers.registerWorkersTreeView(
      { subscriptions: [] } as never,
      { tree: false },
    );
    expect(skipped).toBeInstanceOf(workers.WorkersTreeProvider);
    expect(bag.__workersTreeViews).toEqual([]);
    const shown = workers.registerWorkersTreeView({ subscriptions: [] } as never);
    expect(shown).toBeInstanceOf(workers.WorkersTreeProvider);
    expect(bag.__workersTreeViews).toEqual([workers.WORKERS_VIEW_ID]);
    workers.registerWorkersTreeView({ subscriptions: [] } as never, { tree: true });
    expect(bag.__workersTreeViews).toEqual([
      workers.WORKERS_VIEW_ID,
      workers.WORKERS_VIEW_ID,
    ]);
  });
});
