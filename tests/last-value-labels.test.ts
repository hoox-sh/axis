/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { setStore } from '../src/store';
import { lastValueNamesOn, seriesLabelTitle } from '../src/chart/last-value-labels';

describe('seriesLabelTitle', () => {
  beforeEach(() => {
    setStore('lastValueNamesVisible', true);
  });

  it('passes through the plot name when names are on', () => {
    expect(lastValueNamesOn()).toBe(true);
    expect(seriesLabelTitle('RSI')).toBe('RSI');
    expect(seriesLabelTitle('Overbought')).toBe('Overbought');
  });

  it('returns empty title when names are off', () => {
    setStore('lastValueNamesVisible', false);
    expect(lastValueNamesOn()).toBe(false);
    expect(seriesLabelTitle('RSI')).toBe('');
    expect(seriesLabelTitle('Overbought')).toBe('');
  });
});
