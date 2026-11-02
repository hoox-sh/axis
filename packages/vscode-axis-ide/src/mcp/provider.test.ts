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

import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const registeredCommands: Array<{
  command: string;
  cb: (...args: unknown[]) => unknown;
}> = [];
const registeredProviders: Array<{
  id: string;
  provider: {
    provideMcpServerDefinitions: () => Promise<unknown[]>;
    resolveMcpServerDefinition: (server: unknown) => Promise<unknown>;
  };
}> = [];
const warnings: Array<{ message: string; items: string[] }> = [];
const executed: string[] = [];
const openedDocs: Array<{ content: string; language: string }> = [];
let warningChoice: string | undefined;
const workspaceBag: Record<string, unknown> = {
  'mcp.stdio': true,
  'mcp.command': '',
  'mcp.allowNpx': false,
  'worker.url': 'https://worker.axis.hoox.sh',
};
let workerSectionUrl: string | undefined = 'https://worker.axis.hoox.sh';

mock.module('vscode', () => {
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
  class TreeItem {
    label: string;
    collapsibleState: number;
    constructor(label: string, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class EventEmitter {
    event = () => ({ dispose() {} });
    fire(_v?: unknown) {}
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
    McpStdioServerDefinition,
    LanguageModelTextPart,
    LanguageModelToolResult,
    MarkdownString,
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ColorThemeKind,
    Uri,
    commands: {
      registerCommand(command: string, cb: (...args: unknown[]) => unknown) {
        registeredCommands.push({ command, cb });
        return { dispose() {} };
      },
      executeCommand(command: string) {
        executed.push(command);
        return Promise.resolve(undefined);
      },
    },
    lm: {
      registerMcpServerDefinitionProvider(id: string, provider: unknown) {
        registeredProviders.push({ id, provider });
        return { dispose() {} };
      },
      registerTool(_name: string, _tool: unknown) {
        return { dispose() {} };
      },
    },
    window: {
      activeColorTheme: { kind: ColorThemeKind.Dark },
      showWarningMessage(message: string, ...items: string[]) {
        warnings.push({ message, items });
        return Promise.resolve(warningChoice);
      },
      showTextDocument: async () => ({}),
      createTreeView: () => ({ dispose() {} }),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        show() {},
        dispose() {},
      }),
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
        if (section === 'axis.engine') {
          return {
            get<T>(key: string, def?: T): T | undefined {
              if (key === 'allowPyodide') return gg.__axisAllowPyodide as T | undefined;
              return def;
            },
          };
        }
        if (section === 'axis.live') {
          return {
            get<T>(key: string, def?: T): T | undefined {
              if (key === 'enabled') return gg.__axisLiveEnabled as T | undefined;
              return def;
            },
          };
        }
        if (section === 'axis.plugins') {
          return {
            get<T>(key: string, def?: T): T | undefined {
              if (key === 'allowUrlInstall') return gg.__axisAllowUrlInstall as T | undefined;
              return def;
            },
          };
        }
        if (section === 'axis.worker') {
          return {
            get<T>(key: string, def?: T): T | undefined {
              if (key === 'url') {
                return (workerSectionUrl as T | undefined) ?? def;
              }
              return def;
            },
          };
        }
        return {
          get<T>(key: string, def?: T): T | undefined {
            if (Object.hasOwn(workspaceBag, key)) {
              return workspaceBag[key] as T;
            }
            return def;
          },
        };
      },
      openTextDocument: async (opts: { content: string; language: string }) => {
        openedDocs.push(opts);
        return { getText: () => opts.content };
      },
    },
  };
});

type ProviderMod = typeof import('./provider');
let provider: ProviderMod;

beforeAll(async () => {
  provider = await import('./provider');
});

beforeEach(() => {
  registeredCommands.length = 0;
  registeredProviders.length = 0;
  warnings.length = 0;
  executed.length = 0;
  openedDocs.length = 0;
  warningChoice = undefined;
  workspaceBag['mcp.stdio'] = true;
  workspaceBag['mcp.command'] = '';
  workspaceBag['mcp.allowNpx'] = false;
  workspaceBag['worker.url'] = 'https://worker.axis.hoox.sh';
  workerSectionUrl = 'https://worker.axis.hoox.sh';
  provider.resetMcpSoftFailWarningForTests();
});

const KEY = `pn_${'ab'.repeat(24)}`;

