/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, mock, afterEach } from 'bun:test';
import {
  defaultVerificationUri,
  fetchGitUser,
  isOAuthProxyBase,
  pollDeviceFlow,
  resolveOAuthProxyBase,
  sanitizeVerificationUri,
  startDeviceFlow,
  waitForDeviceToken,
} from '../src/storage/git-oauth';
import { installMemoryLocalStorage } from './setup';

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalWindow = (globalThis as unknown as { window?: unknown }).window;

function setWindowOrigin(origin: string | undefined) {
  const g = globalThis as unknown as { window: Record<string, unknown> };
  if (!g.window || typeof g.window !== 'object') {
    (globalThis as unknown as { window: unknown }).window = {};
  }
  const w = (globalThis as unknown as { window: Record<string, unknown> }).window;
  if (origin === undefined) {
    delete w['location'];
  } else {
    w['location'] = { origin };
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  (globalThis as unknown as { window?: unknown }).window = originalWindow;
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetchSequence(responses: Response[] | ((url: string) => Response)) {
  let calls = 0;
  const callsUrls: string[] = [];
  globalThis.fetch = mock(async (url: unknown) => {
    calls += 1;
    callsUrls.push(String(url));
    if (typeof responses === 'function') return responses(String(url));
    return responses[Math.min(calls - 1, responses.length - 1)];
  }) as unknown as typeof fetch;
  return { calls: () => calls, urls: () => callsUrls };
}

describe('isOAuthProxyBase', () => {
  it('accepts Worker and Pro API hosts', () => {
    expect(isOAuthProxyBase('https://x.workers.dev')).toBe(true);
    expect(isOAuthProxyBase('http://127.0.0.1:8787')).toBe(true);
    expect(isOAuthProxyBase('http://162.254.38.194:5002')).toBe(true);
    expect(isOAuthProxyBase('http://127.0.0.1:5002')).toBe(true);
    expect(isOAuthProxyBase('https://axis.hoox.sh')).toBe(true);
  });

  it('rejects empty / unrelated / forges', () => {
    expect(isOAuthProxyBase('')).toBe(false);
    expect(isOAuthProxyBase('http://162.254.38.194:8081')).toBe(false);
    expect(isOAuthProxyBase('https://evil.example')).toBe(false);
    expect(isOAuthProxyBase('https://github.com')).toBe(false);
    expect(isOAuthProxyBase('https://gitlab.com')).toBe(false);
  });

  it('accepts same-origin when provided', () => {
    expect(
      isOAuthProxyBase('https://app.example', { sameOrigin: 'https://app.example' }),
    ).toBe(true);
    expect(
      isOAuthProxyBase('https://other.example', { sameOrigin: 'https://app.example' }),
    ).toBe(false);
  });

  it('accepts pyne/pine worker hosts and product domains', () => {
    expect(isOAuthProxyBase('https://pyne-worker.example.workers.dev')).toBe(true);
    expect(isOAuthProxyBase('https://pine-worker.hoox.sh')).toBe(true);
    expect(isOAuthProxyBase('https://pynescript.online')).toBe(true);
    expect(isOAuthProxyBase('HTTPS://GITHUB.COM/login/device')).toBe(false);
  });

  it('accepts /api suffix path', () => {
    expect(isOAuthProxyBase('https://app.example/api')).toBe(true);
    expect(isOAuthProxyBase('https://app.example/api/')).toBe(true);
  });

  it('ignores invalid sameOrigin without throwing', () => {
    expect(isOAuthProxyBase('https://evil.example', { sameOrigin: '::::' })).toBe(false);
  });

  it('returns false for malformed URL (outer catch)', () => {
    expect(isOAuthProxyBase('://bad-url')).toBe(false);
  });

  it('accepts window same-origin page (Pages + Worker route)', () => {
    setWindowOrigin('https://app.example');
    expect(isOAuthProxyBase('https://app.example/some/path')).toBe(true);
    expect(isOAuthProxyBase('https://other.example/some/path')).toBe(false);
    setWindowOrigin(undefined);
  });
});

describe('resolveOAuthProxyBase', () => {
  it('keeps explicit endpoint', () => {
    expect(resolveOAuthProxyBase('http://162.254.38.194:5002/')).toBe(
      'http://162.254.38.194:5002',
    );
  });

  it('defaults to local wrangler without window', () => {
    expect(resolveOAuthProxyBase()).toBe('http://127.0.0.1:8787');
  });

  it('prefers local Worker on localhost pages', () => {
    setWindowOrigin('http://localhost:3000');
    expect(resolveOAuthProxyBase()).toBe('http://127.0.0.1:8787');
    setWindowOrigin('http://127.0.0.1:3000');
    expect(resolveOAuthProxyBase()).toBe('http://127.0.0.1:8787');
    setWindowOrigin(undefined);
  });

  it('prefers Pro API on static VPS shell origins (:8080/:8081)', () => {
    setWindowOrigin('http://192.168.1.10:8080');
    expect(resolveOAuthProxyBase()).toBe('http://127.0.0.1:5002');
    setWindowOrigin('http://192.168.1.10:8081');
    expect(resolveOAuthProxyBase()).toBe('http://127.0.0.1:5002');
    setWindowOrigin(undefined);
  });

  it('returns page origin for normal hosts', () => {
    setWindowOrigin('https://app.example');
    expect(resolveOAuthProxyBase()).toBe('https://app.example');
    setWindowOrigin(undefined);
  });
});

describe('sanitizeVerificationUri', () => {
  it('allows github/gitlab device hosts only', () => {
    expect(sanitizeVerificationUri('https://github.com/login/device', 'github')).toContain(
      'github.com',
    );
    expect(sanitizeVerificationUri('https://evil.example/phish', 'github')).toBeNull();
    expect(sanitizeVerificationUri('javascript:alert(1)', 'github')).toBeNull();
    expect(sanitizeVerificationUri('https://gitlab.com/-/profile', 'gitlab')).toContain(
      'gitlab.com',
    );
  });

  it('returns null for empty and unparsable URIs', () => {
    expect(sanitizeVerificationUri('', 'github')).toBeNull();
    expect(sanitizeVerificationUri('   ', 'gitlab')).toBeNull();
    expect(sanitizeVerificationUri('not a url ::::', 'github')).toBeNull();
  });

  it('allows www.github.com and http github URIs', () => {
    expect(
      sanitizeVerificationUri('https://www.github.com/login/device', 'github'),
    ).toContain('github.com');
    expect(
      sanitizeVerificationUri('http://github.com/login/device', 'github'),
    ).toContain('github.com');
  });

  it('allows gitlab subdomains, rejects random hosts', () => {
    expect(
      sanitizeVerificationUri('https://foo.gitlab.com/oauth/authorize', 'gitlab'),
    ).toContain('gitlab.com');
    expect(sanitizeVerificationUri('https://evil.example/phish', 'gitlab')).toBeNull();
    expect(sanitizeVerificationUri('ftp://gitlab.com/x', 'gitlab')).toBeNull();
  });
});

describe('defaultVerificationUri', () => {
  it('returns forge device pages per provider', () => {
    expect(defaultVerificationUri('github')).toContain('github.com/login/device');
    expect(defaultVerificationUri('gitlab')).toContain('gitlab.com');
  });
});

describe('startDeviceFlow proxy trust', () => {
  it('refuses untrusted workerEndpoint before network', async () => {
    await expect(
      startDeviceFlow({
        provider: 'github',
        workerEndpoint: 'https://evil.example',
        clientId: 'Iv1.x',
      }),
    ).rejects.toThrow(/not trusted/);
  });

  it('sanitizes evil verification_uri from trusted proxy', async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          device_code: 'd',
          user_code: 'U-CODE',
          verification_uri: 'https://evil.example/phish',
          verification_uri_complete: 'https://evil.example/phish?user_code=U',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const started = await startDeviceFlow({
      provider: 'github',
      workerEndpoint: 'http://127.0.0.1:8787',
      clientId: 'Iv1.x',
    });
    expect(started.user_code).toBe('U-CODE');
    expect(started.verification_uri).toContain('github.com');
    expect(started.verification_uri_complete).toBeUndefined();
  });
});

describe('startDeviceFlow token exchange', () => {
  it('returns trusted URIs and clamps interval/expiry defaults', async () => {
    mockFetchSequence([
      json({
        device_code: 'dc-1',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-1234',
        expires_in: 900,
        interval: 5,
      }),
    ]);
    const started = await startDeviceFlow({
      provider: 'github',
      workerEndpoint: 'http://127.0.0.1:8787',
    });
    expect(started.device_code).toBe('dc-1');
    expect(started.verification_uri).toContain('github.com/login/device');
    expect(started.verification_uri_complete).toContain('user_code=ABCD-1234');
    expect(started.expires_in).toBe(900);
    expect(started.interval).toBe(5);
  });

  it('falls back to defaults when payload omits expiry/interval/uris', async () => {
    mockFetchSequence([
      json({
        device_code: 'dc-2',
        user_code: 'WXYZ-9999',
        expires_in: 0,
        interval: 0,
      }),
    ]);
    const started = await startDeviceFlow({
      provider: 'gitlab',
      workerEndpoint: 'http://127.0.0.1:5002',
    });
    expect(started.verification_uri).toContain('gitlab.com');
    expect(started.verification_uri_complete).toBeUndefined();
    expect(started.expires_in).toBe(900);
    expect(started.interval).toBe(5);
  });

  it('throws on incomplete payload', async () => {
    mockFetchSequence([json({ status: 'success', user_code: 'ONLY-USER' })]);
    await expect(
      startDeviceFlow({
        provider: 'github',
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/incomplete payload/);
  });

  it('throws incomplete on non-JSON 200 body (json catch path)', async () => {
    globalThis.fetch = mock(
      async () => new Response('not-json', { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      startDeviceFlow({
        provider: 'github',
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/incomplete payload/);
  });
});

describe('git-oauth proxy errors', () => {
  it('wraps fetch network failure as unreachable proxy', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('boom-net');
    }) as unknown as typeof fetch;
    await expect(
      startDeviceFlow({
        provider: 'github',
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/Cannot reach OAuth proxy.*boom-net/);
  });

  it('maps 404 / NOT_FOUND to missing-proxy hint', async () => {
    mockFetchSequence([json({ code: 'NOT_FOUND', message: 'not found' }, 404)]);
    await expect(
      startDeviceFlow({
        provider: 'github',
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/OAuth proxy missing/);
  });

  it('maps NO_CLIENT_ID to client-id hint', async () => {
    mockFetchSequence([
      json({ code: 'NO_CLIENT_ID', message: 'missing client id' }, 400),
    ]);
    await expect(
      startDeviceFlow({
        provider: 'github',
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/public OAuth App client id/);
  });

  it('passes through generic error message', async () => {
    mockFetchSequence([json({ message: 'upstream boom' }, 500)]);
    await expect(
      startDeviceFlow({
        provider: 'github',
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/upstream boom/);
  });

  it('treats 200 with status=error as failure', async () => {
    mockFetchSequence([json({ status: 'error', message: 'bad device code' }, 200)]);
    await expect(
      pollDeviceFlow({
        provider: 'github',
        deviceCode: 'dc-1',
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/bad device code/);
  });
});

describe('pollDeviceFlow', () => {
  it('returns success token with metadata', async () => {
    mockFetchSequence([
      json({ access_token: 'tok-123', token_type: 'bearer', scope: 'repo' }),
    ]);
    const r = await pollDeviceFlow({
      provider: 'github',
      deviceCode: 'dc-1',
      workerEndpoint: 'http://127.0.0.1:8787',
    });
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.access_token).toBe('tok-123');
      expect(r.token_type).toBe('bearer');
      expect(r.scope).toBe('repo');
      expect(r.provider).toBe('github');
    }
  });

  it('treats status=success without token as success with empty token', async () => {
    mockFetchSequence([json({ status: 'success' })]);
    const r = await pollDeviceFlow({
      provider: 'gitlab',
      deviceCode: 'dc-9',
      workerEndpoint: 'http://127.0.0.1:8787',
    });
    expect(r.status).toBe('success');
  });

  it('returns pending payload with error/interval passthrough', async () => {
    mockFetchSequence([
      json({
        error: 'authorization_pending',
        error_description: 'waiting for user',
        interval: 7,
      }),
    ]);
    const r = await pollDeviceFlow({
      provider: 'github',
      deviceCode: 'dc-2',
      workerEndpoint: 'http://127.0.0.1:8787',
    });
    expect(r.status).toBe('pending');
    if (r.status === 'pending') {
      expect(r.error).toBe('authorization_pending');
      expect(r.error_description).toBe('waiting for user');
      expect(r.interval).toBe(7);
    }
  });

  it('defaults pending error when payload is empty', async () => {
    mockFetchSequence([json({})]);
    const r = await pollDeviceFlow({
      provider: 'github',
      deviceCode: 'dc-3',
      workerEndpoint: 'http://127.0.0.1:8787',
    });
    if (r.status === 'pending') expect(r.error).toBe('authorization_pending');
    else throw new Error('expected pending');
  });
});

describe('waitForDeviceToken', () => {
  it('resolves on first success and persists token to memory storage', async () => {
    mockFetchSequence([json({ access_token: 'tok-first' })]);
    const token = await waitForDeviceToken({
      provider: 'github',
      deviceCode: 'dc-ok',
      intervalSec: 1,
      expiresInSec: 60,
      workerEndpoint: 'http://127.0.0.1:8787',
    });
    expect(token).toBe('tok-first');
    const mem = installMemoryLocalStorage();
    mem.setItem('axis.git.token', token);
    expect(mem.getItem('axis.git.token')).toBe('tok-first');
  });

  it('backs off on slow_down then resolves and calls onTick', async () => {
    mockFetchSequence([
      json({ error: 'slow_down', error_description: 'slow down please' }),
      json({ access_token: 'tok-after-slow' }),
    ]);
    const ticks: Array<{ error: string }> = [];
    const token = await waitForDeviceToken({
      provider: 'github',
      deviceCode: 'dc-slow',
      intervalSec: 1,
      expiresInSec: 60,
      workerEndpoint: 'http://127.0.0.1:8787',
      onTick: (t) => {
        ticks.push(t);
      },
    });
    expect(token).toBe('tok-after-slow');
    expect(ticks.length).toBe(1);
    expect(ticks[0]?.error).toBe('slow_down');
  });

  it('keeps polling on authorization_pending then resolves', async () => {
    mockFetchSequence([
      json({ error: 'authorization_pending' }),
      json({ access_token: 'tok-pending-ok' }),
    ]);
    const token = await waitForDeviceToken({
      provider: 'github',
      deviceCode: 'dc-pending',
      intervalSec: 1,
      expiresInSec: 60,
      workerEndpoint: 'http://127.0.0.1:8787',
    });
    expect(token).toBe('tok-pending-ok');
  });

  it('throws terminal error with description', async () => {
    mockFetchSequence([
      json({ error: 'access_denied', error_description: 'user denied access' }),
    ]);
    await expect(
      waitForDeviceToken({
        provider: 'github',
        deviceCode: 'dc-denied',
        intervalSec: 1,
        expiresInSec: 60,
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/user denied access/);
  });

  it('throws terminal error fallback without description', async () => {
    mockFetchSequence([json({ error: 'expired_token' })]);
    await expect(
      waitForDeviceToken({
        provider: 'github',
        deviceCode: 'dc-exp',
        intervalSec: 1,
        expiresInSec: 60,
        workerEndpoint: 'http://127.0.0.1:8787',
      }),
    ).rejects.toThrow(/Authorization failed: expired_token/);
  });

  it('throws when already aborted before polling', async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      waitForDeviceToken({
        provider: 'github',
        deviceCode: 'dc-abort',
        intervalSec: 1,
        expiresInSec: 60,
        workerEndpoint: 'http://127.0.0.1:8787',
        signal: c.signal,
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it('throws when abort fires during sleep', async () => {
    mockFetchSequence([json({ access_token: 'tok-never' })]);
    const c = new AbortController();
    setTimeout(() => c.abort(), 100);
    await expect(
      waitForDeviceToken({
        provider: 'github',
        deviceCode: 'dc-abort-sleep',
        intervalSec: 1,
        expiresInSec: 60,
        workerEndpoint: 'http://127.0.0.1:8787',
        signal: c.signal,
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it('treats empty-token success as unknown tick then resolves', async () => {
    mockFetchSequence([json({ status: 'success' }), json({ access_token: 'tok-2' })]);
    // Poll sleeps max(1000, interval) between rounds — fire immediately so the
    // full-suite run (coverage instrumentation) never hits the 5s test timeout.
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((
      fn: (...a: unknown[]) => void,
    ) => realSetTimeout(fn, 0)) as unknown as typeof setTimeout;
    try {
      const seen: string[] = [];
      const token = await waitForDeviceToken({
        provider: 'github',
        deviceCode: 'dc-empty-then-ok',
        intervalSec: 1,
        expiresInSec: 60,
        workerEndpoint: 'http://127.0.0.1:8787',
        onTick: (t) => {
          seen.push(t.error);
        },
      });
      expect(token).toBe('tok-2');
      expect(seen).toContain('unknown');
    } finally {
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
    }
  });

  it('times out when deadline passes', async () => {
    mockFetchSequence([json({ error: 'authorization_pending' })]);
    const start = originalDateNow();
    let now = start;
    Date.now = () => now;
    // Advance clock on every timer so the poll loop exits quickly.
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((
      fn: (...a: unknown[]) => void,
      ms?: number,
    ) => {
      now += (ms ?? 0) + 60_000;
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout;
    try {
      await expect(
        waitForDeviceToken({
          provider: 'github',
          deviceCode: 'dc-timeout',
          intervalSec: 1,
          expiresInSec: 30,
          workerEndpoint: 'http://127.0.0.1:8787',
        }),
      ).rejects.toThrow(/timed out/);
    } finally {
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
      Date.now = originalDateNow;
    }
  });
});

describe('fetchGitUser', () => {
  it('resolves github user with full profile', async () => {
    mockFetchSequence([
      json({ login: 'octo', name: 'Octo Cat', html_url: 'https://github.com/octo' }),
    ]);
    const u = await fetchGitUser('github', 'tok-1');
    expect(u.login).toBe('octo');
    expect(u.name).toBe('Octo Cat');
    expect(u.htmlUrl).toBe('https://github.com/octo');
  });

  it('resolves github user with minimal profile and custom base', async () => {
    const seen: string[] = [];
    globalThis.fetch = mock(async (url: unknown) => {
      seen.push(String(url));
      return json({ login: 'min' });
    }) as unknown as typeof fetch;
    const u = await fetchGitUser('github', 'tok-2', 'https://ghe.example/api/v3/');
    expect(u.login).toBe('min');
    expect(u.name).toBeUndefined();
    expect(u.htmlUrl).toBeUndefined();
    expect(seen[0]).toContain('https://ghe.example/api/v3/user');
  });

  it('throws on github /user failure', async () => {
    mockFetchSequence([json({ message: 'bad' }, 401)]);
    await expect(fetchGitUser('github', 'bad-tok')).rejects.toThrow(/GitHub \/user failed/);
  });

  it('resolves gitlab user with full profile', async () => {
    mockFetchSequence([
      json({ username: 'gl-user', name: 'GL User', web_url: 'https://gitlab.com/gl-user' }),
    ]);
    const u = await fetchGitUser('gitlab', 'tok-gl');
    expect(u.login).toBe('gl-user');
    expect(u.name).toBe('GL User');
    expect(u.htmlUrl).toBe('https://gitlab.com/gl-user');
  });

  it('resolves gitlab user with minimal profile', async () => {
    mockFetchSequence([json({})]);
    const u = await fetchGitUser('gitlab', 'tok-gl2');
    expect(u.login).toBe('');
    expect(u.name).toBeUndefined();
    expect(u.htmlUrl).toBeUndefined();
  });

  it('throws on gitlab /user failure', async () => {
    mockFetchSequence([json({ message: 'nope' }, 403)]);
    await expect(fetchGitUser('gitlab', 'bad-tok')).rejects.toThrow(/GitLab \/user failed/);
  });
});
