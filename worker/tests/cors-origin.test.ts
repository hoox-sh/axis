/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * CORS origin selection (`pickOrigin` in `src/index.ts`).
 * Localhost + known product Origins are echoed; arbitrary Origins fall back
 * to ALLOWED_ORIGIN (never open reflection of unknown sites).
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

  it('echoes product AXIS / HOOX / project-scoped Pages origins', () => {
    expect(pickOrigin(req('https://axis.hoox.sh'), env)).toBe('https://axis.hoox.sh');
    expect(pickOrigin(req('https://hoox.sh'), env)).toBe('https://hoox.sh');
    expect(pickOrigin(req('https://pynescript.online'), env)).toBe('https://pynescript.online');
    expect(pickOrigin(req('https://app.pynescript.online'), env)).toBe(
      'https://app.pynescript.online',
    );
    expect(pickOrigin(req('https://feat-onchain-data-plane.pynescript-axis.pages.dev'), env)).toBe(
      'https://feat-onchain-data-plane.pynescript-axis.pages.dev',
    );
    expect(pickOrigin(req('https://pynescript-axis.pages.dev'), env)).toBe(
      'https://pynescript-axis.pages.dev',
    );
  });

  it('does NOT echo the retired pynescript.ai product host', () => {
    // pynescript.ai was retired in favor of pynescript.online. PRODUCT_ORIGIN_RE
    // no longer matches it; the request falls back to the configured ALLOWED_ORIGIN
    // (or the production default), which is pynescript.online.
    expect(pickOrigin(req('https://pynescript.ai'), env)).toBe('https://app.example.com');
    expect(pickOrigin(req('https://app.pynescript.ai'), env)).toBe('https://app.example.com');
  });

  it('does not echo arbitrary *.pages.dev hosts', () => {
    expect(pickOrigin(req('https://evil.pages.dev'), env)).toBe('https://app.example.com');
    expect(pickOrigin(req('https://attacker-app.pages.dev'), env)).toBe('https://app.example.com');
  });

  it('does not treat 0.0.0.0 as local-dev', () => {
    expect(pickOrigin(req('http://0.0.0.0:8081'), env)).toBe('https://app.example.com');
  });

  it('falls back to ALLOWED_ORIGIN for unknown hosts', () => {
    expect(pickOrigin(req('https://evil.example'), env)).toBe('https://app.example.com');
    expect(pickOrigin(req(), env)).toBe('https://app.example.com');
  });

  it('honors comma-separated ALLOWED_ORIGIN list', () => {
    const multi = { ALLOWED_ORIGIN: 'https://a.example,https://b.example' };
    expect(pickOrigin(req('https://b.example'), multi)).toBe('https://b.example');
    expect(pickOrigin(req('https://evil.example'), multi)).toBe('https://a.example');
  });
});
