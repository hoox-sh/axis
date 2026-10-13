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
 * Engine-owned live mode: who persists OHLCV.
 *
 * In every-tick Pro mode the engine's store and feed own the bars for the
 * chart's `(exchange, symbol, interval)`. Local persistence must not compete
 * with that: streamed bars stay in memory (chart buffers) and are never
 * written to the dataset store / IndexedDB / localStorage.
 *
 * The predicate is synchronous and fail-open: while capabilities are still
 * resolving, or on any engine without `dataSession`, local persistence keeps
 * working exactly as before.
 *
 * @module engines/ownership
 */

import { store } from '../store';
import { getCachedEngineCapabilities } from './catalog';

/**
 * True when the selected engine owns the OHLCV feed for the live chart:
 * it advertised `data_session` and the user policy is every-tick.
 * Read this from live-bar and dataset write paths to skip persistence.
 */
export function isEngineOwnedLive(): boolean {
  if (store.live.rerunOn !== 'every-tick') return false;
  return getCachedEngineCapabilities().dataSession === true;
}
