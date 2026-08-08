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
 * Popular protocol + DEX network presets for AXIS on-chain plane.
 *
 * DefiLlama protocol slugs are verified against the public API where possible.
 * Gecko network ids match {@link mapAxisNetworkToGecko} / GeckoTerminal.
 *
 * @module onchain/presets
 */

import { normalizeProtocolSlug } from './adapters';
import {
  MAX_ONCHAIN_SERIES,
  attachDefiLlamaTvl,
  getOnchainManagerState,
} from './manager';

/** Curated high-TVL DefiLlama protocol presets (slug + display name). */
export const POPULAR_TVL_PROTOCOLS: Array<{ slug: string; name: string }> = [
  { slug: 'aave', name: 'Aave' },
  { slug: 'lido', name: 'Lido' },
  { slug: 'uniswap', name: 'Uniswap' },
  { slug: 'makerdao', name: 'MakerDAO' },
  { slug: 'eigenlayer', name: 'EigenLayer' },
  { slug: 'binance-staked-eth', name: 'Binance staked ETH' },
  { slug: 'curve-dex', name: 'Curve DEX' },
  { slug: 'convex-finance', name: 'Convex Finance' },
  { slug: 'pendle', name: 'Pendle' },
  { slug: 'morpho', name: 'Morpho' },
  { slug: 'ethena', name: 'Ethena' },
  { slug: 'sparklend', name: 'SparkLend' },
  { slug: 'ether.fi-stake', name: 'ether.fi Stake' },
  { slug: 'compound-finance', name: 'Compound' },
];

/**
 * Common GeckoTerminal network presets for DEX OHLCV sources.
 * `gecko` is the GeckoTerminal network id (see mapAxisNetworkToGecko).
 */
export const DEX_NETWORK_PRESETS: Array<{
  id: string;
  label: string;
  gecko: string;
}> = [
  { id: 'eth', label: 'Ethereum', gecko: 'eth' },
  { id: 'arbitrum', label: 'Arbitrum', gecko: 'arbitrum' },
  { id: 'base', label: 'Base', gecko: 'base' },
  { id: 'bsc', label: 'BNB Chain', gecko: 'bsc' },
  { id: 'polygon', label: 'Polygon', gecko: 'polygon_pos' },
  { id: 'solana', label: 'Solana', gecko: 'solana' },
];

export type AttachPopularTvlResult = {
  ok: string[];
  failed: Array<{ slug: string; error: string }>;
};

function alreadyAttachedTvl(slug: string): boolean {
  const protocolId = normalizeProtocolSlug(slug);
  if (!protocolId) return false;
  const { attachments } = getOnchainManagerState();
  return attachments.some((a) => {
    const key = normalizeProtocolSlug(
      a.instrument?.protocolId || a.key || '',
    );
    const metric = a.instrument?.metric || 'tvl';
    return key === protocolId && metric === 'tvl';
  });
}

/**
 * Attach popular DefiLlama TVL series in preset order via
 * {@link attachDefiLlamaTvl}.
 *
 * Stops when chart capacity {@link MAX_ONCHAIN_SERIES} is reached (existing
 * same-protocol rows may still refresh). Optional `limit` caps how many
 * presets from the head of {@link POPULAR_TVL_PROTOCOLS} are attempted.
 */
export async function attachPopularTvl(
  limit?: number,
): Promise<AttachPopularTvlResult> {
  const ok: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];

  const n =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : POPULAR_TVL_PROTOCOLS.length;

  const list = POPULAR_TVL_PROTOCOLS.slice(0, n);

  for (const p of list) {
    const slug = normalizeProtocolSlug(p.slug) || p.slug;
    const { attachments } = getOnchainManagerState();
    if (
      attachments.length >= MAX_ONCHAIN_SERIES &&
      !alreadyAttachedTvl(slug)
    ) {
      break;
    }

    try {
      await attachDefiLlamaTvl({ slug, name: p.name });
      ok.push(slug);
    } catch (err) {
      const error =
        err instanceof Error && err.message
          ? err.message
          : String(err || 'attach failed');
      failed.push({ slug, error });
      // Hard stop when the manager rejects further new series.
      if (error.includes('Max on-chain series reached')) {
        break;
      }
    }
  }

  return { ok, failed };
}
