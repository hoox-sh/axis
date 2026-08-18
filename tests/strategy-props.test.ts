// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Strategy Properties parse / rewrite helpers for Script Settings.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseStrategyDeclaration,
  resolveStrategyProps,
  applyStrategyPropsToSource,
  strategyOverridesFromDefs,
  hasStrategyDeclaration,
  normalizeStrategyEnum,
  findStrategyCall,
} from '../src/results/strategy-props.ts';

const STRAT = `//@version=6
strategy("SMA Cross", overlay=true, initial_capital=100000,
     default_qty_type=strategy.percent_of_equity, default_qty_value=10,
     commission_type=strategy.commission.percent, commission_value=0.05,
     pyramiding=2, process_orders_on_close=true)
fast = input.int(9, "Fast")
plot(close)
`;

describe('findStrategyCall / hasStrategyDeclaration', () => {
  it('finds strategy() and ignores strategy.entry', () => {
    const src = `strategy("T", overlay=true)\nstrategy.entry("L", strategy.long)\n`;
    const call = findStrategyCall(src);
    expect(call).not.toBeNull();
    expect(call!.inner).toContain('overlay=true');
    expect(hasStrategyDeclaration(src)).toBe(true);
  });

  it('returns null for indicators', () => {
    expect(hasStrategyDeclaration('indicator("x")\nplot(close)')).toBe(false);
    expect(findStrategyCall('indicator("x")')).toBeNull();
  });
});

describe('parseStrategyDeclaration', () => {
  it('reads named kwargs from multiline strategy()', () => {
    const d = parseStrategyDeclaration(STRAT);
    expect(d.initial_capital).toBe(100000);
    expect(d.default_qty_value).toBe(10);
    expect(d.pyramiding).toBe(2);
    expect(d.process_orders_on_close).toBe(true);
    expect(String(d.default_qty_type)).toContain('percent_of_equity');
    expect(d.commission_value).toBe(0.05);
  });
});

describe('resolveStrategyProps', () => {
  it('merges declaration defaults with overrides', () => {
    const defs = resolveStrategyProps(STRAT, {
      initial_capital: 50_000,
      leverage: 5,
    });
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    expect(byId.initial_capital!.default).toBe(100000);
    expect(byId.initial_capital!.value).toBe(50_000);
    expect(byId.leverage!.value).toBe(5);
    expect(byId.pyramiding!.default).toBe(2);
    expect(byId.pyramiding!.value).toBe(2);
  });

  it('uses platform defaults when declaration omits kwargs', () => {
    const defs = resolveStrategyProps('strategy("Bare")\n');
    const cap = defs.find((d) => d.id === 'initial_capital')!;
    expect(cap.default).toBe(100_000);
    expect(cap.value).toBe(100_000);
  });
});

describe('applyStrategyPropsToSource', () => {
  it('rewrites initial_capital and leverage without touching title', () => {
    const out = applyStrategyPropsToSource(STRAT, {
      initial_capital: 25000,
      leverage: 10,
      pyramiding: 0,
    });
    expect(out).toContain('strategy(');
    expect(out).toContain('"SMA Cross"');
    expect(out).toContain('initial_capital=25000');
    expect(out).toContain('leverage=10');
    expect(out).toContain('pyramiding=0');
    // still has plot / input body
    expect(out).toContain('input.int(9, "Fast")');
    expect(out).toContain('plot(close)');
  });

  it('is a no-op when overrides empty', () => {
    expect(applyStrategyPropsToSource(STRAT, {})).toBe(STRAT);
    expect(applyStrategyPropsToSource(STRAT, null)).toBe(STRAT);
  });

  it('emits qty/commission enums as bare identifiers', () => {
    const out = applyStrategyPropsToSource('strategy("T")\n', {
      default_qty_type: 'strategy.percent_of_equity',
      commission_type: 'strategy.commission.percent',
      currency: 'EUR',
    });
    expect(out).toContain('default_qty_type=strategy.percent_of_equity');
    expect(out).toContain('commission_type=strategy.commission.percent');
    expect(out).toContain('currency="EUR"');
  });
});

describe('normalizeStrategyEnum / overridesFromDefs', () => {
  it('normalizes bare qty types', () => {
    expect(normalizeStrategyEnum('default_qty_type', 'fixed')).toBe('strategy.fixed');
    expect(normalizeStrategyEnum('default_qty_type', 'percent_of_equity')).toBe(
      'strategy.percent_of_equity',
    );
    expect(normalizeStrategyEnum('commission_type', 'percent')).toBe(
      'strategy.commission.percent',
    );
  });

  it('strategyOverridesFromDefs keeps only dirty values', () => {
    const defs = resolveStrategyProps(STRAT, { initial_capital: 1 });
    const o = strategyOverridesFromDefs(defs);
    expect(o.initial_capital).toBe(1);
    expect(o.pyramiding).toBeUndefined();
    expect(o.leverage).toBeUndefined();
  });

  it('treats near-equal numbers as unchanged', () => {
    const defs = resolveStrategyProps(STRAT, {
      initial_capital: 100_000 + 1e-12,
    });
    expect(strategyOverridesFromDefs(defs).initial_capital).toBeUndefined();
  });

  it('does not string-compare mixed types', () => {
    const defs = resolveStrategyProps(STRAT, { pyramiding: '2' });
    expect(strategyOverridesFromDefs(defs).pyramiding).toBe('2');
  });
});

describe('applyStrategyPropsToSource catalog / dirty-only', () => {
  it('ignores non-catalog keys (title, overlay)', () => {
    const src = 'strategy("Old Title", overlay=true)\nplot(close)\n';
    const out = applyStrategyPropsToSource(src, {
      title: 'X',
      overlay: false,
      shorttitle: 'Nope',
    });
    expect(out).toContain('"Old Title"');
    expect(out).toContain('overlay=true');
    expect(out).not.toMatch(/\btitle\s*=/);
    expect(out).not.toContain('overlay=false');
    expect(out).not.toContain('shorttitle');
  });

  it('capital-only override does not insert default leverage / margin_*', () => {
    const out = applyStrategyPropsToSource('strategy("T")\n', {
      initial_capital: 1,
    });
    expect(out).toContain('initial_capital=1');
    expect(out).not.toContain('leverage');
    expect(out).not.toContain('margin_');
  });

  it('keeps declared margin_long when only capital is applied', () => {
    const src = 'strategy("T", margin_long=10)\n';
    const out = applyStrategyPropsToSource(src, { initial_capital: 1 });
    expect(out).toContain('margin_long=10');
    expect(out).toContain('initial_capital=1');
    expect(out).not.toContain('leverage');
  });

  it('full old-style bag rewrites declared margin; dirty-only capital does not', () => {
    const src = 'strategy("T", margin_long=10)\n';

    const full = applyStrategyPropsToSource(src, {
      leverage: 1,
      margin_long: 100,
      margin_short: 100,
    });
    expect(full).toContain('margin_long=100');
    expect(full).toContain('leverage=1');

    const capitalOnly = strategyOverridesFromDefs(
      resolveStrategyProps(src, { initial_capital: 1 }),
    );
    expect(capitalOnly).toEqual({ initial_capital: 1 });
    const applied = applyStrategyPropsToSource(src, capitalOnly);
    expect(applied).toContain('margin_long=10');
    expect(applied).not.toContain('leverage');

    const mirrored = strategyOverridesFromDefs(
      resolveStrategyProps(src, { leverage: 1, margin_long: 100 }),
    );
    expect(mirrored.leverage).toBeUndefined();
    expect(mirrored.margin_long).toBe(100);
  });
});