function reader(opts: {
  command?: string;
  allowNpx?: boolean;
  stdio?: boolean;
  workerUrl?: string;
}): import('./provider').McpConfigReader {
  const values: Record<string, unknown> = {
    'mcp.command': opts.command ?? '',
    'mcp.allowNpx': opts.allowNpx ?? false,
  };
  return {
    get<T>(section: string): T | undefined {
      return values[section] as T | undefined;
    },
    stdioEnabled: () => opts.stdio !== false,
    workerUrl: () => opts.workerUrl ?? 'https://worker.axis.hoox.sh',
  };
}

describe('MCP contributes fragment', () => {
  test('ids match provider constants', () => {
    const fragPath = join(import.meta.dir, 'mcp-contributes.fragment.json');
    const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as {
      activationEvents: string[];
      contributes: {
        commands: Array<{ command: string }>;
        configuration: { properties: Record<string, { default?: unknown }> };
        mcpServerDefinitionProviders: Array<{ id: string; label: string }>;
      };
    };
    expect(frag.activationEvents).toContain('onCommand:axis.mcp.showConfig');
    expect(frag.contributes.commands.map((c) => c.command)).toEqual([
      provider.MCP_COMMANDS.showConfig,
    ]);
    expect(frag.contributes.mcpServerDefinitionProviders[0]?.id).toBe(
      provider.MCP_PROVIDER_ID,
    );
    const props = frag.contributes.configuration.properties;
    expect(props['axis.mcp.stdio']?.default).toBe(true);
    expect(props['axis.mcp.command']?.default).toBe('');
    expect(props['axis.mcp.allowNpx']?.default).toBe(false);
  });
});

describe('buildMcpStdioArgs / env', () => {
  test('uses worker base URL and never --key', () => {
    const args = provider.buildMcpStdioArgs(
      { command: 'axis', argsPrefix: [] },
      'https://worker.axis.hoox.sh/',
    );
    expect(args).toEqual(['mcp', '--url', 'https://worker.axis.hoox.sh']);
    expect(provider.stdioArgsContainKeyFlag(args)).toBe(false);

    const npxArgs = provider.buildMcpStdioArgs(
      { command: 'npx', argsPrefix: ['-y', '@hoox-sh/axis-cli'] },
      'https://worker.axis.hoox.sh',
    );
    expect(npxArgs[0]).toBe('-y');
    expect(npxArgs).toContain('mcp');
    expect(npxArgs.join(' ')).not.toContain('--key');
  });

  test('env carries AXIS_API_KEY only when key present', () => {
    expect(provider.buildMcpStdioEnv(KEY)).toEqual({ AXIS_API_KEY: KEY });
    expect(provider.buildMcpStdioEnv(null)).toEqual({});
    expect(provider.buildMcpStdioEnv('')).toEqual({});
    expect(provider.buildMcpStdioEnv('  ')).toEqual({});
  });

  test('stdioArgsContainKeyFlag detects --key forms', () => {
    expect(provider.stdioArgsContainKeyFlag(['mcp', '--key', KEY])).toBe(true);
    expect(provider.stdioArgsContainKeyFlag(['mcp', `--key=${KEY}`])).toBe(true);
    expect(provider.stdioArgsContainKeyFlag(['mcp', '-k', KEY])).toBe(true);
    expect(provider.stdioArgsContainKeyFlag(['mcp', '--url', 'x'])).toBe(false);
  });
});

describe('provideAxisMcpServerDefinitions soft-fail', () => {
  test('returns empty defs + one-shot warning with showConfig path', async () => {
    const uiChoices: string[] = [];
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ allowNpx: false }),
      getWorkerKey: async () => KEY,
      which: async () => null,
      ui: {
        showWarningMessage(message, ...items) {
          warnings.push({ message, items });
          return Promise.resolve(provider.MCP_SOFT_FAIL_ACTION);
        },
        executeCommand(command) {
          uiChoices.push(command);
          return Promise.resolve(undefined);
        },
      },
      createStdioDefinition: (label, command, args, env) =>
        ({ label, command, args, env }) as never,
    });
    expect(defs).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe(provider.MCP_SOFT_FAIL_MESSAGE);
    expect(warnings[0]?.items).toContain(provider.MCP_SOFT_FAIL_ACTION);

    // Flush microtask from .then(choice → executeCommand)
    await Promise.resolve();
    await Promise.resolve();
    expect(uiChoices).toContain(provider.MCP_COMMANDS.showConfig);

    // Second provide does not warn again (one-shot).
    const again = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ allowNpx: false }),
      getWorkerKey: async () => undefined,
      which: async () => null,
      ui: {
        showWarningMessage(message, ...items) {
          warnings.push({ message, items });
          return Promise.resolve(undefined);
        },
        executeCommand: async () => undefined,
      },
    });
    expect(again).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  test('stdio disabled → empty without warning', async () => {
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ stdio: false }),
      getWorkerKey: async () => KEY,
      which: async () => null,
      ui: {
        showWarningMessage(message, ...items) {
          warnings.push({ message, items });
          return Promise.resolve(undefined);
        },
        executeCommand: async () => undefined,
      },
    });
    expect(defs).toEqual([]);
    expect(warnings).toHaveLength(0);
  });
});

