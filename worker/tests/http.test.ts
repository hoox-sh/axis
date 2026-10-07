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
 * Pins the Worker HTTP helpers against the header sets they replaced, so
 * `worker/src/http.ts` stays a pure refactor of the old per-module copies.
 */

import { describe, expect, it } from 'bun:test';
import {
  API_CORS,
  MARKET_CORS,
  READ_CORS,
  WRITE_CORS,
  clientIp,
  corsHeaders,
  errorBody,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  preflight,
} from '../src/http';

describe('corsHeaders', () => {
  it('defaults to read-only methods with the narrow header set', () => {
    expect(corsHeaders('https://a.test')).toEqual({
      'Access-Control-Allow-Origin': 'https://a.test',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, If-Match',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  });

  it('omits Max-Age when 0 and Vary when false', () => {
    const h = corsHeaders('https://a.test', { maxAge: 0, vary: false });
    expect(h['Access-Control-Max-Age']).toBeUndefined();
    expect(h.Vary).toBeUndefined();
  });

  it('READ_CORS matches the old onchain corsHeaders', () => {
    expect(READ_CORS('https://a.test')).toEqual({
      'Access-Control-Allow-Origin': 'https://a.test',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, If-Match',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  });

  it('MARKET_CORS adds the signed-exchange headers', () => {
    const h = MARKET_CORS('https://a.test');
    expect(h['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(h['Access-Control-Allow-Headers']).toBe(
      'Content-Type, Authorization, X-Admin-Token, If-Match, X-Exchange-Key, X-Exchange-Secret, X-Exchange-Passphrase',
    );
  });

  it('WRITE_CORS uses mutating methods without exchange headers', () => {
    const h = WRITE_CORS('https://a.test');
    expect(h['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(h['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization, X-Admin-Token, If-Match');
  });

  it('API_CORS includes the MCP replay headers', () => {
    const h = API_CORS('https://a.test');
    expect(h['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(h['Access-Control-Allow-Headers']).toBe(
      'Content-Type, Authorization, X-Admin-Token, If-Match, X-Exchange-Key, X-Exchange-Secret, X-Exchange-Passphrase, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
    );
  });
});

describe('jsonResponse', () => {
  it('serializes the body and sets a JSON content type', async () => {
    const res = jsonResponse({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('adds CORS only when both origin and cors are supplied', () => {
    expect(jsonResponse({}, { origin: 'https://a.test' }).headers.get('Access-Control-Allow-Origin')).toBeNull();
    const withCors = jsonResponse({}, { origin: 'https://a.test', cors: API_CORS });
    expect(withCors.headers.get('Access-Control-Allow-Origin')).toBe('https://a.test');
    expect(withCors.headers.get('Vary')).toBe('Origin');
  });

  it('lets caller headers override CORS defaults', () => {
    const res = jsonResponse({}, { origin: 'https://a.test', cors: API_CORS, headers: { 'X-Test': '1' } });
    expect(res.headers.get('X-Test')).toBe('1');
  });
});

describe('error envelope', () => {
  it('omits message when undefined', () => {
    expect(errorBody('NO_KEY')).toEqual({ status: 'error', code: 'NO_KEY' });
    expect(errorBody('NO_KEY', 'api_key required')).toEqual({
      status: 'error',
      code: 'NO_KEY',
      message: 'api_key required',
    });
  });

  it('defaults to 400 and carries CORS', async () => {
    const res = errorResponse('NO_KEY', 'api_key required', { origin: 'https://a.test', cors: READ_CORS });
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://a.test');
    expect(await res.json()).toEqual({ status: 'error', code: 'NO_KEY', message: 'api_key required' });
  });

  it('methodNotAllowed is a 405 with Allow', async () => {
    const res = methodNotAllowed('GET', { origin: 'https://a.test', cors: READ_CORS });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(await res.json()).toEqual({ status: 'error', code: 'METHOD', message: 'GET required' });
  });
});

describe('preflight', () => {
  it('is a bare 204 carrying only CORS headers', () => {
    const res = preflight(READ_CORS, 'https://a.test');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://a.test');
    expect(res.headers.get('Content-Type')).toBeNull();
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string>) => new Request('https://a.test/', { headers });

  it('prefers cf-connecting-ip', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1');
  });

  it('falls back to the left-most x-forwarded-for entry', () => {
    expect(clientIp(req({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }))).toBe('2.2.2.2');
  });

  it('returns unknown when no proxy headers are present', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});