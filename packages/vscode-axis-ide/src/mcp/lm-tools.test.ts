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
import { ResultsFocusStore } from '../run/results-store';

const registeredTools: Array<{ name: string; tool: unknown }> = [];

mock.module('vscode', () => {
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
      registerCommand() {
        return { dispose() {} };
      },
      executeCommand: async () => undefined,
    },
    window: {
      activeColorTheme: { kind: ColorThemeKind.Dark },
      showWarningMessage: async () => undefined,
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
      openTextDocument: async () => ({ getText: () => '' }),
    },
    lm: {
      registerMcpServerDefinitionProvider() {
        return { dispose() {} };
      },
      registerTool(name: string, tool: unknown) {
        registeredTools.push({ name, tool });
        return { dispose() {} };
      },
    },
  };
});

type LmMod = typeof import('./lm-tools');
let lmTools: LmMod;

beforeAll(async () => {
  lmTools = await import('./lm-tools');
});

beforeEach(() => {
  registeredTools.length = 0;
});

const WORKER_KEY = `pn_${'ab'.repeat(24)}`;
const PRO_KEY = `pyn_${'Cd'.repeat(16)}`;

function parseToolText(result: { content: unknown[] }): unknown {
  const part = result.content[0] as { value: string };
  return JSON.parse(part.value);
}

function fakeToken(): {
  isCancellationRequested: boolean;
  onCancellationRequested: () => { dispose(): void };
} {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
}

function makeDeps(
  overrides?: Partial<import('./lm-tools').LmToolsDeps>,
): import('./lm-tools').LmToolsDeps {
  const store = new ResultsFocusStore();
  return {
    runScript: async () => ({
      ok: true,
      mode: 'auto',
      focus: true,
      runId: 'run-1',
      epoch: 1,
    }),
    results: store,
    getChartSnapshotMeta: () => ({
      seriesKey: 'binance|spot|BTC/USDT|1m',
      interval: '1m',
      symbol: 'BTC/USDT',
      exchange: 'binance',
      market: 'spot',
      scriptIds: ['sma'],
      live: 'off',
    }),
    ...overrides,
  };
}

describe('LM contributes fragment', () => {
  test('names match LM_TOOL_NAMES', () => {
    const fragPath = join(import.meta.dir, 'lm-tools-contributes.fragment.json');
    const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as {
      contributes: {
        languageModelTools: Array<{ name: string; toolReferenceName?: string }>;
      };
    };
    const names = frag.contributes.languageModelTools.map((t) => t.name);
    expect(names).toEqual([
      lmTools.LM_TOOL_NAMES.runScript,
      lmTools.LM_TOOL_NAMES.getResultsFocus,
      lmTools.LM_TOOL_NAMES.chartSnapshotMeta,
    ]);
    expect(
      frag.contributes.languageModelTools.find(
        (t) => t.name === 'axis_chart_snapshot_meta',
      )?.toolReferenceName,
    ).toBe('axis_chart_meta');
  });
});

describe('summarizeRunRecord / summarizeMeta', () => {
  test('strips plot arrays and series values; keeps counts/keys', () => {
    const summary = lmTools.summarizeRunRecord({
      id: 'run-9',
      status: 'success',
      focus: true,
      seriesKey: 'binance|spot|BTC/USDT|1m',
      engineId: 'server',
      plots: [1, 2, 3, 4, 5],
      series: { SMA: [10, 20, 30], close: [1, 2] },
      meta: {
        ms: 12.5,
        transport: 'rest',
        mode: 'auto',
        plot_meta: { SMA: { kind: 'line' }, fill: { kind: 'fill' } },
        inputs: { length: 14 },
        apiKey: PRO_KEY,
      },
      strategyReport: { netProfit: 1 },
      createdAt: 1_700_000_000_000,
    });
    expect(summary).not.toBeNull();
    expect(summary!.plotCount).toBe(5);
    expect(summary!.plotKeys).toEqual([]);
    expect(summary!.seriesKeys).toEqual(['SMA', 'close']);
    expect(summary!.hasStrategyReport).toBe(true);
    expect(summary!.meta).toEqual({
      ms: 12.5,
      transport: 'rest',
      mode: 'auto',
      plot_meta_keys: ['SMA', 'fill'],
    });
    const json = JSON.stringify(summary);
    expect(json).not.toContain(PRO_KEY);
    expect(json).not.toMatch(/\[10,20,30\]/);
    expect(lmTools.payloadLeaksSecret(json)).toBe(false);
  });

  test('scrubs secrets in error and named plot keys path', () => {
    const summary = lmTools.summarizeRunRecord({
      id: 'run-err',
      status: 'error',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      error: `Unauthorized Bearer ${PRO_KEY} worker=${WORKER_KEY}`,
      plots: { ema: [1, 2], rsi: [3] },
      createdAt: 1,
    });
    expect(summary!.error).toBeDefined();
    expect(summary!.error).not.toContain(PRO_KEY);
    expect(summary!.error).not.toContain(WORKER_KEY);
    expect(summary!.error).toMatch(/Bearer \*\*\*\*/);
    expect(summary!.plotCount).toBe(2);
    expect(summary!.plotKeys).toEqual(['ema', 'rsi']);
    expect(lmTools.payloadLeaksSecret(JSON.stringify(summary))).toBe(false);
  });
});

