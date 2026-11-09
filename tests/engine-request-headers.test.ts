// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PWA engine fetch headers: JSON + optional bearer, no custom client marker.
 * `X-AXIS-Client` is not CORS-safelisted and a cached OPTIONS without it
 * blocks `/run` / `/session` / `/health` for 24h.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  AXIS_CLIENT_HEADER,
  BETA_COPY,
  engineHeaders,
} from '../src/engines/request-headers';

describe('engineHeaders', () => {
  it('omits X-AXIS-Client so GET /health stays a simple request', () => {
    const headers = engineHeaders(undefined, false);
    expect(headers[AXIS_CLIENT_HEADER]).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['X-API-Key']).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends JSON content type without a client marker', () => {
    const headers = engineHeaders();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers[AXIS_CLIENT_HEADER]).toBeUndefined();
  });

  it('pairs the API key as X-API-Key and Bearer', () => {
    const headers = engineHeaders('  pn_secret  ');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-API-Key']).toBe('pn_secret');
    expect(headers.Authorization).toBe('Bearer pn_secret');
    expect(headers[AXIS_CLIENT_HEADER]).toBeUndefined();
  });

  it('keeps the open-beta copy for API-key fields', () => {
    expect(BETA_COPY).toContain('Open beta');
  });
});
