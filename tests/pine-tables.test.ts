/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine table HUD helpers — extract, normalize, filter by applied scripts.
 */

import { describe, expect, it } from 'bun:test';
import {
  bottomPanelColumnFractions,
  bottomPanelHasHeightHints,
  buildTableGrid,
  cellTextVerticalAlign,
  collectVisiblePineTables,
  groupBottomTablesByOwner,
  isTablesInBottom,
  normalizeMergedCells,
  normalizePineTable,
  parsePineTableCell,
  pineTablePositionClass,
  splitTablesByLocation,
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

  it('does not paint a square when rows and columns were stored swapped', () => {
    const tb = normalizePineTable({
      type: 'table',
      rows: 2,
      columns: 6,
      cells: [
        { row: 0, col: 0, text: 'Drawing' },
        { row: 0, col: 1, text: 'Sample' },
        { row: 5, col: 0, text: 'Polyline' },
        { row: 5, col: 1, text: 'path' },
      ],
    });
    expect(tb?.rows).toBe(6);
    expect(tb?.columns).toBe(2);
    expect(buildTableGrid(tb!).length).toBe(6);
    expect(buildTableGrid(tb!)[0]?.length).toBe(2);
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

  it('uses the focused run when that script cache has no table', () => {
    const visible = collectVisiblePineTables({
      scriptIds: ['draw'],
      runResults: { draw: { drawings: [] } },
      lastRun: { drawings: [sampleTable] },
      lastRunOwnerId: 'draw',
    });
    expect(visible.length).toBe(1);
    expect(visible[0]!.ownerId).toBe('draw');
    expect(visible[0]!.cells?.[0]?.text).toBe('A');
  });

  it('does not pull a focused run that belongs to another script', () => {
    const visible = collectVisiblePineTables({
      scriptIds: ['draw'],
      runResults: {},
      lastRun: { drawings: [sampleTable] },
      lastRunOwnerId: 'other',
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

describe('cellTextVerticalAlign', () => {
  it('maps valign tokens (prefixed, bare, aliases)', () => {
    expect(cellTextVerticalAlign('text.top')).toBe('top');
    expect(cellTextVerticalAlign('top')).toBe('top');
    expect(cellTextVerticalAlign('text.bottom')).toBe('bottom');
    expect(cellTextVerticalAlign('bottom')).toBe('bottom');
    expect(cellTextVerticalAlign('middle')).toBe('middle');
    expect(cellTextVerticalAlign(undefined)).toBe('middle');
    expect(cellTextVerticalAlign('nonsense')).toBe('middle');
  });
});

describe('parsePineTableCell valign/text_size', () => {
  it('parses snake/camel/size alias keys', () => {
    const c = parsePineTableCell({
      row: 1,
      col: 2,
      text: 'x',
      text_valign: 'text.top',
      textSize: 'small',
    });
    expect(c).toMatchObject({ row: 1, col: 2, text_valign: 'text.top', text_size: 'small' });
  });

  it('parses bottom-panel width/height/tooltip hints', () => {
    const c = parsePineTableCell({ row: 0, col: 1, text: 'hi', width: 30, height: 12, tooltip: 'tip' });
    expect(c).toMatchObject({ width: 30, height: 12, tooltip: 'tip' });
    expect(parsePineTableCell({ row: 0, col: 0, text: 'x', width: 0 })?.width).toBeUndefined();
    expect(parsePineTableCell({ row: 0, col: 0, text: 'x', tooltip: '   ' })?.tooltip).toBeUndefined();
  });
});

describe('normalizePineTable bottom fields', () => {
  it('keeps force_overlay and merged ranges', () => {
    const tb = normalizePineTable({
      type: 'table',
      rows: 2,
      columns: 2,
      force_overlay: true,
      merged_cells: [
        [0, 0, 0, 1],
        [5, 5, 6, 6],
      ],
      cells: [{ row: 0, col: 0, text: 'm' }],
    });
    expect(tb?.force_overlay).toBe(true);
    expect(tb?.merged_cells).toEqual([[0, 0, 0, 1]]);
  });
});

describe('normalizeMergedCells', () => {
  it('drops out-of-bounds and single-cell merges', () => {
    expect(normalizeMergedCells([[0, 0, 1, 1]], 2, 2)).toEqual([[0, 0, 1, 1]]);
    expect(normalizeMergedCells([[0, 0, 0, 0]], 2, 2)).toBeUndefined();
    expect(normalizeMergedCells([[0, 0, 9, 9]], 2, 2)).toBeUndefined();
    expect(normalizeMergedCells('nope', 2, 2)).toBeUndefined();
  });
});

describe('bottom panel location helpers', () => {
  const a = normalizePineTable(sampleTable, 's1')!;
  const b = normalizePineTable(sampleTable, 's2')!;

  it('splits chart vs bottom by location map', () => {
    const split = splitTablesByLocation([a, b], { s2: 'bottom' });
    expect(split.chart.map((t) => t.ownerId)).toEqual(['s1']);
    expect(split.bottom.map((t) => t.ownerId)).toEqual(['s2']);
    expect(isTablesInBottom({ s2: 'bottom' }, 's2')).toBe(true);
    expect(isTablesInBottom({ s2: 'bottom' }, 's1')).toBe(false);
    expect(isTablesInBottom(undefined, 's1')).toBe(false);
  });

  it('groups bottom tables by owner in order', () => {
    const groups = groupBottomTablesByOwner([a, b, { ...a }]);
    expect(groups.map((g) => g.ownerId)).toEqual(['s1', 's2']);
    expect(groups[0]!.tables.length).toBe(2);
  });

  it('computes proportional column fractions from width hints', () => {
    const tb = normalizePineTable({
      type: 'table',
      rows: 1,
      columns: 2,
      cells: [
        { row: 0, col: 0, text: 'a', width: 10 },
        { row: 0, col: 1, text: 'b', width: 30 },
      ],
    })!;
    const f = bottomPanelColumnFractions(tb);
    expect(f[0]!).toBeCloseTo(0.25, 5);
    expect(f[1]!).toBeCloseTo(0.75, 5);
    const even = bottomPanelColumnFractions(normalizePineTable(sampleTable)!);
    expect(even[0]!).toBeCloseTo(0.5, 5);
  });

  it('detects height hints', () => {
    const withH = normalizePineTable({
      type: 'table',
      rows: 1,
      columns: 1,
      cells: [{ row: 0, col: 0, text: 'a', height: 20 }],
    })!;
    expect(bottomPanelHasHeightHints(withH)).toBe(true);
    expect(bottomPanelHasHeightHints(normalizePineTable(sampleTable)!)).toBe(false);
  });
});
