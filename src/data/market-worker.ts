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
 * Shared AXIS Worker origin for public market proxies (Binance + MEXC).
 * Same rules as on-chain: prefer a configured Worker, else production default,
 * so venue clients do not drift.
 *
 * @module data/market-worker
 */

import { store } from '../store';
import {
  DEFAULT_AXIS_WORKER_BASE,
  looksLikeOnchainWorkerEndpoint,
  normalizeEndpointBase,
} from './worker-origin';

/** Default production AXIS Worker (market + on-chain proxy). */
export const DEFAULT_MARKET_WORKER_BASE = DEFAULT_AXIS_WORKER_BASE;

/**
 * Resolve Worker origin for market proxy (no trailing slash).
 */
export function resolveMarketWorkerBase(
  configWorkerBase?: string | null,
): string {
  const fromCfg = normalizeEndpointBase(configWorkerBase);
  if (fromCfg && looksLikeOnchainWorkerEndpoint(fromCfg)) return fromCfg;

  const fromStore = normalizeEndpointBase(store.endpoint);
  if (fromStore && looksLikeOnchainWorkerEndpoint(fromStore)) return fromStore;

  return DEFAULT_MARKET_WORKER_BASE;
}
