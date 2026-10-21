// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared Worker error envelope (A8).
 *
 * Two things are pinned here:
 *
 * 1. `handleError` never reflects the error text to the caller — it logs
 *    server-side and answers with the canonical 500 envelope.
 * 2. The entry `fetch` wraps **every** route, including the MCP, bridge and
 *    stream upgrade paths that used to sit outside the try/catch. A handler
 *    that throws now answers 500 instead of escaping as an unhandled
 *    rejection.
 */

import { describe, expect, it } from 'bun:test';
import { API_CORS, handleError } from '../src/http';
import worker from '../src/index';
import type { Env } from '../src/index';

const origin = 'https://axis.test';

describe('handleError', () => {
  it('answers the canonical 500 envelope', async () => {
    const res = handleError(new Error('secret internal detail'), { path: '/api/run' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; code: string; message: string };
    expect(body.status).toBe('error');
    expect(body.code).toBe('INTERNAL');
    expect(body.message).toBe('internal error');
  });

  it('never reflects the error text to the caller', async () => {
    const res = handleError(new Error('secret internal detail'));
    const text = await res.text();
    expect(text).not.toContain('secret internal detail');
  });

  it('accepts a non-Error throw', async () => {
    const res = handleError('boom');
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('INTERNAL');
  });

  it('applies the CORS header set when an origin is given', async () => {
    const res = handleError(new Error('boom'), { origin, cors: API_CORS });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });
});

describe('entry fetch error scope', () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  it('protects the MCP bridge path with the shared envelope', async () => {
    // A throwing MCP_BRIDGE binding used to escape the entry try/catch.
    const env = {
      MCP_BRIDGE: {
        idFromName: () => {
          throw new Error('bridge exploded');
        },
      },
    } as unknown as Env;

    const res = await worker.fetch(
      new Request('https://axis.test/api/mcp/bridge', {
        headers: { Authorization: 'Bearer pn_' + 'cd'.repeat(24) },
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('INTERNAL');
    expect(body.message).toBe('internal error');
  });

  it('protects the stream path with the shared envelope', async () => {
    const env = {
      SESSIONS: {
        idFromName: () => {
          throw new Error('session exploded');
        },
      },
    } as unknown as Env;

    const res = await worker.fetch(new Request('https://axis.test/api/stream'), env, ctx);

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('INTERNAL');
  });

  it('still answers a plain 404 for an unknown path', async () => {
    const res = await worker.fetch(new Request('https://axis.test/nope'), {} as Env, ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });
});
