// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared client identity for every HTTP request the PWA makes to a PYNE
 * engine (local Pro API, AXIS Worker `/api/run`, pyne-worker).
 *
 * Browser WebSockets cannot set request headers, so this only covers `fetch`.
 * The backend trusts the PWA WebSocket via its `Origin`
 * (`https://axis.hoox.sh`) instead.
 *
 * @module engines/request-headers
 */

/** Header that marks a request as coming from the first-party PWA. */
export const AXIS_CLIENT_HEADER = 'X-AXIS-Client';
/** Value for {@link AXIS_CLIENT_HEADER}. */
export const AXIS_CLIENT_VALUE = 'pwa';
/** Single source of truth for the open-beta notice shown in API-key inputs. */
export const BETA_COPY = 'Open beta — free while in beta. No API key needed.';

/**
 * Build engine request headers: JSON content type (optional), the PWA client
 * marker, and the API key as both `X-API-Key` and `Authorization: Bearer`.
 *
 * @param apiKey - Engine / Worker key; omitted or empty means anonymous.
 * @param json - Set `false` for GET/health probes that send no body.
 * @returns A fresh mutable header record.
 */
export function engineHeaders(apiKey?: string, json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  headers[AXIS_CLIENT_HEADER] = AXIS_CLIENT_VALUE;
  const key = String(apiKey ?? '').trim();
  if (key) {
    headers['X-API-Key'] = key;
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}
