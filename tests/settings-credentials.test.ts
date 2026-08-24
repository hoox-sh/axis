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
  ccxtNeedsPassword,
} from '../src/ui/exchange-credentials-form';

describe('venueNeedsPassphrase', () => {
  it('is true for OKX and Coinbase', () => {
    expect(venueNeedsPassphrase('okx')).toBe(true);
    expect(venueNeedsPassphrase('coinbase')).toBe(true);
    expect(venueNeedsPassphrase('OKX')).toBe(true);
    expect(venueNeedsPassphrase('Coinbase')).toBe(true);
  });

  it('is false for Binance, Bybit, Kraken, MEXC', () => {
    expect(venueNeedsPassphrase('binance')).toBe(false);
    expect(venueNeedsPassphrase('bybit')).toBe(false);
    expect(venueNeedsPassphrase('kraken')).toBe(false);
    expect(venueNeedsPassphrase('mexc')).toBe(false);
    expect(venueNeedsPassphrase('')).toBe(false);
  });
});

describe('ccxtNeedsPassword', () => {
  it('is true for okx / coinbase / kucoin family', () => {
    expect(ccxtNeedsPassword('okx')).toBe(true);
    expect(ccxtNeedsPassword('kucoin')).toBe(true);
    expect(ccxtNeedsPassword('coinbase')).toBe(true);
  });

  it('is false for bybit / binance', () => {
    expect(ccxtNeedsPassword('bybit')).toBe(false);
    expect(ccxtNeedsPassword('binance')).toBe(false);
  });
});

describe('exchange credential venues', () => {
  it('lists native CEX venues', () => {
    expect([...EXCHANGE_CREDENTIAL_VENUES]).toEqual([
      'binance',
      'okx',
      'bybit',
      'coinbase',
      'kraken',
      'mexc',
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
