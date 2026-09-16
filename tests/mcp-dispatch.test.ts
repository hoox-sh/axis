/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { setStore, addWatchlistSymbol, appendLog, clearLogs, saveEditorDoc } from '../src/store';
import { invokeCapability } from '../src/mcp/dispatch';
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

  it('logs append + get', async () => {
    appendLog('info', 'hello', 'test');
    await invokeCapability('logs.append', { level: 'ok', message: 'mcp', source: 'mcp' });
    const logs = (await invokeCapability('logs.get', { limit: 10 })) as Array<{ message: string }>;
    expect(logs.some((l) => l.message === 'mcp')).toBe(true);
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
