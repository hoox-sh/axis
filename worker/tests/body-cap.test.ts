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
 * Every Worker route that accepts a body caps it.
 *
 * The scan found four routes reading a body without the shared cap (or with a
 * hand-rolled copy of it): `/api/keys`, `/api/git/oauth/*`, the MCP bridge
 * invoke and the MCP plane itself.
 */

import { describe, expect, it } from 'bun:test';
import { readCappedJson, readCappedText } from '../src/http';
import { handleKeys } from '../src/keys';
import { handleGitOAuth } from '../src/git-oauth';
import type { Env } from '../src/index';

const origin = 'http://localhost:3000';

function bigBody(bytes: number): string {
  return 'x'.repeat(bytes);
}

describe('readCappedJson / readCappedText', () => {
  it('rejects a body over the cap', async () => {
    const req = new Request('https://a.test/', { method: 'POST', body: bigBody(2048) });
    expect(await readCappedJson(req, 1024)).toEqual({ ok: false });
  });

  it('accepts a body under the cap', async () => {
    const req = new Request('https://a.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    const r = await readCappedJson(req, 1024);
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });

  it('maps an empty body to null', async () => {
    const req = new Request('https://a.test/', { method: 'POST' });
    expect(await readCappedJson(req, 1024)).toEqual({ ok: true, value: null });
  });

  it('maps an unparseable body to null', async () => {
    const req = new Request('https://a.test/', { method: 'POST', body: 'not json' });
    expect(await readCappedJson(req, 1024)).toEqual({ ok: true, value: null });
  });

  it('keeps the raw text for the MCP plane', async () => {
    const req = new Request('https://a.test/', { method: 'POST', body: 'not json' });
    expect(await readCappedText(req, 1024)).toEqual({ ok: true, text: 'not json' });
  });

  it('rejects an over-cap text body', async () => {
    const req = new Request('https://a.test/', { method: 'POST', body: bigBody(2048) });
    expect(await readCappedText(req, 1024)).toEqual({ ok: false });
  });
});

describe('/api/keys body cap', () => {
  it('rejects an over-cap create body with 413', async () => {
    const res = await handleKeys(
      new Request('http://x/api/keys?action=create', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'secret', 'Content-Type': 'application/json' },
        body: bigBody(64 * 1024),
      }),
      { ADMIN_TOKEN: 'secret' } as Env,
      origin,
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('/api/git/oauth body cap', () => {
  it('rejects an over-cap device-flow body with 413', async () => {
    const res = await handleGitOAuth(
      new Request('http://x/api/git/oauth/github/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bigBody(256 * 1024),
      }),
      {} as never,
      origin,
      '/api/git/oauth/github/start',
      () => ({}),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });
});
