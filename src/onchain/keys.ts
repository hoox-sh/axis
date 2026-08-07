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
 * Cache / series key helpers for the on-chain data plane.
 *
 * @module onchain/keys
 */

import type { OnchainInstrument } from './types';

function part(v: string | undefined | null): string {
  const s = String(v ?? '').trim();
  return s || '_';
}

/**
 * Stable cache key: `provider|chainId|protocol|address|metric|facet|resolution`.
 * Empty / missing parts normalize to `_`.
 */
export function instrumentCacheKey(
  providerId: string,
  instrument: OnchainInstrument,
  resolution: string,
): string {
  return [
    part(providerId),
    part(instrument?.chainId),
    part(instrument?.protocolId),
    part(instrument?.address),
    part(instrument?.metric),
    part(instrument?.facet),
    part(resolution),
  ].join('|');
}

/**
 * Lightweight Charts / PaneManager series id for an on-chain attachment.
 * Prefixed `onchain_` — intentionally **not** under `overlay_`.
 */
export function seriesSeriesKey(attachmentId: string): string {
  const id = String(attachmentId || '').trim() || 'unknown';
  return `onchain_${id}`;
}
