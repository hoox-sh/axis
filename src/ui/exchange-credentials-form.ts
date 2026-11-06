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
 * Exchange API-key form helpers for Settings → Data.
 *
 * Secrets live in `src/data/credentials` (session vault). This module is
 * UI-only: venue list, passphrase rule, and empty form state. Never persist
 * `apiKey` / `secret` / `passphrase` from here.
 *
 * @module ui/exchange-credentials-form
 */

/** Venues that accept an API key/secret in Settings → Data. */
export const EXCHANGE_CREDENTIAL_VENUES = [
  'binance',
  'okx',
  'bybit',
  'coinbase',
  'kraken',
  'mexc',
] as const;

/** Venue ids accepted by the exchange credentials form; also the label map key. */
export type ExchangeCredentialVenue = (typeof EXCHANGE_CREDENTIAL_VENUES)[number];

/** Display names for the venue select, keyed by {@link ExchangeCredentialVenue}. */
export const EXCHANGE_CREDENTIAL_VENUE_LABELS: Record<ExchangeCredentialVenue, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
  mexc: 'MEXC',
};

/** Draft state of the credential form; secrets stay in memory and are never persisted. */
export type ExchangeCredentialFormState = {
  venue: ExchangeCredentialVenue;
  apiKey: string;
  secret: string;
  passphrase: string;
  label?: string;
};

/** Blank form seeded on Binance, used to reset the credential fields. */
export const EMPTY_EXCHANGE_CREDENTIAL_FORM: ExchangeCredentialFormState = {
  venue: 'binance',
  apiKey: '',
  secret: '',
  passphrase: '',
};

/** OKX and Coinbase REST signing require a passphrase in addition to key/secret. */
export function venueNeedsPassphrase(venue: string): boolean {
  const v = String(venue || '')
    .trim()
    .toLowerCase();
  return v === 'okx' || v === 'coinbase';
}

/** CCXT `password` field (passphrase) — OKX, Coinbase, KuCoin family. */
const CCXT_PASSWORD_EXCHANGES = new Set([
  'okx',
  'okxus',
  'coinbase',
  'coinbaseinternational',
  'kucoin',
  'kucoinfutures',
  'kucoinspot',
]);

/**
 * Whether a CCXT exchange id uses the `password` field (passphrase).
 *
 * @param exchange - CCXT exchange id, any casing.
 * @returns `true` for the OKX / Coinbase / KuCoin families.
 */
export function ccxtNeedsPassword(exchange: string): boolean {
  return CCXT_PASSWORD_EXCHANGES.has(
    String(exchange || '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * Canonicalize a user-typed CCXT exchange id for vault lookup.
 *
 * @param raw - Exchange id as typed or stored.
 * @returns Trimmed lowercase id (`''` when empty).
 */
export function normalizeCcxtExchangeId(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

/**
 * Type guard for a supported venue id.
 *
 * @param venue - Candidate venue id (not normalized — pass lowercase).
 * @returns `true` when the id is one of {@link EXCHANGE_CREDENTIAL_VENUES}.
 */
export function isExchangeCredentialVenue(venue: string): venue is ExchangeCredentialVenue {
  return (EXCHANGE_CREDENTIAL_VENUES as readonly string[]).includes(venue);
}

/**
 * Resolve the form's initial venue from a stored/source value.
 *
 * @param raw - Venue id from the store or a source config.
 * @returns A supported venue, defaulting to `binance` for unknown/empty input.
 */
export function defaultExchangeCredentialVenue(raw?: string | null): ExchangeCredentialVenue {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  return isExchangeCredentialVenue(v) ? v : 'binance';
}

/**
 * Human venue name for labels and messages.
 *
 * @param venue - Venue id; unknown ids are echoed back unchanged.
 * @returns Display label, `Exchange` when the id is empty.
 */
export function exchangeVenueLabel(venue: string): string {
  if (isExchangeCredentialVenue(venue)) return EXCHANGE_CREDENTIAL_VENUE_LABELS[venue];
  return venue || 'Exchange';
}