describe('axis_run_script', () => {
  test('prepareInvocation requires confirmation', async () => {
    const tool = lmTools.createRunScriptTool(makeDeps());
    const prepared = await tool.prepareInvocation?.(
      { input: { mode: 'auto' } },
      fakeToken(),
    );
    expect(prepared?.invocationMessage).toBe('Run Pine via AXIS IDE');
    expect(prepared?.confirmationMessages?.title).toBe('AXIS: Run Script');
    expect(prepared?.confirmationMessages?.message).toBeTruthy();
    const msg = prepared!.confirmationMessages!.message;
    const text = typeof msg === 'string' ? msg : (msg as { value: string }).value;
    expect(text).toMatch(/Pine buffer/i);
    expect(text).not.toContain(PRO_KEY);
  });

  test('invoke returns summary via deps.runScript + results store', async () => {
    const store = new ResultsFocusStore();
    store.publish({
      status: 'success',
      focus: true,
      seriesKey: 'binance|spot|BTC/USDT|1m',
      engineId: 'server',
      plots: Array.from({ length: 100 }, (_, i) => i),
      series: { SMA: Array.from({ length: 100 }, (_, i) => i) },
      meta: { ms: 42, transport: 'rest' },
    });
    let seenMode: string | undefined;
    let seenFocus: boolean | undefined;
    const deps = makeDeps({
      results: store,
      runScript: async ({ mode, focus }) => {
        seenMode = mode;
        seenFocus = focus;
        return {
          ok: true,
          mode,
          focus,
          runId: store.getNewestRunId() ?? 'run-1',
          epoch: 3,
        };
      },
    });
    const tool = lmTools.createRunScriptTool(deps);
    const result = await tool.invoke(
      {
        input: { mode: 'compile', focus: true },
        toolInvocationToken: undefined,
      },
      fakeToken(),
    );
    expect(seenMode).toBe('compile');
    expect(seenFocus).toBe(true);
    const body = parseToolText(result as { content: unknown[] }) as LmMod['LmRunScriptResult'];
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('compile');
    expect(body.results?.lastRunSummary?.plotCount).toBe(100);
    expect(body.results?.lastRunSummary?.seriesKeys).toEqual(['SMA']);
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/,"plots":\[/);
    expect(json).not.toContain('"SMA":[');
    expect(lmTools.payloadLeaksSecret(json)).toBe(false);
  });

  test('invoke scrubs secrets from run errors', async () => {
    const tool = lmTools.createRunScriptTool(
      makeDeps({
        runScript: async () => ({
          ok: false,
          mode: 'auto',
          focus: true,
          reason: 'error',
          error: `engine said Bearer ${PRO_KEY}`,
        }),
      }),
    );
    const result = await tool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const body = parseToolText(result as { content: unknown[] }) as {
      error?: string;
    };
    expect(body.error).toBeDefined();
    expect(body.error).not.toContain(PRO_KEY);
    expect(lmTools.payloadLeaksSecret(JSON.stringify(body))).toBe(false);
  });
});

