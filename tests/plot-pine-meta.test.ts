/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Declared plot meta (`plots[name].pine`) must track the latest run: a re-run
 * that drops `display=` / `linewidth=` clears the declaration instead of
 * leaving the panel showing a style the script no longer has.
 */
import '../tests/setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import { setStore, store } from '../src/store';
import { updateIndicatorStore, type StoreUpdateContext } from '../src/indicators/apply-store';
import { makeBars } from './fixtures/bars';

const bars = makeBars(3, 1_700_000_000, 60);
const values = bars.map(() => 1);

function ctx(overrides: Partial<StoreUpdateContext> = {}): StoreUpdateContext {
  return {
    epoch: 0,
    result: {
      status: 'success',
      plots: values,
      series: { a: values },
      events: [],
      meta: { overlay: true, script_name: 'Decl' },
    },
    silent: false,
    indicatorId: undefined,
    opts: { skipEditorDraft: true, openResults: false },
    script: '//@version=6\nindicator("Decl")\nplot(close)',
    paneId: 'price',
    overlay: true,
    existing: undefined,
    overlayLines: [],
    overlayOhlc: [],
    split: { lines: [], ohlc: [], bgcolors: [], barcolors: [], fills: [] } as never,
    ohlcvTimes: bars.map((b) => b.time),
    seriesMap: { a: values },
    plotMeta: {},
    seriesEntries: [['a', values]],
    scriptName: 'Decl',
    bars,
    ...overrides,
  };
}

describe('declared plot meta on re-run', () => {
  beforeEach(() => {
    setStore('scripts', []);
    setStore('bars', bars);
  });

  it('clears plots[name].pine when a re-run declares no style', () => {
    updateIndicatorStore(
      ctx({ plotMeta: { a: { title: 'A', kind: 'plot', display: 15, linewidth: 3 } } }),
    );
    const created = store.scripts[0]!;
    expect(created.plots.a?.pine?.display).toBe(15);
    expect(created.plots.a?.pine?.linewidth).toBe(3);

    updateIndicatorStore(
      ctx({
        indicatorId: created.id,
        existing: { plots: created.plots },
        plotMeta: { a: { title: 'A', kind: 'plot' } },
      }),
    );
    const after = store.scripts.find((s) => s.id === created.id)!;
    expect(after.plots.a?.pine).toBeUndefined();
  });

  it('keeps panel overrides when the declaration is cleared', () => {
    updateIndicatorStore(
      ctx({ plotMeta: { a: { title: 'A', kind: 'plot', display: 15 } } }),
    );
    const created = store.scripts[0]!;
    setStore('scripts', (list) =>
      list.map((s) =>
        s.id === created.id
          ? { ...s, plots: { ...s.plots, a: { ...s.plots.a!, display: 2, linestyle: 'dashed' } } }
          : s,
      ),
    );

    updateIndicatorStore(
      ctx({
        indicatorId: created.id,
        existing: { plots: store.scripts[0]!.plots },
        plotMeta: { a: { title: 'A', kind: 'plot' } },
      }),
    );
    const after = store.scripts.find((s) => s.id === created.id)!;
    expect(after.plots.a?.pine).toBeUndefined();
    expect(after.plots.a?.display).toBe(2);
    expect(after.plots.a?.linestyle).toBe('dashed');
  });
});
