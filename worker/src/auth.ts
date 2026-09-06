// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * API key authentication for the script library and any shared Bearer endpoints.
 *
 * ## Key shape
 * Production keys are `pn_` + 48 hex chars (24 random bytes), minted by `/api/keys`.
 * Pro API keys use the same prefix so clients can reuse one credential.
 *
 * ## Validation order ({@link requireApiKey})
 * 1. Extract Bearer or `?key=` ({@link extractBearer}).
 * 2. If `API_KEYS` KV is bound → lookup `key:<token>`; reject unknown.
 * 3. Else if D1 (`DB`) is bound and open keys is off → `API_KEYS_REQUIRED` (fail closed).
 * 4. Else if `ALLOW_OPEN_KEYS` → accept any non-empty key (local demos only).
 * 5. Else accept only well-formed `pn_[a-f0-9]{48}` (dev without KV / without D1).
 *
 * ## Multi-tenant partition
 * `userId` is a SHA-256 prefix of the raw key (32 hex chars). D1 rows and
 * in-memory maps are keyed by `userId` so the raw secret never lands in SQL.
 */

import type { Env } from './index';

/** Authenticated caller after a successful {@link requireApiKey}. */
export interface AuthContext {
  /** Raw API key string as presented by the client. */
  key: string;
  /** Stable partition id (SHA-256 hex prefix); used as D1 `user_id`. */
  userId: string;
  /** Plan tier from KV record (`hobby` default when unbound / unparseable). */
  tier: string;
}

/** First 32 hex chars of SHA-256(key) — stable user partition without storing secrets. */
async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Pull API key from `Authorization: Bearer …` (preferred) or `?key=` query
 * (handy for WebSocket / simple curl). Header wins when both present.
 */
export function extractBearer(req: Request): string {
  const auth = req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1]!.trim();
  const url = new URL(req.url);
  return (url.searchParams.get('key') || '').trim();
}

/**
 * Validate the request's API key and return an {@link AuthContext}.
 * On failure returns HTTP status + stable error `code` for JSON clients
 * (`NO_KEY` | `INVALID_KEY` | `API_KEYS_REQUIRED`).
 *
 * ## Fail-closed with durable storage
 * When `env.DB` (D1) is bound but `API_KEYS` KV is not, shape-only / open
 * acceptance would partition real script data by attacker-chosen tokens with
 * no mint/revoke. In that configuration we only allow **explicit**
 * `ALLOW_OPEN_KEYS` (local demos) or reject with `API_KEYS_REQUIRED`.
 */
export async function requireApiKey(
  req: Request,
  env: Env,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; status: number; code: string; message: string }> {
  const key = extractBearer(req);
  if (!key) {
    return { ok: false, status: 401, code: 'NO_KEY', message: 'Authorization: Bearer <api_key> required' };
  }

  const kv = env.API_KEYS;
  if (kv) {
    // Production path: only keys previously written by handleKeys create.
    const raw = await kv.get(`key:${key}`);
    if (!raw) {
      return { ok: false, status: 401, code: 'INVALID_KEY', message: 'unknown key' };
    }
    let tier = 'hobby';
    try {
      tier = (JSON.parse(raw) as { tier?: string }).tier || 'hobby';
    } catch {
      /* non-JSON KV value → default tier */
    }
    return { ok: true, ctx: { key, userId: await hashKey(key), tier } };
  }

  const openKeys = env.ALLOW_OPEN_KEYS === '1' || env.ALLOW_OPEN_KEYS === 'true';
  const durableWithoutKv = Boolean(env.DB);

  // Durable partition without KV: refuse shape-only inventable keys.
  // Explicit open-keys remains available for local demos only.
  if (durableWithoutKv && !openKeys) {
    return {
      ok: false,
      status: 503,
      code: 'API_KEYS_REQUIRED',
      message:
        'API_KEYS KV is not bound while D1 is active. Bind API_KEYS and mint keys via /api/keys, ' +
        'or set ALLOW_OPEN_KEYS=1 only for non-production local demos.',
    };
  }

  // Dev without KV: open mode or shape-only validation (no durable DB).
  if (openKeys) {
    return { ok: true, ctx: { key, userId: await hashKey(key), tier: 'hobby' } };
  }

  if (/^pn_[a-f0-9]{48}$/.test(key)) {
    return { ok: true, ctx: { key, userId: await hashKey(key), tier: 'hobby' } };
  }

  return {
    ok: false,
    status: 401,
    code: 'INVALID_KEY',
    message: 'malformed key (expected pn_… from /api/keys) or bind API_KEYS KV',
  };
}