describe('axis_get_results_focus', () => {
  test('returns focus id + summary, not newest when they differ', async () => {
    const store = new ResultsFocusStore();
    const focusId = store.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      plots: { a: [1, 2, 3] },
    });
    const newestId = store.publish({
      status: 'success',
      focus: false,
      seriesKey: 'k',
      engineId: 'server',
      plots: { b: [9, 9, 9] },
    });
    expect(focusId).not.toBe(newestId);
    expect(store.getResultsFocusId()).toBe(focusId);
    expect(store.getNewestRunId()).toBe(newestId);

    const tool = lmTools.createGetResultsFocusTool(makeDeps({ results: store }));
    const result = await tool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const body = parseToolText(result as { content: unknown[] }) as LmMod['ResultsFocusLmPayload'];
    expect(body.resultsFocusId).toBe(focusId);
    expect(body.newestRunId).toBe(newestId);
    expect(body.lastRunSummary?.id).toBe(focusId);
    expect(body.lastRunSummary?.plotKeys).toEqual(['a']);
    expect(JSON.stringify(body)).not.toContain('[1,2,3]');
  });

  test('empty store → null summaries', async () => {
    const tool = lmTools.createGetResultsFocusTool(makeDeps());
    const result = await tool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const body = parseToolText(result as { content: unknown[] }) as LmMod['ResultsFocusLmPayload'];
    expect(body).toEqual({
      resultsFocusId: null,
      newestRunId: null,
      lastRunSummary: null,
    });
  });
});

describe('axis_chart_snapshot_meta', () => {
  test('returns meta from deps without bars', async () => {
    const tool = lmTools.createChartSnapshotMetaTool(makeDeps());
    const result = await tool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const body = parseToolText(result as { content: unknown[] }) as LmMod['ChartSnapshotMeta'];
    expect(body.seriesKey).toBe('binance|spot|BTC/USDT|1m');
    expect(body.interval).toBe('1m');
    expect(body.scriptIds).toEqual(['sma']);
    expect(body.live).toBe('off');
    expect(JSON.stringify(body)).not.toContain('bars');
  });

  test('null chart → soft error object', async () => {
    const tool = lmTools.createChartSnapshotMetaTool(
      makeDeps({ getChartSnapshotMeta: () => null }),
    );
    const result = await tool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const body = parseToolText(result as { content: unknown[] }) as {
      ok?: boolean;
      error?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/No active AXIS chart/i);
  });

  test('scrubs secret-shaped script ids', async () => {
    const tool = lmTools.createChartSnapshotMetaTool(
      makeDeps({
        getChartSnapshotMeta: () => ({
          seriesKey: 'k',
          interval: '1m',
          scriptIds: [WORKER_KEY, 'ok-script'],
          live: 'live',
        }),
      }),
    );
    const result = await tool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const json = JSON.stringify(parseToolText(result as { content: unknown[] }));
    expect(json).not.toContain(WORKER_KEY);
    expect(lmTools.payloadLeaksSecret(json)).toBe(false);
  });
});

describe('registerLmTools', () => {
  test('registers all three tool names', () => {
    const subscriptions: Array<{ dispose(): void }> = [];
    const context = {
      subscriptions,
    } as unknown as import('vscode').ExtensionContext;
    const disposables = lmTools.registerLmTools(context, makeDeps());
    expect(registeredTools.map((t) => t.name).sort()).toEqual(
      [
        lmTools.LM_TOOL_NAMES.chartSnapshotMeta,
        lmTools.LM_TOOL_NAMES.getResultsFocus,
        lmTools.LM_TOOL_NAMES.runScript,
      ].sort(),
    );
    expect(disposables).toHaveLength(3);
    expect(subscriptions).toHaveLength(3);
  });
});

