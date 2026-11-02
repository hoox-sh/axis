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

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_WORKER_URL,
  LIVE_TICKET_TTL_S,
  LIVE_WS_PATH,
  MCP_BRIDGE_PATH,
  LiveTicketError,
  assertSafeLiveWsUrl,
  checkWorkerUrl,
  isLiveTicketError,
  liveTicketRetryable,
  looksLikeWorkerEndpoint,
  mintLiveTicket,
  shouldUseLiveProxy,
  workerLiveHttpUrl,
  workerLiveWsUrl,
} from './ticket';

const KEY = `pn_${'ab'.repeat(24)}`;
const TICKET = 'a'.repeat(32);

function json(body: unknown, status = 200): {
  ok: boolean;
  status: number;
  text(): Promise<string>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
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

  test('skips loopback engine and loopback Worker', () => {
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'http://127.0.0.1:5002',
        workerEndpoint: 'https://worker.axis.hoox.sh',
        workerApiKey: KEY,
      }),
    ).toBe(false);
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: 'http://127.0.0.1:8787',
        workerApiKey: KEY,
      }),
    ).toBe(false);
  });

  test('skips short keys and non-Worker hosts', () => {
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
  });
});

describe('looksLikeWorkerEndpoint / checkWorkerUrl', () => {
  test('recognizes cloud Worker and wrangler :8787', () => {
    expect(looksLikeWorkerEndpoint('https://worker.axis.hoox.sh')).toBe(true);
    expect(looksLikeWorkerEndpoint('http://127.0.0.1:8787')).toBe(true);
    expect(looksLikeWorkerEndpoint('https://axis.hoox.sh')).toBe(false);
    expect(looksLikeWorkerEndpoint('')).toBe(false);
    expect(looksLikeWorkerEndpoint('https://worker-axis.example.workers.dev')).toBe(true);
    expect(looksLikeWorkerEndpoint('https://x.example/api/onchain/tvl')).toBe(true);
    expect(looksLikeWorkerEndpoint('https://[::1')).toBe(false);
  });

  test('defaults empty to cloud Worker and allows remote by default', () => {
    const r = checkWorkerUrl('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endpoint).toBe(DEFAULT_WORKER_URL);
  });

  test('looks-like Worker allowed without allowRemote; arbitrary remote denied', () => {
    const cloud = checkWorkerUrl('https://worker.axis.hoox.sh', { allowRemote: false });
    expect(cloud.ok).toBe(true);
    const evil = checkWorkerUrl('https://attacker.example', { allowRemote: false });
    expect(evil.ok).toBe(false);
    const opted = checkWorkerUrl('https://attacker.example', { allowRemote: true });
    expect(opted.ok).toBe(true);
  });

  test('can enforce loopback when allowRemote is false (legacy strict path retained for non-worker)', () => {
    const r = checkWorkerUrl('https://api.example.com', { allowRemote: false });
    expect(r.ok).toBe(false);
  });

  test('loopbackHost catch + shouldUseLiveProxy empty worker', () => {
    // Invalid URL is not treated as loopback → proxy still allowed when Worker remote.
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'http://[',
        workerEndpoint: 'https://worker.axis.hoox.sh',
        workerApiKey: KEY,
      }),
    ).toBe(true);
    expect(
      shouldUseLiveProxy({
        engineEndpoint: 'https://pynescript.online',
        workerEndpoint: '',
        workerApiKey: KEY,
      }),
    ).toBe(false);
    expect(looksLikeWorkerEndpoint('https://pynescript-axis.example.com')).toBe(true);
  });
});

describe('worker live URLs', () => {
  test('maps origin to /api/ws/live without the engine key', () => {
    expect(LIVE_TICKET_TTL_S).toBe(60);
    expect(workerLiveHttpUrl('https://worker.axis.hoox.sh/api')).toBe(
      `https://worker.axis.hoox.sh${LIVE_WS_PATH}`,
    );
    expect(workerLiveWsUrl('https://worker.axis.hoox.sh')).toBe(
      `wss://worker.axis.hoox.sh${LIVE_WS_PATH}`,
    );
    expect(workerLiveWsUrl('https://worker.axis.hoox.sh', TICKET)).toBe(
      `wss://worker.axis.hoox.sh${LIVE_WS_PATH}?ticket=${TICKET}`,
    );
    expect(workerLiveWsUrl('http://127.0.0.1:8787', TICKET)).toBe(
      `ws://127.0.0.1:8787${LIVE_WS_PATH}?ticket=${TICKET}`,
    );
    const withTicket = workerLiveWsUrl('https://worker.axis.hoox.sh', TICKET);
    expect(withTicket).not.toContain('api_key');
    expect(withTicket).not.toContain('key=');
    expect(withTicket).not.toContain(KEY);
    expect(withTicket).not.toContain(MCP_BRIDGE_PATH);
    expect(withTicket).toContain('ticket=');
    // Relative / empty base hits the URL catch fallback.
    expect(workerLiveWsUrl('', TICKET)).toContain(`ticket=${TICKET}`);
  });

  test('assertSafeLiveWsUrl rejects key / mcp / pn_ on URL', () => {
    expect(() => assertSafeLiveWsUrl(`wss://w${LIVE_WS_PATH}?ticket=${TICKET}`)).not.toThrow();
    expect(() => assertSafeLiveWsUrl(`wss://w${MCP_BRIDGE_PATH}?ticket=${TICKET}`)).toThrow(
      /mcp\/bridge/i,
    );
    expect(() => assertSafeLiveWsUrl(`wss://w${LIVE_WS_PATH}?key=${KEY}`)).toThrow(/key/i);
    expect(() => assertSafeLiveWsUrl(`wss://w${LIVE_WS_PATH}?ticket=${KEY}`)).toThrow(/pn_/i);
  });
});

