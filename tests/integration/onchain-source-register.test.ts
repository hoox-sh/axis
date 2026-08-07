/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Integration: ensureBuiltins registers on-chain dataset + DEX OHLCV source.
 */

import '../setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { registry } from '../../src/plugins/registry';
import {
  ensureBuiltins,
  _resetBootstrapFlag,
} from '../../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag, getSource, listSources } from '../../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../../src/storage/catalog';
import {
  DEFILLAMA_DATASET_ID,
  getDatasetPlugin,
  listDatasets,
  _resetOnchainDatasetRegistrationFlag,
} from '../../src/onchain/catalog';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetOnchainDatasetRegistrationFlag();
  _resetBootstrapFlag();
});

describe('ensureBuiltins on-chain registration', () => {
  it('registers defillama-tvl dataset + geckoterminal-ohlcv source', () => {
    ensureBuiltins();

    // DefiLlama TVL dataset plugin
    const ds = getDatasetPlugin(DEFILLAMA_DATASET_ID);
    expect(ds).toBeDefined();
    expect(ds!.id).toBe('defillama-tvl');
    expect(ds!.kind).toBe('dataset');
    expect(ds!.builtIn).toBe(true);
    expect(typeof ds!.fetchDataset).toBe('function');
    expect(listDatasets().map((d) => d.id)).toContain('defillama-tvl');
    expect(registry.getDataset?.('defillama-tvl')?.name).toBe('DefiLlama TVL');

    // GeckoTerminal DEX OHLCV historical source
    const gecko = getSource('geckoterminal-ohlcv');
    expect(gecko).toBeDefined();
    expect(gecko!.id).toBe('geckoterminal-ohlcv');
    expect(gecko!.kind).toBe('source');
    expect(gecko!.builtIn).toBe(true);
    expect(gecko!.name).toBe('GeckoTerminal DEX');
    expect(typeof gecko!.fetchHistorical).toBe('function');
    expect(listSources().map((s) => s.id)).toContain('geckoterminal-ohlcv');
    expect(registry.getSource('geckoterminal-ohlcv')?.id).toBe(
      'geckoterminal-ohlcv',
    );
  });

  it('is idempotent across repeated ensureBuiltins calls', () => {
    ensureBuiltins();
    ensureBuiltins();
    ensureBuiltins();

    expect(
      listDatasets().filter((d) => d.id === 'defillama-tvl'),
    ).toHaveLength(1);
    expect(
      listSources().filter((s) => s.id === 'geckoterminal-ohlcv'),
    ).toHaveLength(1);
  });
});
