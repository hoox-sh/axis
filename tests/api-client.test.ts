// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared HTTP client primitives.
 *
 * The point of these is that a failure carries a **status code**, not just a
 * status inside an error message — a caller can branch on a 404 without
 * parsing a string.
 */

import { describe, expect, it } from 'bun:test';
import { HttpError, fetchJson, httpError, readJsonBody } from '../src/api/client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('readJsonBody', () => {
  it('parses a JSON object', async () => {
    expect(await readJsonBody(json({ a: 1 }))).toEqual({ a: 1 });
  });

  it('tolerates an empty body', async () => {
    expect(await readJsonBody(new Response(''))).toEqual({});
  });

  it('tolerates a non-JSON body', async () => {
    const res = new Response('<!doctype html><html>502</html>');
    expect(await readJsonBody(res)).toEqual({});
  });

  it('tolerates a JSON array', async () => {
    expect(await readJsonBody(json([1, 2]))).toEqual({});
  });
});

describe('httpError', () => {
  it('carries the status code', async () => {
    const err = await httpError(json({ message: 'nope' }, 404));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('nope');
  });

  it('labels the message when the body has none', async () => {
    const err = await httpError(new Response('', { status: 429 }), { label: 'Venue' });
    expect(err.status).toBe(429);
    expect(err.message).toBe('Venue HTTP 429');
  });

  it('carries a machine-readable code when the body has one', async () => {
    const err = await httpError(json({ code: 'RATE', message: 'slow down' }, 429));
    expect(err.code).toBe('RATE');
  });
});

describe('fetchJson', () => {
  it('reads the body of a 2xx response', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => json({ ok: true })) as typeof fetch;
    try {
      const r = await fetchJson('https://x.test/thing');
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws an HttpError carrying the status on a non-2xx', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => json({ message: 'gone' }, 404)) as typeof fetch;
    try {
      await expect(fetchJson('https://x.test/thing')).rejects.toThrow(HttpError);
      await fetchJson('https://x.test/thing').catch((e: unknown) => {
        expect((e as HttpError).status).toBe(404);
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('honours the timeout option', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    try {
      await expect(fetchJson('https://x.test/slow', {}, { timeoutMs: 10 })).rejects.toThrow();
    } finally {
      globalThis.fetch = original;
    }
  });
});
