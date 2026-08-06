/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, mock, afterEach } from 'bun:test';
import { handleGitOAuth } from '../src/git-oauth';

const cors = () => ({
  'Access-Control-Allow-Origin': '*',
});

afterEach(() => {
  mock.restore();
});

describe('handleGitOAuth', () => {
  it('rejects non-POST', async () => {
    const res = await handleGitOAuth(
      new Request('http://x/api/git/oauth/device/start', { method: 'GET' }),
      {},
      'http://localhost:3000',
      '/api/git/oauth/device/start',
      cors,
    );
    expect(res.status).toBe(405);
  });

  it('returns NO_CLIENT_ID when unset', async () => {
    const res = await handleGitOAuth(
      new Request('http://x/api/git/oauth/device/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      }),
      {},
      'http://localhost:3000',
      '/api/git/oauth/device/start',
      cors,
    );
    expect(res.status).toBe(400);
    const j = (await res.json()) as { code?: string };
    expect(j.code).toBe('NO_CLIENT_ID');
  });

  it('starts github device flow with env client id', async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('github.com/login/device/code');
      return new Response(
        JSON.stringify({
          device_code: 'dev123',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    // @ts-expect-error test override
    globalThis.fetch = fetchMock;

    const res = await handleGitOAuth(
      new Request('http://x/api/git/oauth/device/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      }),
      { GITHUB_OAUTH_CLIENT_ID: 'Iv1.publicid' },
      'http://localhost:3000',
      '/api/git/oauth/device/start',
      cors,
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { status?: string; user_code?: string; device_code?: string };
    expect(j.status).toBe('success');
    expect(j.user_code).toBe('ABCD-EFGH');
    expect(j.device_code).toBe('dev123');
  });

  it('poll returns pending for authorization_pending', async () => {
    // @ts-expect-error test override
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          error: 'authorization_pending',
          error_description: 'waiting',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await handleGitOAuth(
      new Request('http://x/api/git/oauth/device/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          device_code: 'dev123',
          clientId: 'Iv1.x',
        }),
      }),
      {},
      'http://localhost:3000',
      '/api/git/oauth/device/poll',
      cors,
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { status?: string; error?: string };
    expect(j.status).toBe('pending');
    expect(j.error).toBe('authorization_pending');
  });

  it('poll returns access_token on success', async () => {
    // @ts-expect-error test override
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          access_token: 'gho_secret',
          token_type: 'bearer',
          scope: 'repo',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await handleGitOAuth(
      new Request('http://x/api/git/oauth/device/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          device_code: 'dev123',
          clientId: 'Iv1.x',
        }),
      }),
      {},
      'http://localhost:3000',
      '/api/git/oauth/device/poll',
      cors,
    );
    const j = (await res.json()) as { status?: string; access_token?: string };
    expect(j.status).toBe('success');
    expect(j.access_token).toBe('gho_secret');
  });

  it('gitlab poll strips refresh_token from response', async () => {
    // @ts-expect-error test override
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          access_token: 'gl_oauth_token',
          refresh_token: 'should-not-leak',
          token_type: 'bearer',
          scope: 'api',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await handleGitOAuth(
      new Request('http://x/api/git/oauth/device/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'gitlab',
          device_code: 'dev123',
          clientId: 'appid',
        }),
      }),
      {},
      'http://localhost:3000',
      '/api/git/oauth/device/poll',
      cors,
    );
    const j = (await res.json()) as {
      status?: string;
      access_token?: string;
      refresh_token?: string;
    };
    expect(j.status).toBe('success');
    expect(j.access_token).toBe('gl_oauth_token');
    expect(j.refresh_token).toBeUndefined();
  });

  it('ignores client-supplied scope on start (fixed defaults)', async () => {
    let bodySeen = '';
    // @ts-expect-error test override
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodySeen = String(init?.body || '');
      return new Response(
        JSON.stringify({
          device_code: 'd',
          user_code: 'U',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200 },
      );
    });

    await handleGitOAuth(
      new Request('http://x/api/git/oauth/device/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          clientId: 'Iv1.x',
          scope: 'admin:org delete_repo',
        }),
      }),
      {},
      'http://localhost:3000',
      '/api/git/oauth/device/start',
      cors,
    );
    expect(bodySeen).toContain('repo');
    expect(bodySeen).not.toContain('delete_repo');
  });
});