describe('normalizeRunMode / payloadLeaksSecret', () => {
  test('normalizeRunMode defaults and accepts enums', () => {
    expect(lmTools.normalizeRunMode(undefined)).toBe('auto');
    expect(lmTools.normalizeRunMode('COMPILE')).toBe('compile');
    expect(lmTools.normalizeRunMode('interpret')).toBe('interpret');
    expect(lmTools.normalizeRunMode('nope')).toBe('auto');
  });

  test('payloadLeaksSecret detects raw keys', () => {
    expect(lmTools.payloadLeaksSecret(`{"k":"${PRO_KEY}"}`)).toBe(true);
    expect(lmTools.payloadLeaksSecret(`{"k":"${WORKER_KEY}"}`)).toBe(true);
    expect(lmTools.payloadLeaksSecret('{"k":"Bearer abcdefghijklmnop"}')).toBe(
      true,
    );
    expect(lmTools.payloadLeaksSecret('{"plotCount":3}')).toBe(false);
  });
});

describe('LM tool edge / catch paths', () => {
  test('summarizeMeta keeps boolean/null on allowlisted keys; series array / scalar plots', () => {
    const summary = lmTools.summarizeRunRecord({
      id: 'run-edge',
      status: 'success',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      series: [1, 2, 3] as unknown as Record<string, unknown>,
      plots: 'not-plots' as unknown as unknown[],
      meta: {
        ms: null,
        transport: true,
        skip: { nested: 1 },
      },
      createdAt: 1,
    });
    expect(summary).not.toBeNull();
    if (!summary) return;
    expect(summary.seriesKeys).toEqual([]);
    expect(summary.plotCount).toBe(0);
    expect(summary.meta).toEqual({ ms: null, transport: true });
  });

  test('runScript invoke catch + secret-looking payload refused', async () => {
    const tool = lmTools.createRunScriptTool(
      makeDeps({
        runScript: async () => {
          throw new Error(`boom ${WORKER_KEY}`);
        },
      }),
    );
    const result = await tool.invoke(
      { input: { mode: 'auto', focus: true }, toolInvocationToken: undefined },
      fakeToken(),
    );
    const body = parseToolText(result as { content: unknown[] }) as {
      ok?: boolean;
      error?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain(WORKER_KEY);

    const leaky = lmTools.createRunScriptTool(
      makeDeps({
        runScript: async () =>
          ({
            ok: true,
            mode: 'auto',
            focus: true,
            // Force a secret-shaped field through JSON so textResult refuses.
            debugKey: WORKER_KEY,
          }) as never,
      }),
    );
    const refused = await leaky.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const refusedBody = parseToolText(refused as { content: unknown[] }) as {
      ok?: boolean;
      error?: string;
    };
    expect(refusedBody.ok).toBe(false);
    expect(refusedBody.error).toMatch(/refused|secrets/i);
  });

  test('getResultsFocus + chart meta catch paths; non-array scriptIds', async () => {
    const focusTool = lmTools.createGetResultsFocusTool(
      makeDeps({
        results: {
          getFocusId: () => {
            throw new Error(`focus ${PRO_KEY}`);
          },
          getNewestRunId: () => null,
          getLastRun: () => null,
        } as never,
      }),
    );
    const focusResult = await focusTool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const focusBody = parseToolText(focusResult as { content: unknown[] }) as {
      error?: string;
    };
    expect(focusBody.error).toBeDefined();
    expect(focusBody.error).not.toContain(PRO_KEY);

    const metaTool = lmTools.createChartSnapshotMetaTool(
      makeDeps({
        getChartSnapshotMeta: () => {
          throw new Error('meta boom');
        },
      }),
    );
    const metaResult = await metaTool.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const metaBody = parseToolText(metaResult as { content: unknown[] }) as {
      ok?: boolean;
      error?: string;
    };
    expect(metaBody.ok).toBe(false);
    expect(metaBody.error).toMatch(/meta/i);

    const oddIds = lmTools.createChartSnapshotMetaTool(
      makeDeps({
        getChartSnapshotMeta: () =>
          ({
            seriesKey: 'k',
            interval: '1m',
            scriptIds: 'not-array' as unknown as string[],
            live: 'off',
          }),
      }),
    );
    const oddResult = await oddIds.invoke(
      { input: {}, toolInvocationToken: undefined },
      fakeToken(),
    );
    const oddBody = parseToolText(oddResult as { content: unknown[] }) as {
      scriptIds?: string[];
    };
    expect(oddBody.scriptIds).toEqual([]);
  });
});
