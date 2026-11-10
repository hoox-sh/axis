// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared engine `fetch` headers for the PWA (local Pro API, AXIS Worker
 * `/api/run`, pyne-worker).
 *
 * Do **not** attach {@link AXIS_CLIENT_HEADER} here. It is a non-CORS-safelisted
 * header, so every GET `/health` would preflight, and a cached OPTIONS
 * (`Access-Control-Max-Age: 86400`) from before the engine listed it in
 * `Access-Control-Allow-Headers` blocks `/run`, `/session`, and `/health` for
 * a day. Production PWA trust is `Origin: https://axis.hoox.sh` on the Worker
 * and the Pro API. The IDE may still send the header on its own.
 *
 * Browser WebSockets cannot set request headers; backends trust the PWA
 * socket via that same Origin.
 *
 * @module engines/request-headers
 */

/** Header an IDE / preview client may send; the PWA does not (see {@link engineHeaders}). */
export const AXIS_CLIENT_HEADER = 'X-AXIS-Client';
/** Value for {@link AXIS_CLIENT_HEADER} when a non-PWA client opts in. */
export const AXIS_CLIENT_VALUE = 'pwa';
/** Single source of truth for the open-beta notice shown in API-key inputs. */
export const BETA_COPY = 'Open beta — free while in beta. No API key needed.';

/**
 * Key worth putting on an engine request.
 *
 * Empty, placeholder, and tiny values are omitted. A console tenant key
 * (`hx_live_…`) is omitted for pyne-worker: that host treats the bearer as a
 * tenant credential and answers 401 before the guest `/run` path, which is
 * what leaves a successful run next to a console 401.
 *
 * @param raw stored key
 * @param endpoint engine base URL; tenant keys are only dropped for pyne-worker
 */
export function engineApiKeyForRequest(raw: unknown, endpoint?: string): string {
  const key = String(raw ?? '').trim();
  if (!key) return '';
  if (/^(undefined|null|none|false|true)$/i.test(key)) return '';
  if (/^x-api-key\b/i.test(key)) return '';
  const host = String(endpoint || '').toLowerCase();
  if (key.startsWith('hx_live_') && host.includes('pyne-worker')) return '';
  return key;
}

/**
 * Build engine request headers: JSON content type (optional) and the API key
 * as both `X-API-Key` and `Authorization: Bearer`.
 *
 * @param apiKey - Engine / Worker key; omitted, empty, or unusable means anonymous.
 * @param json - Set `false` for GET/health probes that send no body.
 * @param endpoint - When set, a tenant key is not attached to pyne-worker.
 * @returns A fresh mutable header record.
 */
export function engineHeaders(
  apiKey?: string,
  json = true,
  endpoint?: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  const key = engineApiKeyForRequest(apiKey, endpoint);
  if (key) {
    headers['X-API-Key'] = key;
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}
