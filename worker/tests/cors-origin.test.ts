/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { pickOrigin } from '../src/index';

const env = { ALLOWED_ORIGIN: 'https://app.example.com' };

function req(origin?: string): Request {
  const headers = origin ? { Origin: origin } : undefined;
  return new Request('https://worker.example/api/run', { headers });
}

describe('pickOrigin', () => {
  it('echoes localhost and 127.0.0.1 on any port', () => {
    expect(pickOrigin(req('http://localhost:3000'), env)).toBe('http://localhost:3000');
    expect(pickOrigin(req('http://localhost:8081'), env)).toBe('http://localhost:8081');
    expect(pickOrigin(req('http://127.0.0.1:5173'), env)).toBe('http://127.0.0.1:5173');
    expect(pickOrigin(req('https://localhost'), env)).toBe('https://localhost');
  });

  it('does not treat 0.0.0.0 as local-dev', () => {
    expect(pickOrigin(req('http://0.0.0.0:8081'), env)).toBe('https://app.example.com');
  });

  it('falls back to ALLOWED_ORIGIN for other hosts', () => {
    expect(pickOrigin(req('https://evil.example'), env)).toBe('https://app.example.com');
    expect(pickOrigin(req(), env)).toBe('https://app.example.com');
  });
});
