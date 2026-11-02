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

import { DEFAULT_ENGINE_ENDPOINT } from './engine-http';

export const REMOTE_ENDPOINT_DENIED =
  'AXIS engine endpoint must be loopback (127.0.0.1 / localhost / ::1) unless axis.engine.allowRemoteEndpoint is enabled.';

export const BAD_ENDPOINT_SCHEME =
  'AXIS engine endpoint must use http: or https:.';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export type EndpointCheck =
  | { ok: true; endpoint: string }
  | { ok: false; error: string };

/**
 * Normalize and gate the Pro engine base URL.
 * Default: loopback only (Bearer key must not leave the machine without opt-in).
 */
export function checkEngineEndpoint(
  raw: string | undefined | null,
  opts?: { allowRemote?: boolean },
): EndpointCheck {
  try {
    const trimmed = String(raw ?? '')
      .trim()
      .replace(/\/+$/, '');
    const endpoint = trimmed || DEFAULT_ENGINE_ENDPOINT;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return { ok: false, error: `AXIS engine endpoint is not a valid URL: ${endpoint}` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: BAD_ENDPOINT_SCHEME };
    }
    const host = (url.hostname || '').toLowerCase();
    const loopback = LOOPBACK_HOSTS.has(host);
    if (!loopback && opts?.allowRemote !== true) {
      return { ok: false, error: REMOTE_ENDPOINT_DENIED };
    }
    // Strip trailing slash; keep origin+pathname without /run.
    return { ok: true, endpoint: endpoint.replace(/\/+$/, '') };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `AXIS engine endpoint check failed: ${message}` };
  }
}