describe('provideAxisMcpServerDefinitions success branches', () => {
  test('PATH axis → definition with env key, no --key argv', async () => {
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({}),
      getWorkerKey: async () => KEY,
      which: async () => '/usr/bin/axis',
      createStdioDefinition: (label, command, args, env) =>
        ({ label, command, args, env }) as never,
    });
    expect(defs).toHaveLength(1);
    const def = defs[0] as {
      label: string;
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    expect(def.label).toBe(provider.MCP_STDIO_LABEL);
    expect(def.command).toBe('axis');
    expect(def.args).toEqual(['mcp', '--url', 'https://worker.axis.hoox.sh']);
    expect(def.args.join(' ')).not.toContain(KEY);
    expect(def.args.join(' ')).not.toContain('--key');
    expect(def.env).toEqual({ AXIS_API_KEY: KEY });
  });

  test('mcp.command override', async () => {
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ command: '/custom/axis' }),
      getWorkerKey: async () => undefined,
      which: async () => '/usr/bin/axis',
      createStdioDefinition: (label, command, args, env) =>
        ({ label, command, args, env }) as never,
    });
    const def = defs[0] as { command: string; env: Record<string, string> };
    expect(def.command).toBe('/custom/axis');
    expect(def.env).toEqual({});
  });

  test('allowNpx → npx -y @hoox-sh/axis-cli', async () => {
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ allowNpx: true }),
      getWorkerKey: async () => KEY,
      which: async () => null,
      createStdioDefinition: (label, command, args, env) =>
        ({ label, command, args, env }) as never,
    });
    const def = defs[0] as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    expect(def.command).toBe('npx');
    expect(def.args.slice(0, 2)).toEqual(['-y', '@hoox-sh/axis-cli']);
    expect(def.env.AXIS_API_KEY).toBe(KEY);
  });
});

describe('formatMcpConfigSnippet / showMcpConfigSnippet', () => {
  test('snippet has stdio env key placeholder and no real secret', () => {
    const text = provider.formatMcpConfigSnippet('https://worker.axis.hoox.sh/');
    expect(text).toContain('AXIS_API_KEY');
    expect(text).toContain('https://worker.axis.hoox.sh/mcp');
    expect(text).toContain('"command": "axis"');
    expect(text).not.toContain(KEY);
    // Snippet args must not list a --key flag (comment may mention the rule).
    expect(text).toContain('"args": [\n        "mcp",\n        "--url",');
    expect(text).not.toMatch(/"args"\s*:\s*\[[^\]]*"--key"/s);
  });

  test('showMcpConfigSnippet opens untitled jsonc doc', async () => {
    const text = await provider.showMcpConfigSnippet(
      'https://worker.axis.hoox.sh',
    );
    expect(openedDocs).toHaveLength(1);
    expect(openedDocs[0]?.language).toBe('jsonc');
    expect(openedDocs[0]?.content).toBe(text);
  });
});

