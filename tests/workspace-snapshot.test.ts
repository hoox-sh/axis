// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure workspace snapshot build / parse / apply (no Solid store, no disk wipe).
 */

import { describe, expect, it } from 'bun:test';
import {
  WORKSPACE_SNAPSHOT_KIND,
  WORKSPACE_SNAPSHOT_VERSION,
  applyWorkspaceSnapshot,
  buildWorkspaceSnapshot,
  defaultSnapshotFilename,
  parseSnapshotJson,
  WorkspaceSnapshotParseError,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotApplyFields,
} from '../src/storage/workspace-snapshot.ts';
import { defaultChartLayout } from '../src/chart/layout.ts';
import { defaultPanelChromeMap } from '../src/ui/panels/types.ts';

function sampleSource() {
  const chartLayout = defaultChartLayout({
    symbol: 'ETHUSDT',
    interval: '1h',
    exchange: 'binance',
    chartType: 'candles',
  });
  return {
    symbol: 'ETHUSDT',
    interval: '1h',
    exchange: 'binance',
    chartType: 'candles' as const,
    historyBars: 500,
    theme: 'dark' as const,
    uiScale: 1.1,
    chartLayout,
    savedLayouts: [
      {
        id: 'lay_1',
        name: 'Main',
        updatedAt: 1,
        chartLayout,
      },
    ],
    panes: [
      { id: 'price', type: 'price' as const, height: 0, order: 0, visible: true },
      { id: 'volume', type: 'volume' as const, height: 100, order: 1, visible: true },
    ],
    drawings: [
      {
        id: 'd1',
        kind: 'hline' as const,
        color: '#ff0000',
        price: 4200,
        lineWidth: 1,
        lineStyle: 'solid' as const,
      },
    ],
    drawingPrefs: {
      color: '#939fff',
      width: 2,
      lineStyle: 'dashed' as const,
      fillOpacity: 0.2,
    },
    drawingUi: {
      magnet: 'weak' as const,
      stayInMode: true,
      lastToolByGroup: { lines: 'ray' },
      hideDrawings: false,
      lockAll: false,
    },
    panelChrome: defaultPanelChromeMap(),
    scripts: [
      {
        id: 'ind_1',
        name: 'SMA',
        code: '//@version=5\nindicator("SMA")\n',
        paneId: 'price',
        visible: true,
        plots: { SMA: { color: '#0f0' } },
        inputValues: { Length: 14 },
      },
    ],
    editor: { open: true, width: 480, mode: 'docked' as const },
    profilerEnabled: true,
    inlineDebugEnabled: false,
    bars: [
      { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 2, open: 1.5, high: 2.5, low: 1, close: 2, volume: 12 },
    ],
  };
}

describe('buildWorkspaceSnapshot', () => {
  it('includes core fields and omits bars by default', () => {
    const snap = buildWorkspaceSnapshot(sampleSource(), {
      createdAt: '2026-08-01T12:00:00.000Z',
      name: 'My desk',
    });
    expect(snap.kind).toBe(WORKSPACE_SNAPSHOT_KIND);
    expect(snap.version).toBe(WORKSPACE_SNAPSHOT_VERSION);
    expect(snap.createdAt).toBe('2026-08-01T12:00:00.000Z');
    expect(snap.name).toBe('My desk');
    expect(snap.symbol).toBe('ETHUSDT');
    expect(snap.interval).toBe('1h');
    expect(snap.exchange).toBe('binance');
    expect(snap.chartType).toBe('candles');
    expect(snap.historyBars).toBe(500);
    expect(snap.theme).toBe('dark');
    expect(snap.uiScale).toBe(1.1);
    expect(snap.chartLayout?.mode).toBe('1');
    expect(snap.savedLayouts).toHaveLength(1);
    expect(snap.drawings).toHaveLength(1);
    expect(snap.drawingPrefs?.width).toBe(2);
    expect(snap.drawingUi?.magnet).toBe('weak');
    expect(snap.panelChrome?.editor?.open).toBe(true);
    expect(snap.editorPrefs?.profilerEnabled).toBe(true);
    expect(snap.editorPrefs?.editorWidth).toBe(480);
    expect(snap.scripts).toHaveLength(1);
    expect(snap.scripts?.[0]?.name).toBe('SMA');
    expect(snap.scripts?.[0]?.code).toContain('indicator');
    expect(snap.includeBars).toBe(false);
    expect(snap.bars).toBeUndefined();
  });

  it('includes bars when includeBars is true', () => {
    const snap = buildWorkspaceSnapshot(sampleSource(), { includeBars: true });
    expect(snap.includeBars).toBe(true);
    expect(snap.bars).toHaveLength(2);
    expect(snap.bars?.[0]?.close).toBe(1.5);
  });

  it('can skip savedLayouts', () => {
    const snap = buildWorkspaceSnapshot(sampleSource(), { includeSavedLayouts: false });
    expect(snap.savedLayouts).toBeUndefined();
  });

  it('does not mutate the source object', () => {
    const src = sampleSource();
    const before = JSON.stringify(src);
    buildWorkspaceSnapshot(src, { includeBars: true });
    expect(JSON.stringify(src)).toBe(before);
  });
});

