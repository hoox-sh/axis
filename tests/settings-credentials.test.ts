// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings → Data exchange-key form helpers (pure).
 */

import { describe, expect, it } from 'bun:test';
import {
  EXCHANGE_CREDENTIAL_VENUES,
  EMPTY_EXCHANGE_CREDENTIAL_FORM,
  defaultExchangeCredentialVenue,
  isExchangeCredentialVenue,
  venueNeedsPassphrase,
} from '../src/ui/exchange-credentials-form';

describe('venueNeedsPassphrase', () => {
  it('is true for OKX and Coinbase', () => {
    expect(venueNeedsPassphrase('okx')).toBe(true);
    expect(venueNeedsPassphrase('coinbase')).toBe(true);
    expect(venueNeedsPassphrase('OKX')).toBe(true);
    expect(venueNeedsPassphrase('Coinbase')).toBe(true);
  });

  it('is false for Binance, Bybit, Kraken', () => {
    expect(venueNeedsPassphrase('binance')).toBe(false);
    expect(venueNeedsPassphrase('bybit')).toBe(false);
    expect(venueNeedsPassphrase('kraken')).toBe(false);
    expect(venueNeedsPassphrase('')).toBe(false);
  });
});

describe('exchange credential venues', () => {
  it('lists the five CEX venues', () => {
    expect([...EXCHANGE_CREDENTIAL_VENUES]).toEqual([
      'binance',
      'okx',
      'bybit',
      'coinbase',
      'kraken',
    ]);
  });

  it('accepts only those venues', () => {
    expect(isExchangeCredentialVenue('binance')).toBe(true);
    expect(isExchangeCredentialVenue('gecko')).toBe(false);
    expect(defaultExchangeCredentialVenue('okx')).toBe('okx');
    expect(defaultExchangeCredentialVenue('nope')).toBe('binance');
    expect(EMPTY_EXCHANGE_CREDENTIAL_FORM.venue).toBe('binance');
    expect(EMPTY_EXCHANGE_CREDENTIAL_FORM.apiKey).toBe('');
    expect(EMPTY_EXCHANGE_CREDENTIAL_FORM.secret).toBe('');
  });
});
