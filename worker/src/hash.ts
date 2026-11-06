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
 * SHA-256 helpers shared by the Worker auth and tenant planes.
 *
 * Kept in a leaf module with no imports so both `auth.ts` and `tenant.ts` can
 * depend on it: `tenant.ts` already imports `auth.ts`, so putting the hash in
 * either of them would create a cycle.
 *
 * @module worker/hash
 */

/**
 * Hex-encode the SHA-256 digest of a UTF-8 string.
 *
 * @param input Raw string (typically an API key or bearer token).
 * @returns Lowercase hex digest, 64 characters.
 * @throws Never — `crypto.subtle` is available in every Worker runtime and in
 *   Bun; a missing WebCrypto would surface as a rejected promise from the
 *   platform, not from this function.
 *
 * @example
 * const id = (await sha256Hex(rawKey)).slice(0, 32); // stable user partition
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Stable user partition id derived from a raw API key.
 *
 * The raw secret is never stored: D1 rows, KV keys, and in-memory maps use the
 * first 32 hex chars of the SHA-256 digest, which is what the auth plane calls
 * `userId` and the MCP bridge calls `sessionId`.
 *
 * @param rawKey Raw bearer token as presented by the client.
 * @returns 32 lowercase hex characters.
 *
 * @example
 * const userId = await partitionIdFromKey(req.headers.get('Authorization') ?? '');
 */
export async function partitionIdFromKey(rawKey: string): Promise<string> {
  return (await sha256Hex(rawKey)).slice(0, 32);
}
