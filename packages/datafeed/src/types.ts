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
 * Gateway contract types — shared between the Bun sidecar and any consumer
 * (AXIS browser, PYNE headless, Worker proxy).
 *
 * Mirrors the PYNE datafeed gateway contract.
 *
 * @module datafeed/types
 */

/** Normalized OHLCV bar — same shape as AXIS `Bar` / `RawBar`. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Gateway session store — credential ID → exchange + keys (RAM only). */
export interface GatewaySession {
  exchange: string;
  apiKey: string;
  secret: string;
  password?: string;
  uid?: string;
}

/** Query params for `GET /datafeed/ohlcv`. */
export interface OhlcvQuery {
  exchange: string;
  symbol: string;
  timeframe?: string;
  since?: string;
  limit?: string;
}

/** Query params for `GET /datafeed/markets`. */
export interface MarketsQuery {
  exchange: string;
}

/** Query params for `WS /datafeed/watch`. */
export interface WatchQuery {
  exchange: string;
  symbol: string;
  timeframe?: string;
}

/** Body for `POST /datafeed/session`. */
export interface SessionBody {
  exchange: string;
  credentialId: string;
  apiKey: string;
  secret: string;
  password?: string;
  uid?: string;
}

/** Active watch stream handle. */
export interface WatchStream {
  next(): Promise<Bar>;
  close(): void;
}
