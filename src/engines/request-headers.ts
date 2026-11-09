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
 * Build engine request headers: JSON content type (optional) and the API key
 * as both `X-API-Key` and `Authorization: Bearer`.
 *
 * @param apiKey - Engine / Worker key; omitted or empty means anonymous.
 * @param json - Set `false` for GET/health probes that send no body.
 * @returns A fresh mutable header record.
 */
export function engineHeaders(apiKey?: string, json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  const key = String(apiKey ?? '').trim();
  if (key) {
    headers['X-API-Key'] = key;
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}
