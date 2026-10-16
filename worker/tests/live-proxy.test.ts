/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `WS /api/ws/live` proxy (F-15): ticket issue/consume, URL mapping,
 * auth rejection, and route fall-through.
 */

import { describe, expect, it } from 'bun:test';
import {
  _resetLiveTicketsForTests,
  engineLiveWsUrl,
  handleLiveProxy,
} from '../src/live-proxy';
import type { Env } from '../src/index';

const origin = 'http://localhost:3000';
const KEY = 'pn_' + 'ab'.repeat(24);

function req(path: string, headers?: HeadersInit): Request {
  return new Request(`https://worker.example${path}`, { headers });
}

describe('handleLiveProxy routing', () => {
  it('ignores other paths', async () => {
    expect(await handleLiveProxy(req('/api/run'), {} as Env, origin, '/api/run')).toBeNull();
  });

  it('requires upgrade or ticket issue', async () => {
    const res = await handleLiveProxy(req('/api/ws/live'), {} as Env, origin, '/api/ws/live');
    expect(res!.status).toBe(426);
  });

  it('refuses ticket issue without a key', async () => {
    _resetLiveTicketsForTests();
    const res = await handleLiveProxy(req('/api/ws/live?issue=ticket'), {} as Env, origin, '/api/ws/live');
    expect(res!.status).toBe(401);
  });

  it('mints a ticket with a shape-valid key', async () => {
    _resetLiveTicketsForTests();
    const res = await handleLiveProxy(
      req('/api/ws/live?issue=ticket', { Authorization: `Bearer ${KEY}` }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { status: string; ticket: string; expiresIn: number };
    expect(body.status).toBe('success');
    expect(body.ticket).toMatch(/^[a-f0-9]{32}$/);
    expect(body.expiresIn).toBe(60);
  });

  it('rejects upgrades with a bad ticket', async () => {
    _resetLiveTicketsForTests();
    const bad = '0'.repeat(32);
    const res = await handleLiveProxy(
      req(`/api/ws/live?ticket=${bad}`, { Upgrade: 'websocket' }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    expect(res!.status).toBe(401);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('INVALID_TICKET');
  });

  it('rejects upgrades without backend configured', async () => {
    _resetLiveTicketsForTests();
    const issued = await handleLiveProxy(
      req('/api/ws/live?issue=ticket', { Authorization: `Bearer ${KEY}` }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    const { ticket } = (await issued!.json()) as { ticket: string };
    const res = await handleLiveProxy(
      req(`/api/ws/live?ticket=${ticket}`, { Upgrade: 'websocket' }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    expect(res!.status).toBe(503);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('NO_BACKEND');
  });
});

describe('engineLiveWsUrl', () => {
  it('maps http(s) origins to /ws/live', () => {
    expect(engineLiveWsUrl('https://pyne.example:5002/api')).toBe('wss://pyne.example:5002/ws/live');
    expect(engineLiveWsUrl('http://127.0.0.1:5002')).toBe('ws://127.0.0.1:5002/ws/live');
    expect(engineLiveWsUrl('ftp://x')).toBeNull();
    expect(engineLiveWsUrl('::::')).toBeNull();
  });
});