describe('parseSnapshotJson', () => {
  it('round-trips build → stringify → parse', () => {
    const built = buildWorkspaceSnapshot(sampleSource(), {
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const parsed = parseSnapshotJson(JSON.stringify(built));
    expect(parsed.kind).toBe(WORKSPACE_SNAPSHOT_KIND);
    expect(parsed.symbol).toBe('ETHUSDT');
    expect(parsed.drawings).toHaveLength(1);
    expect(parsed.scripts?.[0]?.id).toBe('ind_1');
    expect(parsed.panelChrome?.watchlist?.dock).toBe('left');
  });

  it('throws on empty / invalid JSON without partial data', () => {
    expect(() => parseSnapshotJson('')).toThrow(WorkspaceSnapshotParseError);
    expect(() => parseSnapshotJson('not-json')).toThrow(WorkspaceSnapshotParseError);
    expect(() => parseSnapshotJson('[]')).toThrow(WorkspaceSnapshotParseError);
  });

  it('rejects wrong kind and future version', () => {
    expect(() =>
      parseSnapshotJson(
        JSON.stringify({
          kind: 'other',
          version: 1,
          symbol: 'X',
          interval: '1d',
          exchange: 'binance',
          chartType: 'candles',
        }),
      ),
    ).toThrow(/Unsupported snapshot kind/);

    expect(() =>
      parseSnapshotJson(
        JSON.stringify({
          kind: WORKSPACE_SNAPSHOT_KIND,
          version: 999,
          symbol: 'X',
          interval: '1d',
          exchange: 'binance',
          chartType: 'candles',
        }),
      ),
    ).toThrow(/newer than supported/);
  });

  it('accepts numeric createdAt and normalizes chartType', () => {
    const parsed = parseSnapshotJson(
      JSON.stringify({
        kind: WORKSPACE_SNAPSHOT_KIND,
        version: 1,
        createdAt: 1_700_000_000_000,
        symbol: 'btcusdt',
        interval: '15m',
        exchange: 'okx',
        chartType: 'heikinashi',
      }),
    );
    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.createdAt).toMatch(/^\d{4}-/);
    expect(parsed.chartType).toBeTruthy();
  });
});

describe('applyWorkspaceSnapshot', () => {
  it('calls assign with validated fields only once', () => {
    const snap = buildWorkspaceSnapshot(sampleSource());
    const patches: WorkspaceSnapshotApplyFields[] = [];
    const themes: string[] = [];
    const scales: number[] = [];

    applyWorkspaceSnapshot(snap, {
      assign: (f) => patches.push(f),
      applyTheme: (t) => themes.push(t),
      applyUiScale: (s) => scales.push(s),
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]!.symbol).toBe('ETHUSDT');
    expect(patches[0]!.drawings).toHaveLength(1);
    expect(patches[0]!.scripts?.[0]?.name).toBe('SMA');
    expect(patches[0]!.bars).toBeUndefined();
    expect(themes).toEqual(['dark']);
    expect(scales).toEqual([1.1]);
  });

  it('does not wipe omitted fields — only provided keys in assign', () => {
    const minimal: WorkspaceSnapshot = {
      kind: WORKSPACE_SNAPSHOT_KIND,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      symbol: 'SOLUSDT',
      interval: '5m',
      exchange: 'binance',
      chartType: 'line',
    };
    let assigned: WorkspaceSnapshotApplyFields | null = null;
    applyWorkspaceSnapshot(minimal, {
      assign: (f) => {
        assigned = f;
      },
    });
    expect(assigned).toBeTruthy();
    expect(assigned!.symbol).toBe('SOLUSDT');
    expect(assigned!.drawings).toBeUndefined();
    expect(assigned!.scripts).toBeUndefined();
    expect(assigned!.panelChrome).toBeUndefined();
    expect(assigned!.theme).toBeUndefined();
  });

  it('throws before assign on invalid snap', () => {
    let called = false;
    expect(() =>
      applyWorkspaceSnapshot({} as WorkspaceSnapshot, {
        assign: () => {
          called = true;
        },
      }),
    ).toThrow(WorkspaceSnapshotParseError);
    expect(called).toBe(false);
  });

  it('applies bars only when includeBars', () => {
    const withBars = buildWorkspaceSnapshot(sampleSource(), { includeBars: true });
    let fields: WorkspaceSnapshotApplyFields | null = null;
    applyWorkspaceSnapshot(withBars, { assign: (f) => (fields = f) });
    expect(fields!.bars).toHaveLength(2);

    const noBars = buildWorkspaceSnapshot(sampleSource(), { includeBars: false });
    // even if someone injects bars on object without flag, apply uses includeBars
    (noBars as { bars?: unknown }).bars = [{ time: 1, open: 1, high: 1, low: 1, close: 1 }];
    fields = null;
    applyWorkspaceSnapshot(noBars, { assign: (f) => (fields = f) });
    expect(fields!.bars).toBeUndefined();
  });
});

describe('defaultSnapshotFilename', () => {
  it('builds a safe json name', () => {
    const snap = buildWorkspaceSnapshot(sampleSource(), {
      name: 'Desk A / main',
      createdAt: '2026-08-01T12:00:00.000Z',
    });
    const name = defaultSnapshotFilename(snap);
    expect(name).toMatch(/^axis-workspace-/);
    expect(name).toMatch(/\.json$/);
    expect(name).toContain('2026-08-01');
    expect(name).not.toMatch(/[/\s]/);
  });
});

describe('failed parse does not apply (integration guard)', () => {
  it('parse failure leaves bag untouched', () => {
    const bag = { symbol: 'KEEP', wiped: false };
    try {
      parseSnapshotJson('{bad');
      bag.wiped = true;
    } catch {
      // expected
    }
    expect(bag.symbol).toBe('KEEP');
    expect(bag.wiped).toBe(false);
  });
});