describe('mintLiveTicket', () => {
  test('GETs issue=ticket with Bearer and returns a 32-hex nonce', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const ticket = await mintLiveTicket(
      { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
      {
        fetchImpl: async (url, init) => {
          seen.push({
            url,
            auth: init?.headers?.Authorization,
          });
          expect(url).toContain(`${LIVE_WS_PATH}?issue=ticket`);
          expect(url).not.toContain(MCP_BRIDGE_PATH);
          expect(url).not.toContain(KEY);
          return json({ status: 'success', ticket: TICKET, expiresIn: 60 });
        },
      },
    );
    expect(ticket).toBe(TICKET);
    expect(seen).toEqual([
      {
        url: `https://worker.axis.hoox.sh${LIVE_WS_PATH}?issue=ticket`,
        auth: `Bearer ${KEY}`,
      },
    ]);
  });

  test('401 is not retryable; 5xx / 429 are', async () => {
    try {
      await mintLiveTicket(
        { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
        { fetchImpl: async () => json({ status: 'error' }, 401) },
      );
      throw new Error('expected mint to fail');
    } catch (err) {
      expect(isLiveTicketError(err)).toBe(true);
      expect(liveTicketRetryable(err)).toBe(false);
    }
    try {
      await mintLiveTicket(
        { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
        { fetchImpl: async () => json({ status: 'error' }, 503) },
      );
      throw new Error('expected mint to fail');
    } catch (err) {
      expect(liveTicketRetryable(err)).toBe(true);
    }
    try {
      await mintLiveTicket(
        { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
        { fetchImpl: async () => json({ status: 'error' }, 429) },
      );
      throw new Error('expected mint to fail');
    } catch (err) {
      expect(liveTicketRetryable(err)).toBe(true);
    }
  });

  test('rejects missing key, bad shape, and non-JSON / bad ticket', async () => {
    await expect(
      mintLiveTicket({ endpoint: 'https://worker.axis.hoox.sh', apiKey: '' }),
    ).rejects.toBeInstanceOf(LiveTicketError);
    await expect(
      mintLiveTicket({ endpoint: 'https://worker.axis.hoox.sh', apiKey: 'pn_oops' }),
    ).rejects.toThrow(/invalid/i);
    await expect(
      mintLiveTicket(
        { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
        { fetchImpl: async () => json({ status: 'success', ticket: 'nope' }) },
      ),
    ).rejects.toThrow(/missing/i);
    await expect(
      mintLiveTicket(
        { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
        {
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => 'not-json',
          }),
        },
      ),
    ).rejects.toThrow(/JSON/i);
  });

  test('network failure is retryable', async () => {
    try {
      await mintLiveTicket(
        { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
        {
          fetchImpl: async () => {
            throw new Error('offline');
          },
        },
      );
      throw new Error('expected mint to fail');
    } catch (err) {
      expect(liveTicketRetryable(err)).toBe(true);
      expect(String(err)).toMatch(/offline/i);
    }
  });

  test('mint timeout aborts a hung fetch', async () => {
    try {
      await mintLiveTicket(
        { endpoint: 'https://worker.axis.hoox.sh', apiKey: KEY },
        {
          timeoutMs: 20,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              const signal = init?.signal;
              if (!signal) {
                reject(new Error('missing signal'));
                return;
              }
              signal.addEventListener('abort', () => {
                reject(new Error('aborted'));
              });
            }),
        },
      );
      throw new Error('expected mint to fail');
    } catch (err) {
      expect(liveTicketRetryable(err)).toBe(true);
      expect(String(err)).toMatch(/abort/i);
    }
  });
});
