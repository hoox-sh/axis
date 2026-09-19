/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import worker from '../src/index';
import type { Env } from '../src/index';
import { sessionIdFromApiKey } from '../src/mcp/protocol';

const KEY = `pn_${'b'.repeat(48)}`;
const TICKET_NONCE = 'c'.repeat(32);

function fakeEnv(forwarded: string[], connected = 2): Env {
  const stub = {
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      forwarded.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/status') {
        return new Response(JSON.stringify({ status: 'ok', connected }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname === '/ticket') {
        return new Response(JSON.stringify({ nonce: TICKET_NONCE, expiresIn: 30 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 101 });
    },
  };
  return {
    ALLOW_OPEN_KEYS: '1',
    MCP_BRIDGE: {
      idFromName: (name: string) => ({ name }),
      get: () => stub,
    } as unknown as Env['MCP_BRIDGE'],
  };
}

const fetchApp = (req: Request, env: Env): Promise<Response> =>
  (worker.fetch as unknown as (req: Request, env: Env) => Promise<Response>)(req, env);

describe('GET /api/mcp/bridge session status', () => {
  it('plain GET returns the DO tab count with CORS headers', async () => {
    const forwarded: string[] = [];
    const res = await fetchApp(
      new Request('https://worker.axis.hoox.sh/api/mcp/bridge', {
        headers: { Authorization: `Bearer ${KEY}`, Origin: 'https://axis.hoox.sh' },
      }),
      fakeEnv(forwarded, 3),
    );
    expect(res.status).toBe(200);
    expect(forwarded).toEqual(['/status']);
    const body = (await res.json()) as { status: string; connected: number };
    expect(body.status).toBe('ok');
    expect(body.connected).toBe(3);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://axis.hoox.sh');
  });

  it('websocket upgrade still routes to /ws', async () => {
    const forwarded: string[] = [];
    const res = await fetchApp(
      new Request('https://worker.axis.hoox.sh/api/mcp/bridge?key=x', {
        headers: { Authorization: `Bearer ${KEY}`, Upgrade: 'websocket' },
      }),
      fakeEnv(forwarded),
    );
    expect(res.status).toBe(101);
    expect(forwarded).toEqual(['/ws']);
  });

  it('mints a one-time ticket on GET ?issue=ticket', async () => {
    const forwarded: string[] = [];
    const res = await fetchApp(
      new Request('https://worker.axis.hoox.sh/api/mcp/bridge?issue=ticket', {
        headers: { Authorization: `Bearer ${KEY}` },
      }),
      fakeEnv(forwarded),
    );
    expect(res.status).toBe(200);
    expect(forwarded).toEqual(['/ticket']);
    const body = (await res.json()) as { ticket: string; expiresIn: number };
    const userId = await sessionIdFromApiKey(KEY);
    expect(body.ticket).toBe(`${userId}.${TICKET_NONCE}`);
    expect(body.expiresIn).toBe(30);
  });

  it('websocket upgrade with ?ticket= does not require the long-lived key', async () => {
    const forwarded: string[] = [];
    const userId = await sessionIdFromApiKey(KEY);
    const res = await fetchApp(
      new Request(`https://worker.axis.hoox.sh/api/mcp/bridge?ticket=${userId}.${TICKET_NONCE}`, {
        headers: { Upgrade: 'websocket' },
      }),
      fakeEnv(forwarded),
    );
    expect(res.status).toBe(101);
    expect(forwarded).toEqual([`/ws?ticket=${TICKET_NONCE}`]);
  });

  it('websocket upgrade with only ?key= is 401', async () => {
    const res = await fetchApp(
      new Request(`https://worker.axis.hoox.sh/api/mcp/bridge?key=${KEY}`, {
        headers: { Upgrade: 'websocket' },
      }),
      fakeEnv([]),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NO_KEY');
  });

  it('missing key is 401 and missing binding is 503', async () => {
    const noKey = await fetchApp(
      new Request('https://worker.axis.hoox.sh/api/mcp/bridge'),
      fakeEnv([]),
    );
    expect(noKey.status).toBe(401);

    const noBinding = await fetchApp(
      new Request('https://worker.axis.hoox.sh/api/mcp/bridge', {
        headers: { Authorization: `Bearer ${KEY}` },
      }),
      { ALLOW_OPEN_KEYS: '1' },
    );
    expect(noBinding.status).toBe(503);
    const body = (await noBinding.json()) as { code: string };
    expect(body.code).toBe('NO_MCP_BRIDGE');
  });
});
