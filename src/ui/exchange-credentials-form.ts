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
] as const;

export type ExchangeCredentialVenue = (typeof EXCHANGE_CREDENTIAL_VENUES)[number];

export const EXCHANGE_CREDENTIAL_VENUE_LABELS: Record<ExchangeCredentialVenue, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
};

export type ExchangeCredentialFormState = {
  venue: ExchangeCredentialVenue;
  apiKey: string;
  secret: string;
  passphrase: string;
  label?: string;
};

export const EMPTY_EXCHANGE_CREDENTIAL_FORM: ExchangeCredentialFormState = {
  venue: 'binance',
  apiKey: '',
  secret: '',
  passphrase: '',
};

/** OKX and Coinbase REST signing require a passphrase in addition to key/secret. */
export function venueNeedsPassphrase(venue: string): boolean {
  const v = String(venue || '').trim().toLowerCase();
  return v === 'okx' || v === 'coinbase';
}

export function isExchangeCredentialVenue(venue: string): venue is ExchangeCredentialVenue {
  return (EXCHANGE_CREDENTIAL_VENUES as readonly string[]).includes(venue);
}

export function defaultExchangeCredentialVenue(
  raw?: string | null,
): ExchangeCredentialVenue {
  const v = String(raw || '').trim().toLowerCase();
  return isExchangeCredentialVenue(v) ? v : 'binance';
}

export function exchangeVenueLabel(venue: string): string {
  if (isExchangeCredentialVenue(venue)) return EXCHANGE_CREDENTIAL_VENUE_LABELS[venue];
  return venue || 'Exchange';
}
