/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Chart tab title: last price leads, and the favicon is the HOOX mark.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatChartTitle } from '../src/ui/document-title';

const ROOT = resolve(import.meta.dir, '..');

describe('formatChartTitle', () => {
  it('falls back to AXIS when nothing is loaded', () => {
    expect(formatChartTitle()).toBe('AXIS');
    expect(formatChartTitle({ symbol: 'btcusdt' })).toBe('BTCUSDT · AXIS');
  });

  it('leads with the last price and the change versus the previous close', () => {
    expect(
      formatChartTitle({
        symbol: 'BTCUSDT',
        price: 81645.1,
        prevClose: 81300,
        decimals: 2,
      }),
    ).toBe('81645.10 +0.42% BTCUSDT');
    expect(
      formatChartTitle({
        symbol: 'ETHUSDT',
        price: 2000,
        prevClose: 2500,
        decimals: 2,
      }),
    ).toBe('2000.00 -20.00% ETHUSDT');
  });

  it('omits the change when the previous close is missing', () => {
    expect(formatChartTitle({ symbol: 'SOLUSDT', price: 150.5, decimals: 2 })).toBe(
      '150.50 SOLUSDT',
    );
    expect(formatChartTitle({ price: Number.NaN, symbol: 'SOLUSDT' })).toBe('SOLUSDT · AXIS');
  });
});

describe('HOOX favicon', () => {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const icon = readFileSync(resolve(ROOT, 'public/favicon.svg'), 'utf8');
  const logo = readFileSync(resolve(ROOT, 'public/assets/hoox-logo.svg'), 'utf8');

  it('points the tab icon at the HOOX mark', () => {
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
    // Same center path as the brand SVG, not the old circle icon.
    const center = logo.match(/d="(m 1024\.04[^"]+)"/);
    expect(center).not.toBeNull();
    expect(icon).toContain(center![1]);
  });
});
