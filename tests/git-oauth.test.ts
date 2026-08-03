/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  isOAuthProxyBase,
  resolveOAuthProxyBase,
} from '../src/storage/git-oauth';

describe('isOAuthProxyBase', () => {
  it('accepts Worker and Pro API hosts', () => {
    expect(isOAuthProxyBase('https://x.workers.dev')).toBe(true);
    expect(isOAuthProxyBase('http://127.0.0.1:8787')).toBe(true);
    expect(isOAuthProxyBase('http://162.254.38.194:5002')).toBe(true);
    expect(isOAuthProxyBase('http://127.0.0.1:5002')).toBe(true);
  });

  it('rejects empty / unrelated', () => {
    expect(isOAuthProxyBase('')).toBe(false);
    expect(isOAuthProxyBase('http://162.254.38.194:8081')).toBe(false);
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
