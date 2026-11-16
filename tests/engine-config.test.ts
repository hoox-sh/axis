/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * One live-engine writer. Runtime field edits and the topbar switch both go
 * through `writeLiveEngine` / `saveEngineConfig`. Closing a form must not write.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { reconcile } from 'solid-js/store';
import { setStore, setActivePlugin, store } from '../src/store';
import { pluginKey } from '../src/plugins/types';
import {
  _resetEngineRegistrationFlag,
  _setCachedEngineHealthForTests,
  getCachedEngineHealth,
  subscribeEngineHealthCache,
} from '../src/engines/catalog';
import { DEFAULT_ENGINE_HEALTH } from '../src/engines/health';
import {
  runtimeHealthFromCache,
  saveEngineConfig,
  writeLiveEngine,
} from '../src/ui/runtime/engine-config';

const SERVER = pluginKey('engine', 'server');
const WORKER = pluginKey('engine', 'pyne-worker');

beforeEach(() => {
  _resetEngineRegistrationFlag();
  _setCachedEngineHealthForTests(null);
  setActivePlugin('engine', 'server');
  setStore('endpoint', 'https://kept.example');
  setStore(
    'pluginsConfig',
    reconcile({
      [SERVER]: {
        endpoint: 'https://kept.example',
        mode: 'interpret',
        preferWs: true,
        autoPrewarm: false,
      },
    }),
  );
  setStore('telemetry', 'engine', 'state', 'open');
});

describe('writeLiveEngine', () => {
  it('updates one field without clearing the endpoint or resetting telemetry', () => {
    writeLiveEngine({ engine: 'server', mode: 'compile' });
    const cfg = store.pluginsConfig[SERVER] as Record<string, unknown>;
    expect(store.engine).toBe('server');
    expect(store.endpoint).toBe('https://kept.example');
    expect(cfg['mode']).toBe('compile');
    expect(cfg['endpoint']).toBe('https://kept.example');
    expect(cfg['preferWs']).toBe(true);
    expect(store.telemetry.engine.state).toBe('open');
  });

  it('keeps the current endpoint when only the engine id changes', () => {
    writeLiveEngine({ engine: 'pyodide', statusMessage: 'Engine · pyodide' });
    expect(store.engine).toBe('pyodide');
    expect(store.activePlugins.engine).toBe('pyodide');
    expect(store.endpoint).toBe('https://kept.example');
    expect(store.statusMessage).toContain('pyodide');
  });

  it('keeps a public endpoint when switching to the edge worker', () => {
    setStore('endpoint', 'https://pynescript.online');
    writeLiveEngine({ engine: 'pyne-worker' });
    expect(store.engine).toBe('pyne-worker');
    expect(store.endpoint).toBe('https://pynescript.online');
  });

  it('mirrors a worker-family loopback seed into that engine config', () => {
    setStore('endpoint', 'http://127.0.0.1:5002');
    writeLiveEngine({ engine: 'pyne-worker' });
    expect(store.engine).toBe('pyne-worker');
    expect(store.endpoint).toBe('https://pyne-worker.cryptolinx.workers.dev');
    const cfg = store.pluginsConfig[WORKER] as Record<string, unknown>;
    expect(cfg['endpoint']).toBe('https://pyne-worker.cryptolinx.workers.dev');
  });

  it('saveEngineConfig still merges a partial write for Workers', () => {
    saveEngineConfig({
      engine: 'server',
      endpoint: 'https://pynescript.online',
      statusMessage: 'Workers · backend',
    });
    expect(store.endpoint).toBe('https://pynescript.online');
    const cfg = store.pluginsConfig[SERVER] as Record<string, unknown>;
    expect(cfg['endpoint']).toBe('https://pynescript.online');
    expect(cfg['mode']).toBe('interpret');
    expect(store.statusMessage).toBe('Workers · backend');
  });
});

describe('runtime health cache', () => {
  it('reads cached server health and ignores a stale body for other engines', () => {
    expect(runtimeHealthFromCache(null, 'server')).toBe('unknown');
    expect(runtimeHealthFromCache({ ...DEFAULT_ENGINE_HEALTH, service: 'pyne' }, 'server')).toBe(
      'healthy',
    );
    expect(runtimeHealthFromCache({ ...DEFAULT_ENGINE_HEALTH, service: 'pyne' }, 'pyodide')).toBe(
      'unknown',
    );
  });

  it('notifies subscribers when the cache is replaced', () => {
    let ticks = 0;
    const unsubscribe = subscribeEngineHealthCache(() => {
      ticks += 1;
    });
    _setCachedEngineHealthForTests({ ...DEFAULT_ENGINE_HEALTH, service: 'pyne' });
    expect(ticks).toBe(1);
    expect(getCachedEngineHealth()?.service).toBe('pyne');
    unsubscribe();
    _setCachedEngineHealthForTests(null);
    expect(ticks).toBe(1);
    expect(getCachedEngineHealth()).toBeNull();
  });
});

describe('live engine call sites', () => {
  it('topbar selectEngine uses writeLiveEngine and not setActivePlugin', () => {
    const src = readFileSync(new URL('../src/ui/Topbar.tsx', import.meta.url), 'utf8');
    const start = src.indexOf('const selectEngine');
    const end = src.indexOf('const extraEngines');
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('writeLiveEngine');
    expect(body).not.toContain('setActivePlugin');
  });

  it('Runtime closes without a save write', () => {
    const src = readFileSync(new URL('../src/ui/runtime/RuntimePage.tsx', import.meta.url), 'utf8');
    expect(src).toContain('writeLiveEngine');
    expect(src).toContain('getCachedEngineHealth');
    expect(src).toContain('runtimeHealthFromCache');
    expect(src).toContain('axis-engine-prewarm');
    expect(src).not.toContain('probeOk() === true');
    expect(src).not.toMatch(/>\s*Save\s*</);
    expect(src).toContain('onClick={props.onClose}');
    expect(src).toContain('Close');
  });
});
