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

export type HttpBaseUrlOptions = {
  allowRemote?: boolean;
  /** Used when `raw` is empty (engine / datafeed defaults). */
  defaultUrl: string;
  /** Short label for error strings (`engine`, `datafeed`, …). */
  label?: string;
};

/**
 * Normalize and gate an http(s) base URL (loopback unless allowRemote).
 * Shared by Pro engine and axis-datafeed clients.
 */
export function checkHttpBaseUrl(
  raw: string | undefined | null,
  opts: HttpBaseUrlOptions,
): EndpointCheck {
  const label = (opts.label && opts.label.trim()) || 'endpoint';
  try {
    const trimmed = String(raw ?? '')
      .trim()
      .replace(/\/+$/, '');
    const endpoint = trimmed || opts.defaultUrl;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return { ok: false, error: `AXIS ${label} URL is not a valid URL: ${endpoint}` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        ok: false,
        error:
          label === 'engine'
            ? BAD_ENDPOINT_SCHEME
            : `AXIS ${label} URL must use http: or https:.`,
      };
    }
    const host = (url.hostname || '').toLowerCase();
    const loopback = LOOPBACK_HOSTS.has(host);
    if (!loopback && opts.allowRemote !== true) {
      return {
        ok: false,
        error:
          label === 'engine'
            ? REMOTE_ENDPOINT_DENIED
            : `AXIS ${label} URL must be loopback (127.0.0.1 / localhost / ::1) unless axis.engine.allowRemoteEndpoint is enabled.`,
      };
    }
    return { ok: true, endpoint: endpoint.replace(/\/+$/, '') };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `AXIS ${label} URL check failed: ${message}` };
  }
}

/**
 * Normalize and gate the Pro engine base URL.
 * Default: loopback only (Bearer key must not leave the machine without opt-in).
 */
export function checkEngineEndpoint(
  raw: string | undefined | null,
  opts?: { allowRemote?: boolean },
): EndpointCheck {
  return checkHttpBaseUrl(raw, {
    allowRemote: opts?.allowRemote,
    defaultUrl: DEFAULT_ENGINE_ENDPOINT,
    label: 'engine',
  });
}
