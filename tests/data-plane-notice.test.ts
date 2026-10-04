/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { classifyDataPlaneNotice, cleanStatusLine } from '../src/ui/data-plane-notice';

describe('classifyDataPlaneNotice', () => {
  it('strips stack frames from a status line', () => {
    expect(cleanStatusLine('Load failed: boom at Parser.parse (app.js:1:1)')).toBe('boom');
  });

  it('uses one action for html, cors, csv, and an empty chart', () => {
    expect(classifyDataPlaneNotice({ message: 'Unexpected token < in JSON' }).action).toBe(
      'open-data',
    );
    expect(
      classifyDataPlaneNotice({
        message: "Unexpected token '<' is not valid JSON · worker",
      }).title,
    ).toBe('Venue returned a page');
    expect(classifyDataPlaneNotice({ message: 'Failed to fetch' }).actionLabel).toBe('Use mock');
    expect(
      classifyDataPlaneNotice({ message: 'CSV parse error: missing header' }).title,
    ).toBe('CSV did not parse');
    const empty = classifyDataPlaneNotice({ symbol: 'BTCUSDT', interval: '1h' });
    expect(empty.title).toBe('No bars');
    expect(empty.actionLabel).toBe('Load');
    expect(empty.sentence).not.toMatch(/at\s+\w+\(/);
  });

  it('does not put a stack into the chart sentence', () => {
    const n = classifyDataPlaneNotice({
      status: 'error',
      message: 'Load failed: venue down\n    at fetchBars (load.ts:10:4)',
    });
    expect(n.title).toBe('Could not load bars');
    expect(n.sentence).not.toContain('fetchBars');
  });
});