describe('registerMcpProvider', () => {
  test('registers showConfig command + mcp provider id', () => {
    const subscriptions: Array<{ dispose(): void }> = [];
    const secrets = new Map<string, string>();
    provider.registerMcpProvider({
      secrets: {
        get: async (k: string) => secrets.get(k),
      },
      subscriptions,
    } as never);

    expect(registeredCommands.some((c) => c.command === provider.MCP_COMMANDS.showConfig)).toBe(
      true,
    );
    expect(registeredProviders.some((p) => p.id === provider.MCP_PROVIDER_ID)).toBe(
      true,
    );
    expect(subscriptions.length).toBeGreaterThanOrEqual(2);
  });

  test('wired provide uses workspace config, secrets, and default stdio definition', async () => {
    // Override command so PATH `axis` cannot shadow the fixture.
    workspaceBag['mcp.command'] = '/opt/axis-from-test';
    workspaceBag['worker.url'] = '';
    workerSectionUrl = 'https://worker.axis.hoox.sh/';
    const secrets = new Map<string, string>([
      ['axis.secret.cloud.apiKey', KEY],
    ]);
    provider.registerMcpProvider({
      secrets: {
        get: async (k: string) => secrets.get(k),
      },
      subscriptions: [],
    } as never);

    const entry = registeredProviders.find((p) => p.id === provider.MCP_PROVIDER_ID);
    expect(entry).toBeDefined();
    if (!entry) return;
    const defs = await entry.provider.provideMcpServerDefinitions();
    expect(defs).toHaveLength(1);
    const def = defs[0] as {
      label: string;
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    expect(def.command).toBe('/opt/axis-from-test');
    expect(def.env.AXIS_API_KEY).toBe(KEY);
    expect(def.args).toContain('https://worker.axis.hoox.sh');
    const resolved = await entry.provider.resolveMcpServerDefinition(def);
    expect(resolved).toBe(def);

    const show = registeredCommands.find((c) => c.command === provider.MCP_COMMANDS.showConfig);
    expect(show).toBeDefined();
    if (!show) return;
    await show.cb();
    expect(openedDocs.length).toBeGreaterThanOrEqual(1);
  });

  test('wired provide: secrets throw → definition without AXIS_API_KEY; stdio off → empty', async () => {
    workspaceBag['mcp.command'] = '/opt/axis-from-test';
    provider.registerMcpProvider({
      secrets: {
        get: async () => {
          throw new Error('vault');
        },
      },
      subscriptions: [],
    } as never);
    const entry = registeredProviders.find((p) => p.id === provider.MCP_PROVIDER_ID);
    expect(entry).toBeDefined();
    if (!entry) return;
    const defs = await entry.provider.provideMcpServerDefinitions();
    expect(defs).toHaveLength(1);
    const def = defs[0] as { env: Record<string, string> };
    expect(def.env.AXIS_API_KEY).toBeUndefined();

    workspaceBag['mcp.stdio'] = false;
    const empty = await entry.provider.provideMcpServerDefinitions();
    expect(empty).toEqual([]);
  });

  test('showMcpConfigSnippet without url reads workspace worker.url', async () => {
    workspaceBag['worker.url'] = 'https://worker.axis.hoox.sh';
    const text = await provider.showMcpConfigSnippet();
    expect(text).toContain('https://worker.axis.hoox.sh');
    expect(openedDocs).toHaveLength(1);
  });

  test('defaultCreateStdioDefinition path when factory omitted', async () => {
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ allowNpx: true }),
      getWorkerKey: async () => KEY,
      which: async () => null,
      // omit createStdioDefinition → real McpStdioServerDefinition mock
    });
    expect(defs).toHaveLength(1);
    const def = defs[0] as { command: string; args: string[]; env: Record<string, string> };
    expect(def.command).toBe('npx');
    expect(def.env.AXIS_API_KEY).toBe(KEY);
  });

  test('default soft-fail UI (window.showWarningMessage) when ui omitted', async () => {
    warningChoice = provider.MCP_SOFT_FAIL_ACTION;
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ allowNpx: false }),
      getWorkerKey: async () => KEY,
      which: async () => null,
      // omit ui → defaultSoftFailUi (+ executeCommand on action)
    });
    expect(defs).toEqual([]);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]?.message).toBe(provider.MCP_SOFT_FAIL_MESSAGE);
    await Bun.sleep(0);
    expect(executed).toContain(provider.MCP_COMMANDS.showConfig);
  });

  test('refuses definition when stdio args contain --key (defense)', async () => {
    const defs = await provider.provideAxisMcpServerDefinitions({
      cfg: reader({ allowNpx: true }),
      getWorkerKey: async () => KEY,
      which: async () => null,
      buildStdioArgs: () => ['mcp', '--key', KEY],
    });
    expect(defs).toEqual([]);
  });

  test('readAxisConfig falls back to DEFAULT when worker urls empty', async () => {
    workspaceBag['worker.url'] = '   ';
    workerSectionUrl = '  ';
    const text = await provider.showMcpConfigSnippet();
    expect(text).toContain('https://worker.axis.hoox.sh');
  });
});
