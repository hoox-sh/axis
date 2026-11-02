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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type G = {
  __axisAllowPyodide?: unknown;
  __axisLiveEnabled?: unknown;
  __axisAllowUrlInstall?: unknown;
  __axisEngineCfgThrow?: boolean;
  __axisCfgThrow?: string | true;
  __axisCfgGetThrow?: string;
  __axisRegisterWvThrow?: boolean;
  __axisThemeKind?: number;
  __axisThemeThrow?: boolean;
  __axisWebviewRegistrations?: Array<{
    id: string;
    options?: { webviewOptions?: { retainContextWhenHidden?: boolean } };
  }>;
};

function g(): G {
  return globalThis as G;
}

class EventEmitter {
  event = () => ({ dispose() {} });
  fire(_v?: unknown) {}
}

class TreeItem {
  label: string;
  collapsibleState: number;
  constructor(label: string, collapsibleState = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
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
    return new Uri(join(root, ...parts));
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

const vscodeApi = {
  ColorThemeKind,
  Uri,
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  window: {
    get activeColorTheme() {
      if (g().__axisThemeThrow) throw new Error('theme');
      return { kind: g().__axisThemeKind ?? ColorThemeKind.Dark };
    },
    showWarningMessage: (_message: string) => undefined,
    createTreeView: (id: string, options?: { showCollapseAll?: boolean }) => {
      const bucket = (globalThis as { __axisPluginKindTreeViews?: Array<{ id: string }> })
        .__axisPluginKindTreeViews;
      if (bucket) bucket.push({ id, showCollapseAll: options?.showCollapseAll });
      return { dispose() {} };
    },
    registerWebviewViewProvider: (
      id: string,
      _provider: unknown,
      options?: { webviewOptions?: { retainContextWhenHidden?: boolean } },
    ) => {
      if (g().__axisRegisterWvThrow) throw new Error('register');
      const bucket = g().__axisWebviewRegistrations;
      if (bucket) bucket.push({ id, options });
      return { dispose() {} };
    },
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      show() {},
      dispose() {},
    }),
  },
  workspace: {
    getConfiguration(section?: string) {
      if (g().__axisEngineCfgThrow === true) throw new Error('cfg');
      if (g().__axisCfgThrow === true || g().__axisCfgThrow === section) {
        throw new Error('cfg');
      }
      return {
        get(key: string, def?: unknown) {
          if (g().__axisCfgGetThrow === `${section}.${key}`) {
            throw new Error('get');
          }
          if (section === 'axis.engine' && key === 'allowPyodide') {
            return g().__axisAllowPyodide;
          }
          if (section === 'axis.live' && key === 'enabled') {
            return g().__axisLiveEnabled;
          }
          if (section === 'axis.plugins' && key === 'allowUrlInstall') {
            return g().__axisAllowUrlInstall;
          }
          return def;
        },
      };
    },
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
  },
  lm: {
    registerMcpServerDefinitionProvider: () => ({ dispose() {} }),
    registerTool: () => ({ dispose() {} }),
  },
};

mock.module('vscode', () => ({
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  get ColorThemeKind() {
    return vscodeApi.ColorThemeKind;
  },
  get Uri() {
    return vscodeApi.Uri;
  },
  get EventEmitter() {
    return vscodeApi.EventEmitter;
  },
  get TreeItem() {
    return vscodeApi.TreeItem;
  },
  get TreeItemCollapsibleState() {
    return vscodeApi.TreeItemCollapsibleState;
  },
  get StatusBarAlignment() {
    return vscodeApi.StatusBarAlignment;
  },
  get window() {
    return vscodeApi.window;
  },
  get workspace() {
    return vscodeApi.workspace;
  },
  get commands() {
    return vscodeApi.commands;
  },
  get lm() {
    return vscodeApi.lm;
  },
}));

type PanelMod = typeof import('./plugins-panel');
type RegistryMod = typeof import('./registry');
type ActiveMod = typeof import('./active');

let panel: PanelMod;
let registryMod: RegistryMod;
let activeMod: ActiveMod;

beforeAll(async () => {
  panel = await import('./plugins-panel');
  registryMod = await import('./registry');
  activeMod = await import('./active');
});

function makeAssets(withCss: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'axis-plugins-wv-'));
  const dir = join(root, 'dist', 'webview', 'plugins');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'main.js'), '/* plugins */');
  if (withCss) writeFileSync(join(dir, 'main.css'), '/* css */');
  return root;
}

