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
 * FNV-1a 32-bit (AXB1 `sub_id_hash` / `session_hash` / plot key hashes).
 *
 * @module hp/axb1/hash
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const utf8 = new TextEncoder();

/** FNV-1a 32 of UTF-8 bytes. Empty input is the offset basis `2166136261`. */
export function fnv1a32(input: string | Uint8Array): number {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input;
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i] as number;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}
