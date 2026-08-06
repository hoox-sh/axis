/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, mock, afterEach } from 'bun:test';
import {
  isOAuthProxyBase,
  resolveOAuthProxyBase,
  sanitizeVerificationUri,
  startDeviceFlow,
} from '../src/storage/git-oauth';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