function makeWebview(opts?: {
  asWebviewUri?: (u: { fsPath: string }) => { toString(): string };
  postMessage?: (msg: unknown) => Thenable<boolean> | boolean;
  htmlThrow?: boolean;
  htmlThrowAlways?: boolean;
}) {
  const order: string[] = [];
  let html = '';
  let htmlSets = 0;
  let messageHandler: ((raw: unknown) => unknown) | undefined;
  const posted: unknown[] = [];
  const webview = {
    cspSource: 'https://csp.test',
    options: {} as {
      enableScripts?: boolean;
      localResourceRoots?: Array<{ fsPath: string }>;
    },
    asWebviewUri:
      opts?.asWebviewUri ??
      ((u: { fsPath: string }) => ({
        toString: () => `https://webview.test/${u.fsPath.split('/').pop()}`,
      })),
    postMessage:
      opts?.postMessage ??
      ((msg: unknown) => {
        posted.push(msg);
        return true;
      }),
    onDidReceiveMessage(cb: (raw: unknown) => unknown) {
      order.push('onDidReceiveMessage');
      messageHandler = cb;
      return { dispose() {} };
    },
    get html() {
      return html;
    },
    set html(value: string) {
      htmlSets += 1;
      order.push('html');
      if (opts?.htmlThrowAlways || (opts?.htmlThrow && htmlSets === 1)) {
        throw new Error('html');
      }
      html = value;
    },
  };
  let disposeHandler: (() => void) | undefined;
  const view = {
    webview,
    show(preserveFocus?: boolean) {
      (view as { shown?: boolean }).shown = preserveFocus === true;
    },
    onDidDispose(cb: () => void) {
      disposeHandler = cb;
      return { dispose() {} };
    },
    shown: false,
  };
  return { webview, view, order, posted, getHandler: () => messageHandler, dispose: () => disposeHandler?.() };
}

