/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine table HUD helpers — extract, normalize, filter by applied scripts.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildTableGrid,
  collectVisiblePineTables,
  normalizePineTable,
  pineTablePositionClass,
  tablesFromRunPayload,
} from '../src/chart/pine-tables';

const sampleTable = {
  type: 'table',
  position: 'position.top_right',
  rows: 2,
  columns: 2,
  cells: [
    { row: 0, col: 0, text: 'A' },
    { row: 0, col: 1, text: 'B' },
    { row: 1, col: 0, text: 'C', bgcolor: '#112233' },
  ],
};

describe('normalizePineTable', () => {
  it('keeps declared size and cells', () => {
    const tb = normalizePineTable(sampleTable, 's1');
    expect(tb?.rows).toBe(2);
    expect(tb?.columns).toBe(2);
    expect(tb?.cells?.length).toBe(3);
    expect(tb?.ownerId).toBe('s1');
  });

  it('expands size from cell extents when rows/cols understated', () => {
    const tb = normalizePineTable({
      type: 'table',
      rows: 1,
      columns: 1,
      cells: [
        { row: 0, col: 0, text: 'x' },
        { row: 2, col: 3, text: 'far' },
      ],
    });
    expect(tb?.rows).toBe(3);
    expect(tb?.columns).toBe(4);
  });

  it('returns null for non-table', () => {
    expect(normalizePineTable({ type: 'line' })).toBeNull();
  });
});

describe('buildTableGrid', () => {
  it('places cells by row/col', () => {
    const tb = normalizePineTable(sampleTable)!;
    const g = buildTableGrid(tb);
    expect(g[0]![0]?.text).toBe('A');
    expect(g[0]![1]?.text).toBe('B');
    expect(g[1]![0]?.text).toBe('C');
    expect(g[1]![1]).toBeNull();
  });
});

describe('collectVisiblePineTables', () => {
  it('only includes tables for still-applied scripts', () => {
    const runResults = {
      keep: { drawings: [sampleTable] },
      gone: {
        drawings: [
          {
            type: 'table',
            rows: 1,
            columns: 1,
            cells: [{ row: 0, col: 0, text: 'STALE' }],
          },
        ],
      },
    };
    const visible = collectVisiblePineTables({
      scriptIds: ['keep'],
      runResults,
      editorKey: '__editor__',
    });
    expect(visible.length).toBe(1);
    expect(visible[0]!.cells?.[0]?.text).toBe('A');
    expect(visible[0]!.ownerId).toBe('keep');
  });

  it('does not keep lastRun tables when no scripts and no editor cache', () => {
    const visible = collectVisiblePineTables({
      scriptIds: [],
      runResults: {},
      lastRun: { drawings: [sampleTable] },
    });
    expect(visible.length).toBe(0);
  });

  it('ignores editor key when chart scripts exist', () => {
    const visible = collectVisiblePineTables({
      scriptIds: ['s1'],
      runResults: {
        __editor__: { drawings: [sampleTable] },
      },
      editorKey: '__editor__',
    });
    expect(visible.length).toBe(0);
  });
});

describe('tablesFromRunPayload', () => {
  it('skips empty text tables', () => {
    const out = tablesFromRunPayload({
      drawings: [
        {
          type: 'table',
          rows: 1,
          columns: 1,
          cells: [{ row: 0, col: 0, text: '   ' }],
        },
      ],
    });
    expect(out.length).toBe(0);
  });
});

describe('pineTablePositionClass', () => {
  it('maps position tokens', () => {
    expect(pineTablePositionClass('position.top_left')).toContain('left');
    expect(pineTablePositionClass('bottom_center')).toContain('bottom');
    expect(pineTablePositionClass('middle_center')).toContain('translate');
  });
});
