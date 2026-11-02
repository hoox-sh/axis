// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Data Window close tone versus the previous bar.
 */

import { describe, expect, it } from 'bun:test';
import { buildDataViewRows } from '../src/results/dataview';

function bars(secondClose: number) {
  return [
    { time: 1, open: 10, high: 12, low: 9, close: 10 },
    { time: 2, open: 10, high: 12, low: 9, close: secondClose },
  ];
}

function row(rows: ReturnType<typeof buildDataViewRows>, key: string) {
  return rows.find((r) => r.key === key);
}

describe('data window close tone', () => {
  it('marks a higher second close up', () => {
    const rows = buildDataViewRows({ bars: bars(11), barIndex: 1 });
    expect(row(rows, 'close')?.tone).toBe('up');
  });

  it('marks a lower second close down', () => {
    const rows = buildDataViewRows({ bars: bars(9), barIndex: 1 });
    expect(row(rows, 'close')?.tone).toBe('down');
  });

  it('marks equal closes flat', () => {
    const rows = buildDataViewRows({ bars: bars(10), barIndex: 1 });
    expect(row(rows, 'close')?.tone).toBe('flat');
  });

  it('omits tone on a one-bar series', () => {
    const rows = buildDataViewRows({
      bars: [{ time: 1, open: 10, high: 12, low: 9, close: 10 }],
      barIndex: 0,
    });
    expect(row(rows, 'close')?.tone).toBeUndefined();
  });

  it('leaves open, high, and low without a tone', () => {
    const rows = buildDataViewRows({ bars: bars(11), barIndex: 1 });
    expect(row(rows, 'open')?.tone).toBeUndefined();
    expect(row(rows, 'high')?.tone).toBeUndefined();
    expect(row(rows, 'low')?.tone).toBeUndefined();
  });
});
