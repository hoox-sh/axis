/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  LiveTicketError,
  liveProxyForEngine,
  liveTicketRetryable,
  mintLiveTicket,
  shouldUseLiveProxy,
  workerLiveHttpUrl,
  workerLiveWsUrl,
} from '../../src/engine/live-ticket';

const KEY = `pn_${'ab'.repeat(24)}`;
const TICKET = 'a'.repeat(32);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('shouldUseLiveProxy', () => {
  test('needs a Worker key and two remote hosts', () => {
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: 'https://worker.axis.hoox.sh',
        workerApiKey: KEY,
      }),
    ).toBe(true);
  });

  test('skips a loopback engine so local PYNE is not replaced', () => {
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'http://127.0.0.1:5002',
        workerEndpoint: 'https://worker.axis.hoox.sh',
        workerApiKey: KEY,
      }),
    ).toBe(false);
  });

  test('skips a loopback Worker so local Vite without wrangler stays direct', () => {
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: 'http://127.0.0.1:8787',
        workerApiKey: KEY,
      }),
    ).toBe(false);
  });

  test('skips a short or non-Worker key', () => {
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: 'https://worker.axis.hoox.sh',
        workerApiKey: 'key-1',
      }),
    ).toBe(false);
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: 'https://example.test',
        workerApiKey: KEY,
      }),
    ).toBe(false);
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: 'https://worker.axis.hoox.sh',
        workerApiKey: '  ',
      }),
    ).toBe(false);
    expect(
      liveProxyForEngine({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: 'https://worker.axis.hoox.sh',
        workerApiKey: KEY,
      }),
    ).toEqual({ endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY });
  });
});

describe('worker live URLs', () => {
  test('maps the Worker origin to /api/ws/live without the engine key', () => {
    expect(workerLiveHttpUrl('https://worker.axis.hoox.sh/api')).toBe(
      'https://worker.axis.hoox.sh/api/ws/live',
    );
    expect(workerLiveWsUrl('https://worker.axis.hoox.sh')).toBe(
      'wss://worker.axis.hoox.sh/api/ws/live',
    );
    expect(workerLiveWsUrl('https://worker.axis.hoox.sh', TICKET)).toBe(
      `wss://worker.axis.hoox.sh/api/ws/live?ticket=${TICKET}`,
    );
    expect(workerLiveWsUrl('http://127.0.0.1:8787', TICKET)).toBe(
      `ws://127.0.0.1:8787/api/ws/live?ticket=${TICKET}`,
    );
    expect(workerLiveWsUrl('https://worker.axis.hoox.sh', TICKET)).not.toContain('api_key');
  });
});

describe('mintLiveTicket', () => {
  test('GETs issue=ticket with Bearer and returns a 32-hex nonce', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      return json({ status: 'success', ticket: TICKET, expiresIn: 60 });
    }) as typeof fetch;
    await expect(
      mintLiveTicket({ endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY }),
    ).resolves.toBe(TICKET);
    expect(seen).toEqual([
      {
        url: 'https://worker.axis.hoox.sh/api/ws/live?issue=ticket',
        auth: `Bearer ${KEY}`,
      },
    ]);
  });

  test('401 is not retryable', async () => {
    globalThis.fetch = (async () => json({ status: 'error' }, 401)) as typeof fetch;
    try {
      await mintLiveTicket({ endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY });
      throw new Error('expected mint to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(LiveTicketError);
      expect(liveTicketRetryable(err)).toBe(false);
    }
  });

  test('5xx is retryable', async () => {
    globalThis.fetch = (async () => json({ status: 'error' }, 503)) as typeof fetch;
    try {
      await mintLiveTicket({ endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY });
      throw new Error('expected mint to fail');
    } catch (err) {
      expect(liveTicketRetryable(err)).toBe(true);
    }
  });

  test('rejects a body without a hex ticket', async () => {
    globalThis.fetch = (async () => json({ status: 'success', ticket: 'nope' })) as typeof fetch;
    await expect(
      mintLiveTicket({ endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY }),
    ).rejects.toThrow(/missing/i);
  });
});
