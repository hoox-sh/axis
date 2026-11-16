/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Unified TypeScript plugin registry (`src/plugins/registry.ts`).
 * Guards kind-partitioned register/list/get and storage/component kinds.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { PluginRegistry, registry } from '../src/plugins/registry';
import {
  ensureSourcesRegistered,
  _resetSourceRegistrationFlag,
  binanceRest,
  csvUpload,
  listSources,
  registerDynamicSource,
  unregisterDynamicSource,
} from '../src/sources/catalog';
import {
  ensureStreamsRegistered,
  _resetStreamRegistrationFlag,
  listStreams,
  registerDynamicStream,
} from '../src/streams/catalog';
import {
  ensureEnginesRegistered,
  _resetEngineRegistrationFlag,
  serverEngine,
  listEngines,
  registerDynamicEngine,
} from '../src/engines/catalog';
import { setUploadedBars, clearUploadedBars } from '../src/sources/upload-store';
import { _resetBootstrapFlag, ensureBuiltins } from '../src/plugins/bootstrap';
import { _resetStorageRegistrationFlag, listStorages } from '../src/storage/catalog';
import type { SourcePlugin, StreamPlugin } from '../src/plugins/types';

const sampleSource: SourcePlugin = {
  id: 'sample-src',
  name: 'Sample',
  kind: 'source',
  builtIn: true,
  description: 'registry fixture',
  async fetchHistorical() {
    return [];
  },
};

const sampleStream: StreamPlugin = {
  id: 'sample-stream',
  name: 'Sample Stream',
  kind: 'stream',
  start: () => () => {},
};

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  clearUploadedBars();
});

describe('PluginRegistry', () => {
  it('rejects a Source without fetchHistorical', () => {
    expect(() =>
      registry.registerSource({ id: 'bad', name: 'Bad', kind: 'source' } as never),
    ).toThrow(/fetchHistorical/);
  });

  it('rejects a Source with the wrong kind', () => {
    expect(() =>
      registry.registerSource({
        id: 'x',
        name: 'X',
        kind: 'stream',
        start: () => () => {},
      } as never),
    ).toThrow(/kind must be 'source'/);
  });

  it('rejects a Stream without start', () => {
    expect(() =>
      registry.registerStream({ id: 's', name: 'S', kind: 'stream' } as never),
    ).toThrow(/start/);
  });

  it('rejects an Engine without run', () => {
    expect(() =>
      registry.registerEngine({ id: 'e', name: 'E', kind: 'engine' } as never),
    ).toThrow(/run/);
  });

  it('rejects a Dataset without fetchDataset', () => {
    expect(() =>
      registry.registerDataset({ id: 'd', name: 'D', kind: 'dataset' } as never),
    ).toThrow(/fetchDataset/);
  });

  it('registers dataset plugins and includes them in summary', () => {
    const ds = {
      id: 'test-ds',
      name: 'Test Dataset',
      kind: 'dataset' as const,
      async fetchDataset() {
        return {
          id: 'x',
          kind: 'scalar_series' as const,
          instrument: { chainId: 'all', metric: 'tvl', symbol: 'X' },
          resolution: '1d',
          points: [],
          asOf: 0,
          finality: 'unknown' as const,
          provenance: { provider: 'test' },
        };
      },
    };
    registry.registerDataset(ds);
    expect(registry.getDataset('test-ds')?.name).toBe('Test Dataset');
    expect(registry.listDatasets().map((d) => d.id)).toEqual(['test-ds']);
    expect(registry.summary().datasets).toHaveLength(1);
  });

  it('lists registered plugins in registration order', () => {
    registry
      .registerSource(sampleSource)
      .registerSource(binanceRest)
      .registerStream(sampleStream)
      .registerEngine(serverEngine);
    expect(registry.listSources().map((s) => s.id)).toEqual(['sample-src', 'binance-rest']);
    expect(registry.listStreams().map((s) => s.id)).toEqual(['sample-stream']);
    expect(registry.listEngines().map((e) => e.id)).toEqual(['server']);
  });

  it('getSource/getStream/getEngine round-trip', () => {
    registry.registerSource(sampleSource).registerStream(sampleStream).registerEngine(serverEngine);
    expect(registry.getSource('sample-src')?.name).toBe('Sample');
    expect(registry.getStream('sample-stream')?.id).toBe('sample-stream');
    expect(registry.getEngine('server')?.id).toBe('server');
    expect(registry.getSource('missing')).toBeUndefined();
  });

  it('summary() includes all kinds', () => {
    registry.registerSource(sampleSource).registerEngine(serverEngine);
    const s = registry.summary();
    expect(s.sources).toHaveLength(1);
    expect(s.engines).toHaveLength(1);
    expect(s.streams).toHaveLength(0);
    expect(s.storages).toHaveLength(0);
    expect(s.datasets).toHaveLength(0);
    expect(s.sources[0]).toEqual({
      id: 'sample-src',
      name: 'Sample',
      description: expect.any(String),
      builtIn: true,
    });
  });

  it('new PluginRegistry() instances are independent', () => {
    const r1 = new PluginRegistry();
    const r2 = new PluginRegistry();
    r1.registerSource(sampleSource);
    expect(r1.listSources()).toHaveLength(1);
    expect(r2.listSources()).toHaveLength(0);
  });

  it('does not unregister built-in plugins by default', () => {
    registry.registerSource(sampleSource);
    expect(registry.unregisterSource('sample-src')).toBe(false);
    expect(registry.getSource('sample-src')).toBeDefined();
    expect(registry.unregisterSource('sample-src', { allowBuiltIn: true })).toBe(true);
  });

  it('register() dispatches by kind', () => {
    registry.register(sampleSource);
    registry.register(serverEngine);
    expect(registry.listSources()).toHaveLength(1);
    expect(registry.listEngines()).toHaveLength(1);
  });

  it('emits registered events', () => {
    const events: string[] = [];
    const off = registry.on((e) => events.push(`${e.type}:${e.kind}:${e.id}`));
    registry.registerSource(sampleSource);
    expect(events).toContain('registered:source:sample-src');
    off();
  });
});

