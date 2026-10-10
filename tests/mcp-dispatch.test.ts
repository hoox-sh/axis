/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { setStore, addWatchlistSymbol, appendLog, clearLogs, saveEditorDoc } from '../src/store';
import { invokeCapability } from '../src/mcp/dispatch';
import { _resetAlertsForTests } from '../src/alerts';
import { APP_CAPABILITIES, findCapability, SETTABLE_PATHS } from '../src/mcp/catalog';
import { buildAppSnapshot } from '../src/mcp/snapshot';
import { McpInvokeError } from '../src/mcp/protocol';
import { setPaletteCommands } from '../src/mcp/commands';

describe('MCP catalog', () => {
  it('covers chart, editor, alerts, library, plugins', () => {
    const ids = APP_CAPABILITIES.map((c) => c.id);
    expect(ids).toContain('chart.load');
    expect(ids).toContain('editor.run');
    expect(ids).toContain('alerts.create');
    expect(ids).toContain('library.write');
    expect(ids).toContain('plugins.activate');
    expect(findCapability('app.invoke')).toBeUndefined();
    expect(SETTABLE_PATHS.has('symbol')).toBe(true);
  });
});

describe('MCP snapshot', () => {
  it('redacts secret-like keys and summarizes bars', () => {
    setStore('symbol', 'ETHUSDT');
    setStore('pluginsConfig', 'storage:cloud', { endpoint: 'http://127.0.0.1:8787', apiKey: 'pn_secret' });
    const snap = buildAppSnapshot();
    expect(snap.symbol).toBe('ETHUSDT');
    const bars = snap.bars as { count?: number };
    expect(typeof bars.count).toBe('number');
    const text = JSON.stringify(snap);
    expect(text).not.toContain('pn_secret');
  });
});

