/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Architecture plan: predefinition match, drift naming, store patch shape.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetOnchainCatalogForTests } from '../src/onchain/catalog';
import {
  PREDEFINITIONS,
  SLOTS,
  configFromActive,
  configsEqual,
  derivePlan,
  findPredefinition,
  matchPredefinition,
  pluginsFor,
  toStorePatch,
  type AxisConfig,
} from '../src/ui/architecture/plan';
import { applyArchitecture } from '../src/ui/architecture/apply';
import { setActivePlugin, setStore, store } from '../src/store';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetOnchainCatalogForTests();
  _resetBootstrapFlag();
  ensureBuiltins();
  setActivePlugin('source', 'binance-rest');
  setActivePlugin('stream', 'binance-ws');
  setActivePlugin('engine', 'server');
  setActivePlugin('storage', 'local');
  setStore('activePlugins', 'dataset', '');
});

const liveCrypto = (): AxisConfig =>
  PREDEFINITIONS.find((p) => p.id === 'live-crypto')!.config;

describe('catalogs', () => {
  it('lists built-in plugins for every slot', () => {
    expect(pluginsFor('source').some((p) => p.id === 'binance-rest')).toBe(true);
    expect(pluginsFor('stream').some((p) => p.id === 'binance-ws')).toBe(true);
    expect(pluginsFor('engine').some((p) => p.id === 'pyodide')).toBe(true);
    expect(pluginsFor('storage').some((p) => p.id === 'local')).toBe(true);
    expect(pluginsFor('dataset').some((p) => p.id === 'defillama-tvl')).toBe(true);
  });
});

describe('derivePlan', () => {
  it('keeps a clean name on an exact predefinition', () => {
    const plan = derivePlan(liveCrypto(), 'offline-lab');
    expect(plan.pristine).toBe(true);
    expect(plan.base.id).toBe('live-crypto');
    expect(plan.planName).toBe('Live Crypto');
    expect(plan.drifts).toHaveLength(0);
  });

  it('names swapped slots as +n', () => {
    const cfg = { ...liveCrypto(), engine: 'pyodide' };
    const plan = derivePlan(cfg, 'live-crypto');
    expect(plan.pristine).toBe(false);
    expect(plan.swapped).toBe(1);
    expect(plan.planName).toBe('Live Crypto +1');
  });

  it('names a switched-off optional slot as −n', () => {
    const cfg = { ...liveCrypto(), stream: null };
    const plan = derivePlan(cfg, 'live-crypto');
    expect(plan.removed).toBe(1);
    expect(plan.planName).toBe('Live Crypto −1');
  });

  it('combines added and removed counters', () => {
    const cfg = { ...liveCrypto(), stream: null, dataset: 'defillama-tvl' };
    const plan = derivePlan(cfg, 'live-crypto');
    expect(plan.added).toBe(1);
    expect(plan.removed).toBe(1);
    expect(plan.planName).toBe('Live Crypto +1 −1');
  });

  it('snaps to another predefinition when the wiring matches it', () => {
    const offline = PREDEFINITIONS.find((p) => p.id === 'offline-lab')!.config;
    const plan = derivePlan(offline, 'live-crypto');
    expect(plan.base.id).toBe('offline-lab');
    expect(plan.planName).toBe('Offline Lab');
    expect(plan.pristine).toBe(true);
  });

  it('rolls up offline vs network requirements', () => {
    const offline = derivePlan(
      PREDEFINITIONS.find((p) => p.id === 'offline-lab')!.config,
      'offline-lab',
    );
    expect(offline.requirements.fullyOffline).toBe(true);
    expect(offline.requirements.needsNetwork).toBe(false);

    const live = derivePlan(liveCrypto(), 'live-crypto');
    expect(live.requirements.fullyOffline).toBe(false);
    expect(live.requirements.needsNetwork).toBe(true);
  });
});

describe('toStorePatch / configFromActive', () => {
  it('emits the Solid activePlugins shape (not kind:id → true)', () => {
    const patch = toStorePatch(liveCrypto());
    expect(patch.source).toBe('binance-rest');
    expect(patch.engine).toBe('server');
    expect(patch.live).toEqual({ streamId: 'binance-ws', enabled: true });
    expect(patch.activePlugins).toEqual({
      source: 'binance-rest',
      stream: 'binance-ws',
      engine: 'server',
      storage: 'local',
      dataset: '',
    });
    expect(patch.keys['source:binance-rest']).toBe(true);
  });

  it('round-trips store selection', () => {
    const cfg = configFromActive(
      {
        source: 'mock-walk',
        stream: 'mock-poll',
        engine: 'pyodide',
        storage: 'local',
        dataset: '',
      },
      {},
    );
    expect(cfg.dataset).toBe(null);
    expect(cfg.stream).toBe('mock-poll');
    expect(matchPredefinition(cfg)?.id).toBe('offline-lab');
  });
});

describe('applyArchitecture', () => {
  it('commits Offline Lab to the store', () => {
    const offline = PREDEFINITIONS.find((p) => p.id === 'offline-lab')!;
    const result = applyArchitecture(offline.config, 'live-crypto');
    expect(result.planName).toBe('Offline Lab');
    expect(store.source).toBe('mock-walk');
    expect(store.engine).toBe('pyodide');
    expect(store.activePlugins.storage).toBe('local');
    expect(store.live.streamId).toBe('mock-poll');
    expect(store.activePlugins.dataset || '').toBe('');
  });

  it('clears the stream slot and records dataset', () => {
    const csv = PREDEFINITIONS.find((p) => p.id === 'csv-desk')!;
    applyArchitecture(csv.config, 'csv-desk');
    expect(store.source).toBe('csv-upload');
    expect(store.live.streamId).toBe('');
    expect(store.activePlugins.stream).toBe('');

    const onchain = PREDEFINITIONS.find((p) => p.id === 'on-chain')!;
    applyArchitecture(onchain.config, 'on-chain');
    expect(store.activePlugins.dataset).toBe('defillama-tvl');
    expect(store.source).toBe('geckoterminal-ohlcv');
  });
});

describe('predefinitions', () => {
  it('covers every compose-recipe id', () => {
    expect(PREDEFINITIONS.map((p) => p.id).sort()).toEqual(
      ['csv-desk', 'live-crypto', 'offline-lab', 'on-chain', 'team-cloud'].sort(),
    );
    expect(SLOTS).toHaveLength(5);
    expect(findPredefinition('missing')).toBe(null);
    expect(configsEqual(liveCrypto(), liveCrypto())).toBe(true);
  });
});