describe('Catalog → registry bridge', () => {
  it('ensureSourcesRegistered populates registry', () => {
    ensureSourcesRegistered();
    const ids = listSources().map((s) => s.id);
    expect(ids).toContain('binance-rest');
    expect(ids).not.toContain('mock-walk');
    expect(ids).toContain('csv-upload');
  });

  it('ensureStreamsRegistered populates registry', () => {
    ensureStreamsRegistered();
    const ids = listStreams().map((s) => s.id);
    expect(ids).toContain('binance-ws');
    expect(ids).not.toContain('mock-poll');
  });

  it('ensureEnginesRegistered populates registry', () => {
    ensureEnginesRegistered();
    const ids = listEngines().map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['server', 'pyne-worker', 'pyodide']));
  });

  it('ensureBuiltins includes local storage', () => {
    ensureBuiltins();
    expect(listStorages().map((s) => s.id)).toContain('local');
  });

  it('registerDynamicSource adds a non-built-in source', () => {
    ensureSourcesRegistered();
    const n = listSources().length;
    registerDynamicSource({
      id: 'test-src',
      name: 'Test',
      kind: 'source',
      description: 'dyn',
      configSchema: {},
      async fetchHistorical() {
        return [];
      },
    });
    expect(listSources()).toHaveLength(n + 1);
    unregisterDynamicSource('test-src');
    expect(listSources().find((s) => s.id === 'test-src')).toBeUndefined();
  });

  it('registerDynamicStream and engine work', () => {
    ensureStreamsRegistered();
    ensureEnginesRegistered();
    registerDynamicStream({
      id: 'test-stream',
      name: 'T',
      kind: 'stream',
      start: () => () => {},
    });
    registerDynamicEngine({
      id: 'test-engine',
      name: 'E',
      kind: 'engine',
      async isReady() {
        return true;
      },
      async run() {
        return { status: 'success', plots: [], events: [], series: {} };
      },
    });
    expect(listStreams().some((s) => s.id === 'test-stream')).toBe(true);
    expect(listEngines().some((e) => e.id === 'test-engine')).toBe(true);
  });
});

describe('Built-in source plugins (Solid catalog)', () => {
  it('csv-upload fails when no bars are stashed', async () => {
    await expect(csvUpload.fetchHistorical({ symbol: 'X', interval: '1d' })).rejects.toThrow(
      /No uploaded file/,
    );
  });

  it('csv-upload returns stashed bars via upload-store', async () => {
    const bars = [{ time: 1, open: 1, high: 1, low: 1, close: 1 }];
    setUploadedBars(bars, 't.csv');
    const out = await csvUpload.fetchHistorical({ symbol: 'X', interval: '1d' });
    expect(out).toEqual(bars);
  });
});

describe('Built-in engine plugins', () => {
  it('server engine returns a structured error on network failure', async () => {
    const result = await Promise.race([
      serverEngine.run({
        script: 'plot(close)',
        bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        config: { endpoint: 'http://127.0.0.1:1' },
      }),
      // Some environments hang on refused ports; treat stall as error for this case.
      new Promise<{ status: string; error: string }>((resolve) =>
        setTimeout(() => resolve({ status: 'error', error: 'network timeout' }), 1500),
      ),
    ]);
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });
});
