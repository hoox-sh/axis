/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Alerts CRUD + localStorage blob + webhook delivery (mocked fetch).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { installMemoryLocalStorage } from './setup';
import {
  ALERTS_STORAGE_KEY,
  _resetAlertsForTests,
  buildWebhookPayload,
  createAlert,
  deleteAlert,
  evaluateAlerts,
  fireWebhook,
  listAlerts,
  loadAlerts,
  notifyBrowserAlert,
  parseAlert,
  parseAlertsBlob,
  saveAlerts,
  updateAlert,
  type Alert,
} from '../src/alerts/index';

beforeEach(() => {
  installMemoryLocalStorage();
  _resetAlertsForTests();
});

afterEach(() => {
  _resetAlertsForTests();
});

describe('parseAlert / parseAlertsBlob', () => {
  it('rejects invalid records', () => {
    expect(parseAlert(null)).toBeNull();
    expect(parseAlert({})).toBeNull();
    expect(parseAlert({ id: 'x' })).toBeNull();
  });

  it('accepts a full alert', () => {
    const a = parseAlert({
      id: 'a1',
      name: 'Cross 100',
      enabled: true,
      symbol: 'BTCUSDT',
      kind: 'price_cross',
      params: { price: 100 },
      createdAt: 1,
      webhookUrl: 'https://example.com/hook',
      cooldownMs: 1000,
      lastFiredAt: 2,
      notifyBrowser: false,
      interval: '1h',
    });
    expect(a?.id).toBe('a1');
    expect(a?.params.price).toBe(100);
    expect(a?.webhookUrl).toContain('example');
    expect(a?.notifyBrowser).toBe(false);
  });

  it('parses versioned blob and bare array', () => {
    const alert = {
      id: 'a1',
      name: 'n',
      enabled: true,
      symbol: 'X',
      kind: 'price_above',
      params: { price: 1 },
      createdAt: 1,
    };
    expect(parseAlertsBlob(JSON.stringify({ version: 1, alerts: [alert] }))).toHaveLength(1);
    expect(parseAlertsBlob(JSON.stringify([alert]))).toHaveLength(1);
    expect(parseAlertsBlob('not-json')).toHaveLength(0);
    expect(parseAlertsBlob(null)).toHaveLength(0);
  });

  it('defaults enabled true when omitted', () => {
    const a = parseAlert({
      id: 'a1',
      name: 'n',
      symbol: 'X',
      kind: 'price_above',
      params: {},
      createdAt: 1,
    });
    expect(a?.enabled).toBe(true);
  });
});

describe('CRUD', () => {
  it('createAlert assigns id, createdAt, defaults', () => {
    const a = createAlert({
      name: 'Above 50k',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 50_000 },
      enabled: true,
    });
    expect(a.id).toMatch(/^alert_/);
    expect(a.createdAt).toBeGreaterThan(0);
    expect(a.notifyBrowser).toBe(true);
    expect(listAlerts()).toHaveLength(1);
    expect(listAlerts()[0]!.name).toBe('Above 50k');
  });

  it('createAlert respects explicit id', () => {
    const a = createAlert({
      id: 'custom_id',
      name: 'x',
      symbol: 'ETHUSDT',
      kind: 'price_below',
      params: { price: 1 },
      enabled: true,
    });
    expect(a.id).toBe('custom_id');
  });

  it('updateAlert patches fields and preserves createdAt', () => {
    const a = createAlert({
      id: 'u1',
      name: 'old',
      symbol: 'BTCUSDT',
      kind: 'price_cross',
      params: { price: 100 },
      enabled: true,
      createdAt: 42,
    });
    const u = updateAlert('u1', { name: 'new', params: { price: 200 }, enabled: false });
    expect(u?.name).toBe('new');
    expect(u?.params.price).toBe(200);
    expect(u?.enabled).toBe(false);
    expect(u?.createdAt).toBe(42);
    expect(updateAlert('missing', { name: 'x' })).toBeNull();
    expect(a.id).toBe('u1');
  });

  it('deleteAlert removes and is idempotent false', () => {
    createAlert({
      id: 'd1',
      name: 'x',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 1 },
      enabled: true,
    });
    expect(deleteAlert('d1')).toBe(true);
    expect(listAlerts()).toHaveLength(0);
    expect(deleteAlert('d1')).toBe(false);
  });

  it('round-trips through localStorage key axis.alerts.v1', () => {
    createAlert({
      id: 'p1',
      name: 'persist',
      symbol: 'BTCUSDT',
      kind: 'price_cross',
      params: { price: 100 },
      enabled: true,
    });
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);
    expect(parsed.alerts[0].id).toBe('p1');

    // Simulate reload: fresh LS + cleared memory
    _resetAlertsForTests();
    installMemoryLocalStorage();
    localStorage.setItem(ALERTS_STORAGE_KEY, raw!);
    expect(loadAlerts()[0]!.name).toBe('persist');
  });

  it('saveAlerts / loadAlerts replace full list', () => {
    const list: Alert[] = [
      {
        id: '1',
        name: 'a',
        enabled: true,
        symbol: 'A',
        kind: 'price_above',
        params: { price: 1 },
        createdAt: 1,
      },
    ];
    saveAlerts(list);
    expect(loadAlerts()).toHaveLength(1);
    saveAlerts([]);
    expect(loadAlerts()).toHaveLength(0);
  });
});

