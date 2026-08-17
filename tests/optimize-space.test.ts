/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { defaultParamFromInput, randomAssignment, spaceReady, toPyneSpace } from '../src/optimize/space';
import { _pickWinnerForTests, _scoreStatsForTests } from '../src/optimize/client';
import type { ScriptInputDef } from '../src/results/script-inputs';

function def(partial: Partial<ScriptInputDef> & Pick<ScriptInputDef, 'id' | 'title' | 'type'>): ScriptInputDef {
  return { default: 1, ...partial };
}

describe('HPO space', () => {
  it('skips source/color inputs', () => {
    expect(defaultParamFromInput(def({ id: 's', title: 'Src', type: 'source' }))).toBeNull();
    expect(defaultParamFromInput(def({ id: 'c', title: 'Col', type: 'color' }))).toBeNull();
  });

  it('requires min/max before enabling numeric', () => {
    const p = defaultParamFromInput(def({ id: 'n', title: 'Len', type: 'int' }));
    expect(p?.enabled).toBe(false);
    expect(spaceReady([p!]).ok).toBe(false);
  });

  it('enables int with minval/maxval', () => {
    const p = defaultParamFromInput(def({ id: 'n', title: 'Len', type: 'int', min: 2, max: 20, step: 1 }));
    expect(p?.enabled).toBe(true);
    expect(spaceReady([p!]).ok).toBe(true);
  });

  it('random stays in bounds', () => {
    const p = defaultParamFromInput(def({ id: 'n', title: 'Len', type: 'int', min: 2, max: 5 }))!;
    for (let i = 0; i < 20; i++) {
      const a = randomAssignment([p], () => i / 20);
      const n = Number(a.Len);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('toPyneSpace drops disabled', () => {
    const a = defaultParamFromInput(def({ id: 'n', title: 'Len', type: 'int', min: 2, max: 8 }))!;
    const b = { ...a, name: 'Off', enabled: false };
    expect(toPyneSpace([a, b]).params).toHaveLength(1);
  });
});

describe('HPO objective', () => {
  it('rejects low trade counts', () => {
    const s = {
      totalPnl: 10,
      winRate: 50,
      profitFactor: 1.2,
      avgTrade: 1,
      avgWin: 2,
      avgLoss: -1,
      maxDD: 0.1,
      wins: 2,
      losses: 1,
      trades: 3,
    };
    expect(_scoreStatsForTests(s, 'net_pnl', 5)).toBe(Number.NEGATIVE_INFINITY);
    expect(_scoreStatsForTests({ ...s, trades: 8 }, 'net_pnl', 5)).toBe(10);
  });

  it('does not pick a winner when every trial is rejected', () => {
    const w = _pickWinnerForTests(
      [
        { index: 0, params: { A: 1 }, isScore: Number.NEGATIVE_INFINITY, oosScore: null },
        { index: 1, params: { A: 2 }, error: 'boom' },
      ],
      'holdout',
    );
    expect(w).toBeNull();
  });
});
