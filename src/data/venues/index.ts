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
 * Venue HMAC signers for authenticated CEX REST (spot klines / private GET).
 *
 * @module data/venues
 */

import { signBinance } from './binance';
import { signBybit } from './bybit';
import { signCoinbase } from './coinbase';
import { signKraken } from './kraken';
import { signOkx } from './okx';
import type { SignInput, SignedRequest, VenueId } from './types';

export type { SignInput, SignedRequest, VenueId } from './types';
export { DEFAULT_RECV_WINDOW } from './types';

export { BINANCE_BASE, BINANCE_KLINES_PATH, signBinance } from './binance';
export { BYBIT_BASE, BYBIT_KLINE_PATH, signBybit } from './bybit';
export { COINBASE_BASE, signCoinbase } from './coinbase';
export { KRAKEN_BASE, KRAKEN_OHLC_PATH, signKraken } from './kraken';
export { OKX_BASE, OKX_CANDLES_PATH, okxHeaders, signOkx } from './okx';

const SIGNERS: Record<VenueId, (input: SignInput) => Promise<SignedRequest>> = {
  binance: signBinance,
  okx: signOkx,
  bybit: signBybit,
  coinbase: signCoinbase,
  kraken: signKraken,
};

/** Sign a GET kline/candle (or private GET) request for `venue`. */
export function signVenueRequest(venue: VenueId, input: SignInput): Promise<SignedRequest> {
  const sign = SIGNERS[venue];
  if (!sign) throw new Error(`unknown venue: ${venue}`);
  return sign(input);
}