describe('PluginsWebviewViewProvider', () => {
  test('constants and register retainContextWhenHidden', () => {
    expect(panel.PLUGINS_WEBVIEW_VIEW_ID).toBe('axis.plugins');
    g().__axisWebviewRegistrations = [];
    g().__axisRegisterWvThrow = false;
    const mem = activeMod.createMemoryWorkspaceState();
    const reg = new registryMod.HostPluginRegistry();
    const provider = panel.registerPluginsWebviewView(
      { subscriptions: [] as Array<{ dispose(): void }>, extensionUri: Uri.file('/tmp') } as never,
      reg,
      mem,
    );
    expect(provider).toBeInstanceOf(panel.PluginsWebviewViewProvider);
    const rec = g().__axisWebviewRegistrations?.[0];
    expect(rec?.id).toBe('axis.plugins');
    expect(rec?.options?.webviewOptions?.retainContextWhenHidden).toBe(true);

    g().__axisRegisterWvThrow = true;
    expect(() =>
      panel.registerPluginsWebviewView(
        { subscriptions: [], extensionUri: Uri.file('/tmp') } as never,
        reg,
        mem,
      ),
    ).not.toThrow();
    g().__axisRegisterWvThrow = false;
  });

  test('resolve sets options, handler before html, theme classes, css present/absent', async () => {
    const mem = activeMod.createMemoryWorkspaceState();
    const reg = registryMod.ensureBuiltinsRegistered(new registryMod.HostPluginRegistry());

    g().__axisThemeKind = ColorThemeKind.Light;
    const withCss = makeAssets(true);
    const provider = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      reg,
      mem,
    );
    const a = makeWebview();
    expect(() => provider.resolveWebviewView(a.view as never)).not.toThrow();
    expect(a.order[0]).toBe('onDidReceiveMessage');
    expect(a.order[1]).toBe('html');
    expect(a.webview.options.enableScripts).toBe(true);
    expect(a.webview.options.localResourceRoots?.[0]?.fsPath).toContain(
      join('dist', 'webview', 'plugins'),
    );
    expect(a.webview.html).toContain('id="plugins-root"');
    expect(a.webview.html).toContain('class="vscode-light"');
    expect(a.webview.html).toContain('https://webview.test/main.css');

    g().__axisThemeKind = ColorThemeKind.HighContrast;
    const noCss = makeAssets(false);
    const provider2 = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(noCss) } as never,
      reg,
      mem,
    );
    const b = makeWebview();
    provider2.resolveWebviewView(b.view as never);
    expect(b.webview.html).toContain('class="vscode-high-contrast"');
    expect(b.webview.html).toContain('main.css');

    g().__axisThemeKind = ColorThemeKind.HighContrastLight;
    const provider3 = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      reg,
      mem,
    );
    const c = makeWebview();
    provider3.resolveWebviewView(c.view as never);
    expect(c.webview.html).toContain('class="vscode-high-contrast-light"');

    g().__axisThemeKind = ColorThemeKind.Dark;
    const d = makeWebview();
    provider3.resolveWebviewView(d.view as never);
    expect(d.webview.html).toContain('class="vscode-dark"');

    g().__axisThemeThrow = true;
    const e = makeWebview();
    provider3.resolveWebviewView(e.view as never);
    expect(e.webview.html).toContain('class="vscode-dark"');
    g().__axisThemeThrow = false;
  });

  test('missing assets and html setter failures never throw', () => {
    const mem = activeMod.createMemoryWorkspaceState();
    const reg = new registryMod.HostPluginRegistry();
    const provider = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file('/no-such-axis-plugins-assets') } as never,
      reg,
      mem,
    );
    const a = makeWebview();
    expect(() => provider.resolveWebviewView(a.view as never)).not.toThrow();
    expect(a.webview.html).toContain('assets missing');

    const withCss = makeAssets(true);
    const okProvider = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      reg,
      mem,
    );
    const boom = makeWebview({ htmlThrow: true });
    expect(() => okProvider.resolveWebviewView(boom.view as never)).not.toThrow();
    expect(boom.webview.html.length).toBeGreaterThan(0);

    const always = makeWebview({ htmlThrowAlways: true });
    expect(() => provider.resolveWebviewView(always.view as never)).not.toThrow();

    const throwFs = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file('/throw-fs') } as never,
      reg,
      mem,
    );
    const fsView = makeWebview();
    expect(() => throwFs.resolveWebviewView(fsView.view as never)).not.toThrow();
    expect(fsView.webview.html).toContain('unknown');

    const asThrow = makeWebview({
      asWebviewUri: () => {
        throw 'nope';
      },
    });
    const okProv = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      reg,
      mem,
    );
    expect(() => okProv.resolveWebviewView(asThrow.view as never)).not.toThrow();
    expect(asThrow.webview.html).toContain('nope');
  });

  test('ready posts init with extras; activate posts state and refresh', async () => {
    const mem = activeMod.createMemoryWorkspaceState();
    const reg = registryMod.ensureBuiltinsRegistered(new registryMod.HostPluginRegistry());
    g().__axisAllowPyodide = false;
    g().__axisLiveEnabled = true;
    g().__axisAllowUrlInstall = true;
    let refreshes = 0;
    const withCss = makeAssets(true);
    const provider = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      reg,
      mem,
      () => {
        refreshes += 1;
      },
    );
    const w = makeWebview();
    provider.resolveWebviewView(w.view as never);
    const handler = w.getHandler();
    expect(handler).toBeTypeOf('function');
    await handler?.({ type: 'plugins.ready' });
    const init = w.posted[0] as {
      type: string;
      plugins: Array<{ id: string; kind: string; extra?: Record<string, unknown> }>;
      flags: { allowPyodide: boolean; liveEnabled: boolean; allowUrlInstall: boolean };
    };
    expect(init.type).toBe('plugins.init');
    expect(init.flags).toEqual({
      allowPyodide: false,
      liveEnabled: true,
      allowUrlInstall: true,
    });
    const source = init.plugins.find((p) => p.kind === 'source');
    const stream = init.plugins.find((p) => p.kind === 'stream');
    const pyodide = init.plugins.find((p) => p.id === 'pyodide');
    const storage = init.plugins.find((p) => p.kind === 'storage');
    const dataset = init.plugins.find((p) => p.kind === 'dataset');
    const component = init.plugins.find((p) => p.kind === 'component');
    expect(source?.extra?.role).toBe('Historical OHLCV');
    expect(stream?.extra?.role).toBe('Live bars');
    expect(stream?.extra?.liveEnabled).toBe(true);
    expect(pyodide?.extra?.role).toBe('Pine runtime');
    expect(pyodide?.extra?.flagOff).toBe(true);
    expect(storage?.extra?.role).toBe('Script library backend');
    expect(dataset?.extra?.role).toBe('On-chain dataset');
    expect(component?.extra?.role).toBe('Host contribution (no Solid mount)');

    await handler?.({ type: 'plugins.activate', kind: 'source', id: 'okx-rest' });
    expect(refreshes).toBe(1);
    expect(activeMod.isActivePlugin(mem, 'source', 'okx-rest')).toBe(true);
    const state = w.posted[1] as { type: string; active: { source?: string } };
    expect(state.type).toBe('plugins.state');
    expect(state.active.source).toBe('okx-rest');

    await handler?.({ type: 'nope' });
    await handler?.([]);
    await handler?.({ type: 'plugins.activate', kind: 'nope', id: 'x' });
    expect(w.posted.length).toBe(2);

    const boomPost = makeWebview({
      postMessage: () => {
        throw new Error('post');
      },
    });
    provider.resolveWebviewView(boomPost.view as never);
    await expect(boomPost.getHandler()?.({ type: 'plugins.ready' })).resolves.toBeUndefined();
    await expect(
      boomPost.getHandler()?.({ type: 'plugins.activate', kind: 'source', id: 'okx-rest' }),
    ).resolves.toBeUndefined();
    expect(() => provider.postState()).not.toThrow();
  });

  test('flags config throws, listAll throws, dispose, reveal, postState', async () => {
    const mem = activeMod.createMemoryWorkspaceState();
    const withCss = makeAssets(true);
    g().__axisCfgThrow = 'axis.engine';
    g().__axisLiveEnabled = false;
    g().__axisAllowUrlInstall = false;
    expect(panel.readPluginsFlags().allowPyodide).toBe(false);
    g().__axisCfgThrow = undefined;
    g().__axisCfgGetThrow = 'axis.live.enabled';
    expect(panel.readPluginsFlags().liveEnabled).toBe(false);
    g().__axisCfgGetThrow = undefined;

    const hostileReg = {
      listAll() {
        throw new Error('list');
      },
    };
    const provider = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      hostileReg as never,
      mem,
    );
    const w = makeWebview();
    provider.resolveWebviewView(w.view as never);
    await w.getHandler()?.({ type: 'plugins.ready' });
    const init = w.posted[0] as { type: string; plugins: unknown[] };
    expect(init.type).toBe('plugins.init');
    expect(init.plugins).toEqual([]);

    expect(() => provider.reveal()).not.toThrow();
    expect(w.view.shown).toBe(true);
    w.view.show = () => {
      throw new Error('show');
    };
    expect(() => provider.reveal()).not.toThrow();

    provider.postState();
    expect((w.posted[1] as { type: string }).type).toBe('plugins.state');

    const other = makeWebview();
    provider.resolveWebviewView(other.view as never);
    w.dispose();
    provider.postState();
    expect((other.posted[0] as { type?: string } | undefined)?.type).toBe('plugins.state');
    other.dispose();
    expect(() => provider.postState()).not.toThrow();
    expect(() => provider.reveal()).not.toThrow();

    const cssThrow = makeWebview({
      asWebviewUri: (u) => {
        if (String(u.fsPath).endsWith('main.css')) {
          throw new Error('css');
        }
        return { toString: () => `https://webview.test/${u.fsPath.split('/').pop()}` };
      },
    });
    const cssProv = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      new registryMod.HostPluginRegistry() as never,
      mem,
    );
    expect(() => cssProv.resolveWebviewView(cssThrow.view as never)).not.toThrow();
    expect(cssThrow.webview.html).toContain('main.css');
  });

  test('css existsSync throw uses script-derived href; resolve outer catch', () => {
    const mem = activeMod.createMemoryWorkspaceState();
    const withCss = makeAssets(true);
    const styleBoomUri = {
      fsPath: join(withCss, 'dist', 'webview', 'plugins', 'main.css'),
    };
    const origJoin = Uri.joinPath;
    Uri.joinPath = ((base: { fsPath?: string }, ...parts: string[]) => {
      if (parts[parts.length - 1] === 'main.css' && base.fsPath === withCss) {
        return {
          get fsPath(): string {
            throw new Error('css fs');
          },
        };
      }
      return origJoin(base, ...parts);
    }) as typeof Uri.joinPath;
    try {
      const provider = new panel.PluginsWebviewViewProvider(
        { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
        new registryMod.HostPluginRegistry() as never,
        mem,
      );
      const w = makeWebview();
      expect(() => provider.resolveWebviewView(w.view as never)).not.toThrow();
      expect(w.webview.html).toContain('main.css');
    } finally {
      Uri.joinPath = origJoin;
    }
    void styleBoomUri;

    const provider = new panel.PluginsWebviewViewProvider(
      { subscriptions: [], extensionUri: Uri.file(withCss) } as never,
      new registryMod.HostPluginRegistry() as never,
      mem,
    );
    expect(() =>
      provider.resolveWebviewView({
        get webview(): never {
          throw new Error('view');
        },
      } as never),
    ).not.toThrow();
  });
});
