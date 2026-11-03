// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  BAD_ENDPOINT_SCHEME,
  REMOTE_ENDPOINT_DENIED,
  checkEngineEndpoint,
  checkHttpBaseUrl,
} from './endpoint';

describe('checkEngineEndpoint', () => {
  test('defaults empty to loopback Pro URL', () => {
    const r = checkEngineEndpoint('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endpoint).toBe('http://127.0.0.1:5002');
  });

  test('allows localhost / ::1', () => {
    expect(checkEngineEndpoint('http://localhost:5002').ok).toBe(true);
    expect(checkEngineEndpoint('http://[::1]:5002').ok).toBe(true);
  });

  test('denies remote by default', () => {
    const r = checkEngineEndpoint('https://api.example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(REMOTE_ENDPOINT_DENIED);
  });

  test('allows remote when opted in', () => {
    const r = checkEngineEndpoint('https://api.example.com', { allowRemote: true });
    expect(r.ok).toBe(true);
  });

  test('rejects non-http schemes', () => {
    const r = checkEngineEndpoint('file:///tmp');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(BAD_ENDPOINT_SCHEME);
  });

  test('rejects unparseable URLs', () => {
    const r = checkEngineEndpoint('not a url');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a valid URL/i);
  });

  test('outer catch on hostile input', () => {
    const hostile = {
      toString() {
        throw new Error('boom');
      },
    };
    const r = checkEngineEndpoint(hostile as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/failed|boom/i);
  });

  test('checkHttpBaseUrl gates datafeed-style URLs', () => {
    const denied = checkHttpBaseUrl('https://feed.example.com', {
      defaultUrl: 'http://127.0.0.1:5003',
      label: 'datafeed',
    });
    expect(denied.ok).toBe(false);
    const ok = checkHttpBaseUrl('https://feed.example.com', {
      defaultUrl: 'http://127.0.0.1:5003',
      label: 'datafeed',
      allowRemote: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.endpoint).toBe('https://feed.example.com');
  });

  test('checkHttpBaseUrl rejects non-http schemes for non-engine labels', () => {
    const r = checkHttpBaseUrl('file:///tmp/feed', {
      defaultUrl: 'http://127.0.0.1:5003',
      label: 'datafeed',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/http: or https:/i);
  });
});
