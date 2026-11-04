/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import '../tests/setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { setStore, store, clearLogs, ROLLING_WINDOW_MIN } from '../src/store';
import { loadSymbolData, _resetLoadGeneration } from '../src/data/load-symbol';
import { _resetBarsCacheForTests } from '../src/data/bars-cache';
import { _resetDataSourceManagerForTests } from '../src/data/data-source-manager';
import { _resetDsmOrchestratorForTests } from '../src/data/dsm-orchestrator';
import {
  clearDataManagerSelection,
  DATA_MANAGER_SOURCE_ID,
  resolveDataManagerVenueSource,
} from '../src/data/data-manager-source';
import {
  _drainDatasetWritesForTests,
  _resetDatasetStoreForTests,
} from '../src/data/dataset-store';
import { _resetDatasetSinksForTests } from '../src/data/dataset-sinks';

beforeEach(async () => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  _resetLoadGeneration();
  await _drainDatasetWritesForTests();
  _resetDatasetStoreForTests();
  _resetDatasetSinksForTests();
  await _resetBarsCacheForTests();
  _resetDataSourceManagerForTests();
  _resetDsmOrchestratorForTests();
  clearDataManagerSelection();
  ensureBuiltins();
  clearLogs();
  setStore('bars', []);
  setStore('scripts', []);
  setStore('source', DATA_MANAGER_SOURCE_ID);
  setStore('historyBars', 800);
  setStore('rollingWindowBars', ROLLING_WINDOW_MIN);
  setStore('status', 'idle');
  setStore('statusMessage', '');
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'binance-ws',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
  // Avoid engine-owned short-circuit
  setStore('engine', 'pyodide');
});

describe('data-manager cold start', () => {
  it('resolveDataManagerVenueSource follows binance-ws → binance-rest', () => {
    expect(resolveDataManagerVenueSource('binance-ws')).toBe('binance-rest');
  });

  it('loadSymbolData auto-starts DSM and paints without No cached dataset', async () => {
    // Stick selection to mock-walk so the cold-start job does not hit the network.
    const { setDataManagerSelection } = await import('../src/data/data-manager-source');
    setDataManagerSelection('mock-walk', 'ETHUSDT', '1h');
    const ok = await loadSymbolData('ETHUSDT', '1h', DATA_MANAGER_SOURCE_ID);
    expect(ok).toBe(true);
    expect(store.status).not.toBe('error');
    expect(store.statusMessage || '').not.toMatch(/No cached dataset/i);
    expect(store.bars.length).toBeGreaterThan(0);
    expect(store.symbol).toBe('ETHUSDT');
  }, 30_000);
});
