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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type G = {
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

class ThemeIcon {
  id: string;
  constructor(id: string) {
    this.id = id;
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
    if (root === '/throw-fs' || (root.includes('css-throw') && parts.includes('main.css'))) {
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

class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

class Range {
  constructor(
    public start: Position,
    public end: Position,
  ) {}
}

class Selection extends Range {
  constructor(anchor: Position, active: Position) {
    super(anchor, active);
  }
}

const TextEditorRevealType = { InCenter: 2 };

const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
};

type GExtra = G & {
  __axisActiveEditor?: {
    document: { languageId: string; lineCount: number };
    selection?: unknown;
    revealRange?: (range: unknown, type: unknown) => void;
  } | null;
  __axisClipboard?: string[];
  __axisInfoMessages?: string[];
  __axisClipboardThrow?: boolean;
  __axisEditorThrow?: boolean;
};

function gx(): GExtra {
  return globalThis as GExtra;
}

const vscodeApi = {
  ColorThemeKind,
  Uri,
  Position,
  Range,
  Selection,
  TextEditorRevealType,
  EventEmitter,
  TreeItem,
  ThemeIcon,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  env: {
    clipboard: {
      async writeText(text: string) {
        if (gx().__axisClipboardThrow) throw new Error('clipboard');
        const bucket = gx().__axisClipboard;
        if (bucket) bucket.push(text);
      },
    },
  },
  window: {
    get activeColorTheme() {
      if (g().__axisThemeThrow) throw new Error('theme');
      return { kind: g().__axisThemeKind ?? ColorThemeKind.Dark };
    },
    get activeTextEditor() {
      if (gx().__axisEditorThrow) throw new Error('editor');
      return gx().__axisActiveEditor ?? undefined;
    },
    showWarningMessage: (_message: string) => undefined,
    showInformationMessage: (message: string) => {
      const bucket = gx().__axisInfoMessages;
      if (bucket) bucket.push(message);
      return undefined;
    },
    createTreeView: () => ({ dispose() {} }),
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
    getConfiguration() {
      return { get(_key: string, def?: unknown) { return def; } };
    },
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
  },
  lm: {
    registerMcpServerDefinitionProvider: () => ({ dispose() {} }),
    registerTool: () => ({ dispose() {} }),
  },
};

mock.module('vscode', () => ({
  QuickPickItemKind: { Separator: -1, Default: 0 },
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
  get Position() {
    return vscodeApi.Position;
  },
  get Range() {
    return vscodeApi.Range;
  },
  get Selection() {
    return vscodeApi.Selection;
  },
  get TextEditorRevealType() {
    return vscodeApi.TextEditorRevealType;
  },
  get env() {
    return vscodeApi.env;
  },
  get EventEmitter() {
    return vscodeApi.EventEmitter;
  },
  get TreeItem() {
    return vscodeApi.TreeItem;
  },
  get ThemeIcon() {
    return vscodeApi.ThemeIcon;
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

type PanelMod = typeof import('./profiler-panel');
type RegisterMod = typeof import('./profiler');
type ResultsMod = typeof import('../run/results-store');
type ProfilerMod = typeof import('../run/profiler-store');

let panel: PanelMod;
let registerMod: RegisterMod;
let resultsMod: ResultsMod;
let profilerMod: ProfilerMod;

beforeAll(async () => {
  panel = await import('./profiler-panel');
  registerMod = await import('./profiler');
  resultsMod = await import('../run/results-store');
  profilerMod = await import('../run/profiler-store');
});

function makeAssets(withCss: boolean, prefix = 'axis-profiler-wv-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dir = join(root, 'dist', 'webview', 'profiler');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'main.js'), '/* profiler */');
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
  return {
    webview,
    view,
    order,
    posted,
    getHandler: () => messageHandler,
    dispose: () => disposeHandler?.(),
  };
}

function makeContext(root: string) {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    extensionUri: Uri.file(root),
  };
}

describe('ProfilerWebviewViewProvider', () => {
  test('constants, fragment, and register retainContextWhenHidden false', () => {
    expect(panel.PROFILER_VIEW_ID).toBe('axis.profiler');
    expect(registerMod.PROFILER_VIEW_ID).toBe('axis.profiler');
    const frag = JSON.parse(
      readFileSync(join(import.meta.dir, 'profiler-contributes.fragment.json'), 'utf8'),
    ) as {
      activationEvents: string[];
      contributes: { views: { 'axis-panel': Array<{ id: string; type: string; retainContextWhenHidden: boolean }> } };
    };
    expect(frag.activationEvents).toContain('onView:axis.profiler');
    expect(frag.contributes.views['axis-panel'][0]).toEqual({
      type: 'webview',
      id: 'axis.profiler',
      name: 'Profiler',
      retainContextWhenHidden: false,
    });

    g().__axisWebviewRegistrations = [];
    g().__axisRegisterWvThrow = false;
    const results = new resultsMod.ResultsFocusStore();
    const provider = registerMod.registerProfilerView(makeContext('/tmp') as never, results);
    expect(provider).toBeInstanceOf(panel.ProfilerWebviewViewProvider);
    const rec = g().__axisWebviewRegistrations?.[0];
    expect(rec?.id).toBe('axis.profiler');
    expect(rec?.options?.webviewOptions?.retainContextWhenHidden).toBe(false);

    g().__axisRegisterWvThrow = true;
    expect(() =>
      registerMod.registerProfilerView(makeContext('/tmp') as never, results),
    ).not.toThrow();
    g().__axisRegisterWvThrow = false;
  });

  test('resolve sets options, handler before html, theme classes, css present/absent', () => {
    const results = new resultsMod.ResultsFocusStore();

    g().__axisThemeKind = ColorThemeKind.Light;
    const withCss = makeAssets(true);
    const provider = new panel.ProfilerWebviewViewProvider(
      makeContext(withCss) as never,
      results,
    );
    const a = makeWebview();
    expect(() => provider.resolveWebviewView(a.view as never)).not.toThrow();
    expect(a.order[0]).toBe('onDidReceiveMessage');
    expect(a.order[1]).toBe('html');
    expect(a.webview.options.enableScripts).toBe(true);
    expect(a.webview.options.localResourceRoots?.[0]?.fsPath).toContain(
      join('dist', 'webview', 'profiler'),
    );
    expect(a.webview.html).toContain('id="profiler-root"');
    expect(a.webview.html).toContain('class="vscode-light"');
    expect(a.webview.html).toContain('https://webview.test/main.css');
    expect(a.webview.html).toContain("connect-src 'none'");

    g().__axisThemeKind = ColorThemeKind.HighContrast;
    const noCss = makeAssets(false);
    const provider2 = panel.createProfilerProvider(makeContext(noCss) as never, results);
    const b = makeWebview();
    provider2.resolveWebviewView(b.view as never);
    expect(b.webview.html).toContain('class="vscode-high-contrast"');
    expect(b.webview.html).toContain('main.css');

    g().__axisThemeKind = ColorThemeKind.HighContrastLight;
    const provider3 = new panel.ProfilerWebviewViewProvider(
      makeContext(withCss) as never,
      results,
    );
    const c = makeWebview();
    provider3.resolveWebviewView(c.view as never);
    expect(c.webview.html).toContain('class="vscode-high-contrast-light"');

    g().__axisThemeKind = ColorThemeKind.Dark;
    const d = makeWebview();
    provider3.resolveWebviewView(d.view as never);
    expect(d.webview.html).toContain('class="vscode-dark"');

    g().__axisThemeKind = 99;
    const f = makeWebview();
    provider3.resolveWebviewView(f.view as never);
    expect(f.webview.html).toContain('class="vscode-dark"');

    g().__axisThemeThrow = true;
    const e = makeWebview();
    provider3.resolveWebviewView(e.view as never);
    expect(e.webview.html).toContain('class="vscode-dark"');
    g().__axisThemeThrow = false;
    g().__axisThemeKind = ColorThemeKind.Dark;

    const cssThrowRoot = makeAssets(true, 'axis-profiler-css-throw-');
    const cssThrow = new panel.ProfilerWebviewViewProvider(
      makeContext(cssThrowRoot) as never,
      results,
    );
    const cssView = makeWebview();
    cssThrow.resolveWebviewView(cssView.view as never);
    expect(cssView.webview.html).toContain('id="profiler-root"');
    expect(cssView.webview.html).toContain('main.css');
  });

  test('missing assets and html setter failures never throw', () => {
    const results = new resultsMod.ResultsFocusStore();
    const provider = new panel.ProfilerWebviewViewProvider(
      makeContext('/no-such-axis-profiler-assets') as never,
      results,
    );
    const a = makeWebview();
    expect(() => provider.resolveWebviewView(a.view as never)).not.toThrow();
    expect(a.webview.html).toContain('assets missing');

    const withCss = makeAssets(true);
    const okProvider = new panel.ProfilerWebviewViewProvider(
      makeContext(withCss) as never,
      results,
    );
    const boom = makeWebview({ htmlThrow: true });
    expect(() => okProvider.resolveWebviewView(boom.view as never)).not.toThrow();
    expect(boom.webview.html.length).toBeGreaterThan(0);

    const always = makeWebview({ htmlThrowAlways: true });
    expect(() => provider.resolveWebviewView(always.view as never)).not.toThrow();

    const throwFs = new panel.ProfilerWebviewViewProvider(
      makeContext('/throw-fs') as never,
      results,
    );
    const fsView = makeWebview();
    expect(() => throwFs.resolveWebviewView(fsView.view as never)).not.toThrow();
    expect(fsView.webview.html).toContain('unknown');

    const asThrow = makeWebview({
      asWebviewUri: () => {
        throw 'nope <&>';
      },
    });
    const okProv = new panel.ProfilerWebviewViewProvider(
      makeContext(withCss) as never,
      results,
    );
    expect(() => okProv.resolveWebviewView(asThrow.view as never)).not.toThrow();
    expect(asThrow.webview.html).toContain('nope');
    expect(asThrow.webview.html).not.toContain('<&>');
  });

  test('ready posts profiler.set; results publish fans out; dispose/reveal', () => {
    const results = new resultsMod.ResultsFocusStore();
    results.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      plots: [1, 2],
      series: { close: 1 },
      meta: { ms: 25 },
    });
    const withCss = makeAssets(true);
    const profiler = new profilerMod.ProfilerStore();
    const provider = new panel.ProfilerWebviewViewProvider(
      makeContext(withCss) as never,
      results,
      profiler,
    );
    expect(profiler.getSnapshot()?.plotCount).toBe(2);

    const w = makeWebview();
    provider.resolveWebviewView(w.view as never);
    const handler = w.getHandler();
    expect(handler).toBeTypeOf('function');
    handler?.({ type: 'profiler.ready' });
    const first = w.posted[0] as { type: string; payload: { runId: string; ms: number } };
    expect(first.type).toBe('profiler.set');
    expect(first.payload.ms).toBe(25);

    handler?.({ type: 'results.ready' });
    expect(w.posted.length).toBe(2);

    handler?.({ type: 'nope' });
    handler?.([]);
    handler?.('x');
    handler?.(null);
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('type');
        },
      },
    );
    expect(() => handler?.(hostile)).not.toThrow();
    expect(w.posted.length).toBe(2);

    results.publish({
      status: 'error',
      focus: true,
      seriesKey: 'k2',
      engineId: 'server',
      error: 'fail',
      meta: { ms: 9 },
    });
    const last = w.posted.at(-1) as { type: string; payload: { status: string; error?: string } };
    expect(last.type).toBe('profiler.set');
    expect(last.payload.status).toBe('error');
    expect(last.payload.error).toBe('fail');

    expect(() => provider.reveal()).not.toThrow();
    expect(w.view.shown).toBe(true);
    w.view.show = () => {
      throw new Error('show');
    };
    expect(() => provider.reveal()).not.toThrow();

    w.dispose();
    results.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k3',
      engineId: 'server',
      meta: { ms: 1 },
    });
    const afterDispose = w.posted.length;
    expect(() => provider.dispose()).not.toThrow();

    const boomPost = makeWebview({
      postMessage: () => {
        throw new Error('post');
      },
    });
    provider.resolveWebviewView(boomPost.view as never);
    expect(() => boomPost.getHandler()?.({ type: 'profiler.ready' })).not.toThrow();
    expect(() =>
      results.publish({
        status: 'success',
        focus: true,
        seriesKey: 'k4',
        engineId: 'server',
        meta: { ms: 2 },
      }),
    ).not.toThrow();
    expect(w.posted.length).toBe(afterDispose);
  });

  test('resolve null view, throwing unsub/detach, css fsPath throw', () => {
    const results = {
      subscribe() {
        return () => {
          throw new Error('detach');
        };
      },
      getLastRun() {
        return null;
      },
    };
    const profiler = new profilerMod.ProfilerStore();
    const orig = profiler.subscribe.bind(profiler);
    profiler.subscribe = ((listener: (snap: unknown) => void) => {
      orig(listener as never);
      return () => {
        throw new Error('unsub');
      };
    }) as typeof profiler.subscribe;

    const withCss = makeAssets(true);
    const provider = new panel.ProfilerWebviewViewProvider(
      makeContext(withCss) as never,
      results as never,
      profiler,
    );
    expect(() => provider.resolveWebviewView(null as never)).not.toThrow();
    const w = makeWebview();
    provider.resolveWebviewView(w.view as never);
    expect(() => provider.dispose()).not.toThrow();
  });

  test('profiler.reveal jumps to Pine line; profiler.copy writes clipboard', async () => {
    const results = new resultsMod.ResultsFocusStore();
    const withCss = makeAssets(true);
    const provider = new panel.ProfilerWebviewViewProvider(
      makeContext(withCss) as never,
      results,
    );
    const w = makeWebview();
    provider.resolveWebviewView(w.view as never);
    const handler = w.getHandler();

    gx().__axisInfoMessages = [];
    gx().__axisActiveEditor = null;
    handler?.({ type: 'profiler.reveal', line: 4 });
    expect(gx().__axisInfoMessages?.[0]).toContain('No active Pine');

    const revealed: unknown[] = [];
    gx().__axisActiveEditor = {
      document: { languageId: 'pinescript', lineCount: 20 },
      selection: undefined,
      revealRange(range, type) {
        revealed.push({ range, type });
      },
    };
    handler?.({ type: 'profiler.reveal', line: 7 });
    expect(gx().__axisActiveEditor?.selection).toBeTruthy();
    expect(revealed).toHaveLength(1);

    gx().__axisActiveEditor = {
      document: { languageId: 'pine', lineCount: 3 },
      revealRange(range) {
        revealed.push(range);
      },
    };
    handler?.({ type: 'profiler.reveal', payload: { line: '99' } });
    expect(revealed.length).toBeGreaterThan(1);

    handler?.({ type: 'profiler.reveal', line: 0 });
    handler?.({ type: 'profiler.reveal', line: 1.5 });
    handler?.({ type: 'profiler.reveal' });

    gx().__axisClipboard = [];
    handler?.({ type: 'profiler.copy', runId: ' run-42 ' });
    await Promise.resolve();
    expect(gx().__axisClipboard).toEqual(['run-42']);

    handler?.({ type: 'profiler.copy', payload: { runId: 'from-payload' } });
    await Promise.resolve();
    expect(gx().__axisClipboard?.at(-1)).toBe('from-payload');

    handler?.({ type: 'profiler.copy', runId: '   ' });
    handler?.({ type: 'profiler.copy', runId: 9 });
    gx().__axisClipboardThrow = true;
    expect(() => handler?.({ type: 'profiler.copy', runId: 'x' })).not.toThrow();
    gx().__axisClipboardThrow = false;

    gx().__axisEditorThrow = true;
    gx().__axisInfoMessages = [];
    expect(() => handler?.({ type: 'profiler.reveal', line: 2 })).not.toThrow();
    expect(gx().__axisInfoMessages?.[0]).toContain('No active Pine');
    gx().__axisEditorThrow = false;
    gx().__axisActiveEditor = undefined;
  });
});