describe('MCP dispatch', () => {
  beforeEach(() => {
    clearLogs();
    setStore('symbol', 'BTCUSDT');
    setStore('interval', '1h');
  });

  it('app.capabilities lists ids', async () => {
    const r = (await invokeCapability('app.capabilities')) as { capabilities: Array<{ id: string }> };
    expect(r.capabilities.length).toBeGreaterThan(20);
  });

  it('app.set symbol + app.get path', async () => {
    await invokeCapability('app.set', { path: 'symbol', value: 'solusdt' });
    const v = await invokeCapability('app.get', { path: 'symbol' });
    expect(v).toBe('SOLUSDT');
  });

  it('rejects unknown set path', async () => {
    try {
      await invokeCapability('app.set', { path: 'pluginsConfig.cloud.apiKey', value: 'x' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(McpInvokeError);
      expect((err as McpInvokeError).code).toBe('PATH_DENIED');
    }
  });

  it('watchlist add/remove', async () => {
    addWatchlistSymbol('AAAUSDT');
    await invokeCapability('watchlist.add', { symbol: 'bbbusdt' });
    const got = (await invokeCapability('watchlist.get')) as { symbols: string[] };
    expect(got.symbols).toContain('BBBUSDT');
    await invokeCapability('watchlist.remove', { symbol: 'BBBUSDT' });
  });

  it('D12 — app.set watchlist.open routes through setPanelOpen (dual-write)', async () => {
    const { store, getPanelChrome } = await import('../src/store');
    await invokeCapability('app.set', { path: 'watchlist.open', value: true });
    expect(store.watchlist.open).toBe(true);
    expect(getPanelChrome('watchlist').open).toBe(true);
    await invokeCapability('app.set', { path: 'watchlist.open', value: false });
    expect(store.watchlist.open).toBe(false);
    expect(getPanelChrome('watchlist').open).toBe(false);
  });

  it('logs append + get', async () => {
    appendLog('info', 'hello', 'test');
    await invokeCapability('logs.append', { level: 'ok', message: 'mcp', source: 'mcp' });
    const logs = (await invokeCapability('logs.get', { limit: 10 })) as Array<{ message: string }>;
    expect(logs.some((l) => l.message === 'mcp')).toBe(true);
  });

  it('logs.get filters by source and level', async () => {
    clearLogs();
    appendLog('info', 'mcp line', 'mcp');
    appendLog('error', 'mcp boom', 'mcp');
    appendLog('info', 'boot line', 'boot');
    const mcpOnly = (await invokeCapability('logs.get', { source: 'mcp' })) as Array<{
      source: string;
    }>;
    expect(mcpOnly.length).toBe(2);
    expect(mcpOnly.every((l) => l.source === 'mcp')).toBe(true);
    const errors = (await invokeCapability('logs.get', { level: 'error' })) as Array<{
      level: string;
    }>;
    expect(errors.length).toBe(1);
    expect(errors[0]?.level).toBe('error');
    const both = (await invokeCapability('logs.get', { source: 'mcp', level: 'info', limit: 5 })) as Array<{
      message: string;
    }>;
    expect(both.map((l) => l.message)).toEqual(['mcp line']);
    try {
      await invokeCapability('logs.get', { level: 'verbose' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('BAD_LEVEL');
    }
  });

  it('editor get/set', async () => {
    saveEditorDoc('//@version=6\nindicator("t")');
    const before = (await invokeCapability('editor.get')) as { doc: string };
    expect(before.doc).toContain('indicator');
    await invokeCapability('editor.set', { doc: '//@version=6\nstrategy("s")' });
    const after = (await invokeCapability('editor.get')) as { doc: string };
    expect(after.doc).toContain('strategy');
  });

  it('app.command uses palette runner', async () => {
    let ran = false;
    setPaletteCommands([{ id: 'theme.toggle', run: () => { ran = true; } }]);
    const r = await invokeCapability('app.command', { id: 'theme.toggle' });
    expect(ran).toBe(true);
    expect((r as { ok: boolean }).ok).toBe(true);
  });

  it('unknown capability', async () => {
    try {
      await invokeCapability('not.a.thing');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('UNKNOWN_CAPABILITY');
    }
  });
});

describe('MCP drawings', () => {
  beforeEach(() => {
    setStore('drawings', []);
    setStore('symbol', 'BTCUSDT');
  });

  it('add / list / update / remove round-trip', async () => {
    const added = (await invokeCapability('drawings.add', {
      kind: 'trend',
      points: [
        { time: 1700000000, price: 67000 },
        { time: 1700003600, price: 67600 },
      ],
      style: { color: '#ff0000' },
    })) as { id: string; kind: string };
    expect(added.kind).toBe('trend');
    expect(typeof added.id).toBe('string');

    const list = (await invokeCapability('drawings.list')) as Array<{ id: string }>;
    expect(list.some((d) => d.id === added.id)).toBe(true);

    const filtered = (await invokeCapability('drawings.list', { symbol: 'BTCUSDT' })) as Array<{ id: string }>;
    expect(filtered.some((d) => d.id === added.id)).toBe(true);
    const other = (await invokeCapability('drawings.list', { symbol: 'ETHUSDT' })) as Array<unknown>;
    expect(other.length).toBe(0);

    const updated = (await invokeCapability('drawings.update', {
      id: added.id,
      visible: false,
      style: { width: 3 },
    })) as { id: string };
    expect(updated.id).toBe(added.id);

    const removed = (await invokeCapability('drawings.remove', { id: added.id })) as { ok: boolean };
    expect(removed.ok).toBe(true);
    const after = (await invokeCapability('drawings.list')) as Array<unknown>;
    expect(after.some((d) => (d as { id: string }).id === added.id)).toBe(false);
  });

  it('rejects bad kind, empty points, short arity', async () => {
    for (const [payload, code] of [
      [{ kind: 'nope', points: [{ time: 1, price: 2 }] }, 'BAD_KIND'],
      [{ kind: 'cursor', points: [{ time: 1, price: 2 }] }, 'BAD_KIND'],
      [{ kind: 'trend', points: [] }, 'NO_POINTS'],
      [{ kind: 'trend', points: [{ time: 1, price: 2 }] }, 'BAD_DRAWING'],
      [{ kind: 'trend', points: [{ time: NaN, price: 2 }, { time: 3, price: 4 }] }, 'BAD_POINT'],
    ] as Array<[Record<string, unknown>, string]>) {
      try {
        await invokeCapability('drawings.add', payload);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as McpInvokeError).code).toBe(code);
      }
    }
  });

  it('update rejects unknown id and kind change', async () => {
    try {
      await invokeCapability('drawings.update', { id: 'dw_missing', visible: true });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('NOT_FOUND');
    }
    const added = (await invokeCapability('drawings.add', {
      kind: 'hline',
      points: [{ time: 0, price: 70000 }],
    })) as { id: string };
    try {
      await invokeCapability('drawings.update', { id: added.id, kind: 'trend' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('KIND_IMMUTABLE');
    }
    try {
      await invokeCapability('drawings.remove', { id: 'dw_missing' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('NOT_FOUND');
    }
    await invokeCapability('drawings.remove', { id: added.id });
  });
});

describe('MCP indicators', () => {
  it('remove detaches unknown ids loudly, removes known ones', async () => {
    try {
      await invokeCapability('indicators.remove', { id: 'ind_missing' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('NOT_FOUND');
    }
    const { addIndicator } = await import('../src/store');
    const id = addIndicator('MCP tmp', '//@version=6\nindicator("t")', 'price', {});
    const out = (await invokeCapability('indicators.remove', { id })) as { ok: boolean };
    expect(out.ok).toBe(true);
    const list = (await invokeCapability('indicators.list')) as Array<{ id: string }>;
    expect(list.some((s) => s.id === id)).toBe(false);
    try {
      await invokeCapability('indicators.remove', { id });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('NOT_FOUND');
    }
  });

  it('update syncs visibility and rejects unknown ids', async () => {
    try {
      await invokeCapability('indicators.update', { id: 'ind_missing', visible: false });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('NOT_FOUND');
    }
    const { addIndicator } = await import('../src/store');
    const id = addIndicator('MCP vis', '//@version=6\nindicator("v")', 'price', {});
    const out = (await invokeCapability('indicators.update', { id, visible: false })) as {
      ok: boolean;
      visible: boolean;
    };
    expect(out.ok).toBe(true);
    expect(out.visible).toBe(false);
    const list = (await invokeCapability('indicators.list')) as Array<{
      id: string;
      visible: boolean;
    }>;
    expect(list.find((s) => s.id === id)?.visible).toBe(false);
    await invokeCapability('indicators.remove', { id });
  });
});

describe('MCP settings', () => {
  it('get returns sanitized settings without secrets', async () => {
    const s = (await invokeCapability('settings.get')) as Record<string, unknown>;
    expect(typeof s.endpoint).toBe('string');
    expect(typeof s.interval).toBe('string');
    expect(typeof s.historyBars).toBe('number');
    expect(JSON.stringify(s)).not.toMatch(/apiKey|pn_/i);
    const interval = await invokeCapability('settings.get', { key: 'interval' });
    expect(interval).toBe(s.interval);
  });

  it('set patches allowlisted keys with validation', async () => {
    const r = (await invokeCapability('settings.set', {
      refreshSec: 30,
      autoload: false,
      'live.rerunOn': 'bar-close',
      'strategyUi.invertTradeLabels': true,
      'telemetry.hudCompact': true,
    })) as { ok: boolean; updated: string[] };
    expect(r.ok).toBe(true);
    expect(r.updated).toContain('refreshSec');
    const s = (await invokeCapability('settings.get')) as Record<string, unknown>;
    expect(s.autoload).toBe(false);
    expect((s.live as { rerunOn: string }).rerunOn).toBe('bar-close');
    // restore defaults for other suites
    await invokeCapability('settings.set', {
      refreshSec: 15,
      autoload: true,
      'live.rerunOn': 'every-tick',
      'strategyUi.invertTradeLabels': false,
      'telemetry.hudCompact': false,
    });
  });

  it('set reloads chart on interval change (mock-walk)', async () => {
    setStore('source', 'mock-walk');
    setStore('interval', '15m');
    const r = (await invokeCapability('settings.set', { interval: '1h' })) as {
      ok: boolean;
      reloaded: boolean;
      bars: number;
    };
    expect(r.ok).toBe(true);
    expect(r.reloaded).toBe(true);
    expect(r.bars).toBeGreaterThan(0);
    setStore('source', 'binance-rest');
  });

  it('set rejects secrets, bad interval, unknown engine', async () => {
    for (const [patch, code] of [
      [{ apiKey: 'pn_secret' }, 'SETTING_DENIED'],
      [{ cloudApiKey: 'pn_secret' }, 'SETTING_DENIED'],
      [{ interval: '99y' }, 'BAD_INTERVAL'],
      [{ engine: 'nope-engine' }, 'UNKNOWN_ENGINE'],
      [{ 'live.rerunOn': 'sometimes' }, 'BAD_VALUE'],
    ] as Array<[Record<string, unknown>, string]>) {
      try {
        await invokeCapability('settings.set', patch);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as McpInvokeError).code).toBe(code);
      }
    }
  });
});

describe('MCP zoom + drawing tool aliases', () => {
  it('chart.zoom accepts action alias for reset', async () => {
    const out = (await invokeCapability('chart.zoom', { action: 'reset' })) as { ok: boolean; op: string };
    expect(out.ok).toBe(true);
    expect(out.op).toBe('reset');
  });

  it('drawings.tool validates unknown tools', async () => {
    const out = (await invokeCapability('drawings.tool', { tool: 'cursor' })) as { tool: string };
    expect(out.tool).toBe('cursor');
    try {
      await invokeCapability('drawings.tool', { tool: 'nope-tool' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('BAD_TOOL');
    }
    try {
      await invokeCapability('drawings.tool', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('NO_TOOL');
    }
  });
});

describe('MCP alerts redaction (F4)', () => {
  beforeEach(() => {
    _resetAlertsForTests();
  });

  it('create/list/update never echo webhook URLs', async () => {
    const created = (await invokeCapability('alerts.create', {
      name: 'hook-secret',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 100 },
      webhookUrl: 'https://hooks.example/secret?token=abc123',
    })) as Record<string, unknown>;
    expect('webhookUrl' in created).toBe(false);
    expect('l2WebhookUrl' in created).toBe(false);
    expect(created.webhookHost).toBe('hooks.example');
    expect(created.hasWebhook).toBe(true);
    expect(created.hasL2Webhook).toBe(false);

    const list = (await invokeCapability('alerts.list')) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('abc123');
    expect(list[0]?.webhookHost).toBe('hooks.example');

    const updated = (await invokeCapability('alerts.update', {
      id: created.id,
      patch: { name: 'renamed' },
    })) as Record<string, unknown>;
    expect('webhookUrl' in updated).toBe(false);
    expect(updated.webhookHost).toBe('hooks.example');
    _resetAlertsForTests();
  });
});

describe('MCP app.event allowlist + endpoint https (F5)', () => {
  it('rejects non-allowlisted event names', async () => {
    for (const name of ['axis-evil', 'not-axis', '', 'axis-open-settingsX']) {
      try {
        await invokeCapability('app.event', { name });
        throw new Error(`should have thrown for ${name}`);
      } catch (err) {
        expect((err as McpInvokeError).code).toBe('EVENT_DENIED');
      }
    }
  });

  it('accepts allowlisted UI events without dispatching in tests', async () => {
    const r = (await invokeCapability('app.event', { name: 'axis-open-settings' })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
  });

  it('settings.set rejects cleartext http endpoints', async () => {
    try {
      await invokeCapability('settings.set', { endpoint: 'http://example.com/api' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('BAD_VALUE');
    }
    const okHttps = (await invokeCapability('settings.set', {
      endpoint: 'https://worker.axis.hoox.sh',
    })) as { ok: boolean };
    expect(okHttps.ok).toBe(true);
    const okLoopback = (await invokeCapability('settings.set', {
      endpoint: 'http://127.0.0.1:8787',
    })) as { ok: boolean };
    expect(okLoopback.ok).toBe(true);
  });
});

describe('MCP mutates gate (F22)', () => {
  it('denies mutating capabilities for in-page callers', async () => {
    try {
      await invokeCapability('logs.append', { message: 'x' }, { allowMutations: false });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as McpInvokeError).code).toBe('MUTATION_DENIED');
    }
    // Reads still pass.
    const logs = (await invokeCapability('logs.get', { limit: 1 }, { allowMutations: false })) as unknown[];
    expect(Array.isArray(logs)).toBe(true);
  });

  it('allows mutations for bridge-style callers', async () => {
    const r = (await invokeCapability('logs.append', { message: 'f22' }, { allowMutations: true })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
  });
});

describe('MCP targeted set + bounded bars (F9/F23)', () => {
  it('app.set returns the targeted value, not a snapshot', async () => {
    const v = await invokeCapability('app.set', { path: 'symbol', value: 'ethusdt' });
    expect(v).toBe('ETHUSDT');
    await invokeCapability('app.set', { path: 'symbol', value: 'BTCUSDT' });
  });

  it('chart.get returns a bar summary without a full snapshot', async () => {
    const c = (await invokeCapability('chart.get')) as { bars: { count: number } };
    expect(typeof c.bars.count).toBe('number');
  });

  it('includeBars returns bounded rows, never "[array N]"', async () => {
    const bars = Array.from({ length: 500 }, (_, i) => ({
      time: 1_700_000_000 + i * 60,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
    }));
    setStore('bars', bars as never);
    try {
      const withBars = buildAppSnapshot({ includeBars: true });
      expect(Array.isArray(withBars.bars)).toBe(true);
      expect((withBars.bars as unknown[]).length).toBe(300);
      const without = buildAppSnapshot();
      expect((without.bars as { count: number }).count).toBe(500);
    } finally {
      setStore('bars', []);
    }
  });
});