describe('evaluateAlerts with delivery', () => {
  it('persists lastFiredAt and POSTs webhook JSON', async () => {
    const posts: { url: string; body: string; method: string }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      posts.push({
        url: String(url),
        body: String(init?.body ?? ''),
        method: String(init?.method ?? 'GET'),
      });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    createAlert({
      id: 'w1',
      name: 'Hook me',
      symbol: 'BTCUSDT',
      kind: 'price_cross',
      params: { price: 100 },
      enabled: true,
      webhookUrl: 'https://hooks.example/alert',
      notifyBrowser: false,
    });

    // seed prev via first eval
    await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 99 },
      { deliver: false, now: 1000 },
    );
    const fired = await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 101 },
      { deliver: true, now: 2000, fetchImpl },
    );
    expect(fired).toHaveLength(1);
    expect(fired[0]!.lastFiredAt).toBe(2000);
    expect(listAlerts()[0]!.lastFiredAt).toBe(2000);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.method).toBe('POST');
    expect(posts[0]!.url).toBe('https://hooks.example/alert');
    const payload = JSON.parse(posts[0]!.body);
    expect(payload).toEqual({
      alertId: 'w1',
      name: 'Hook me',
      symbol: 'BTCUSDT',
      price: 101,
      kind: 'price_cross',
      firedAt: 2000,
    });
  });

  it('deliver:false skips webhook', async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    createAlert({
      id: 'w2',
      name: 'n',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 100 },
      enabled: true,
      webhookUrl: 'https://hooks.example/x',
    });

    await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 101 },
      { deliver: false, now: 1, fetchImpl },
    );
    expect(called).toBe(0);
    expect(listAlerts()[0]!.lastFiredAt).toBe(1);
  });

  it('cooldown prevents spam across evaluateAlerts calls', async () => {
    createAlert({
      id: 'cd',
      name: 'n',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 100 },
      enabled: true,
      cooldownMs: 10_000,
    });
    const f1 = await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 101 },
      { deliver: false, now: 1000 },
    );
    expect(f1).toHaveLength(1);
    // Still above — would be edge-false anyway; re-enter below then above within cooldown
    await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 99 },
      { deliver: false, now: 2000 },
    );
    const f2 = await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 102 },
      { deliver: false, now: 3000 },
    );
    expect(f2).toHaveLength(0);
    const f3 = await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 99 },
      { deliver: false, now: 4000 },
    );
    expect(f3).toHaveLength(0);
    const f4 = await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 103 },
      { deliver: false, now: 12_000 },
    );
    expect(f4).toHaveLength(1);
  });
});

describe('webhook helpers', () => {
  it('fireWebhook returns false on network error', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const ok = await fireWebhook(
      'https://x.test',
      buildWebhookPayload(
        {
          id: '1',
          name: 'n',
          symbol: 'S',
          kind: 'price_above',
          params: {},
          enabled: true,
          createdAt: 1,
        },
        1,
        2,
      ),
      fetchImpl,
    );
    expect(ok).toBe(false);
  });

  it('fireWebhook returns false on non-2xx', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    const ok = await fireWebhook(
      'https://x.test',
      {
        alertId: '1',
        name: 'n',
        symbol: 'S',
        price: 1,
        kind: 'price_above',
        firedAt: 2,
      },
      fetchImpl,
    );
    expect(ok).toBe(false);
  });

  it('notifyBrowserAlert respects permission and notifyBrowser flag', () => {
    const constructed: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = 'granted';
      constructor(title: string) {
        constructed.push(title);
      }
    }
    const alert: Alert = {
      id: '1',
      name: 'My alert',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: {},
      enabled: true,
      createdAt: 1,
      notifyBrowser: true,
    };
    expect(
      notifyBrowserAlert(alert, 100, FakeNotification as unknown as typeof Notification),
    ).toBe(true);
    expect(constructed[0]).toBe('My alert');

    FakeNotification.permission = 'denied';
    expect(
      notifyBrowserAlert(alert, 100, FakeNotification as unknown as typeof Notification),
    ).toBe(false);

    FakeNotification.permission = 'granted';
    expect(
      notifyBrowserAlert(
        { ...alert, notifyBrowser: false },
        100,
        FakeNotification as unknown as typeof Notification,
      ),
    ).toBe(false);
  });
});

describe('memory fallback without localStorage', () => {
  it('still creates and lists when LS throws', () => {
    const prev = globalThis.localStorage;
    const bad = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
      clear() {},
      key() {
        return null;
      },
      length: 0,
    };
    try {
      (globalThis as unknown as { localStorage: typeof bad }).localStorage = bad;
      _resetAlertsForTests();

      createAlert({
        id: 'mem1',
        name: 'memory',
        symbol: 'BTCUSDT',
        kind: 'price_above',
        params: { price: 1 },
        enabled: true,
      });
      expect(listAlerts().map((a) => a.id)).toEqual(['mem1']);
    } finally {
      (globalThis as unknown as { localStorage: typeof prev }).localStorage = prev;
      _resetAlertsForTests();
    }
  });
});
