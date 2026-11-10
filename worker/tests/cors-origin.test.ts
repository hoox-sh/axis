/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * CORS origin selection (`pickOrigin` in `src/index.ts`).
 * Localhost + known product Origins are echoed. Arbitrary Origins omit
 * Access-Control-Allow-Origin (empty string) instead of a default host.
 */

import { describe, expect, it } from 'bun:test';
import { pickOrigin } from '../src/index';

const env = { ALLOWED_ORIGIN: 'https://app.example.com' };

function req(origin?: string): Request {
  const headers = origin ? { Origin: origin } : undefined;
  return new Request('https://worker.example/api/run', { headers });
}

describe('pickOrigin', () => {
  it('echoes localhost and 127.0.0.1 when no explicit allowlist is set (local dev)', () => {
    const open = {};
    expect(pickOrigin(req('http://localhost:3000'), open)).toBe('http://localhost:3000');
    expect(pickOrigin(req('http://localhost:8081'), open)).toBe('http://localhost:8081');
    expect(pickOrigin(req('http://127.0.0.1:5173'), open)).toBe('http://127.0.0.1:5173');
    expect(pickOrigin(req('https://localhost'), open)).toBe('https://localhost');
  });

  it('does not bypass an explicit ALLOWED_ORIGIN with localhost (A19)', () => {
    expect(pickOrigin(req('http://localhost:3000'), env)).toBe('');
  });

  it('echoes localhost when explicitly listed in ALLOWED_ORIGIN', () => {
    const listed = { ALLOWED_ORIGIN: 'https://app.example.com,http://localhost:3000' };
    expect(pickOrigin(req('http://localhost:3000'), listed)).toBe('http://localhost:3000');
    expect(pickOrigin(req('http://localhost:8081'), listed)).toBe('');
  });

  it('echoes product AXIS / HOOX / project-scoped Pages origins', () => {
    expect(pickOrigin(req('https://axis.hoox.sh'), env)).toBe('https://axis.hoox.sh');
    expect(pickOrigin(req('https://hoox.sh'), env)).toBe('https://hoox.sh');
    expect(pickOrigin(req('https://pynescript.online'), env)).toBe('https://pynescript.online');
    expect(pickOrigin(req('https://app.pynescript.online'), env)).toBe(
      'https://app.pynescript.online',
    );
    expect(pickOrigin(req('https://feat-onchain-data-plane.axis.pages.dev'), env)).toBe(
      'https://feat-onchain-data-plane.axis.pages.dev',
    );
    expect(pickOrigin(req('https://axis.pages.dev'), env)).toBe('https://axis.pages.dev');
    expect(pickOrigin(req('https://feat-onchain-data-plane.pynescript-axis.pages.dev'), env)).toBe(
      'https://feat-onchain-data-plane.pynescript-axis.pages.dev',
    );
    expect(pickOrigin(req('https://pynescript-axis.pages.dev'), env)).toBe(
      'https://pynescript-axis.pages.dev',
    );
  });

  it('does NOT echo the retired pynescript.ai product host', () => {
    // pynescript.ai was retired. It is not echoed and does not get a default ACAO.
    expect(pickOrigin(req('https://pynescript.ai'), env)).toBe('');
    expect(pickOrigin(req('https://app.pynescript.ai'), env)).toBe('');
  });

  it('does not echo arbitrary *.pages.dev hosts', () => {
    expect(pickOrigin(req('https://evil.pages.dev'), env)).toBe('');
    expect(pickOrigin(req('https://attacker-app.pages.dev'), env)).toBe('');
  });

  it('does not treat 0.0.0.0 as local-dev', () => {
    expect(pickOrigin(req('http://0.0.0.0:8081'), env)).toBe('');
  });

  it('omits an allow-origin for unknown or missing hosts', () => {
    expect(pickOrigin(req('https://evil.example'), env)).toBe('');
    expect(pickOrigin(req(), env)).toBe('');
  });

  it('honors comma-separated ALLOWED_ORIGIN list', () => {
    const multi = { ALLOWED_ORIGIN: 'https://a.example,https://b.example' };
    expect(pickOrigin(req('https://b.example'), multi)).toBe('https://b.example');
    expect(pickOrigin(req('https://evil.example'), multi)).toBe('');
  });
});
