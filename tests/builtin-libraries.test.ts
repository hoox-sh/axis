/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * First-party built-in Pine libraries (`axis/*`) and the built-ins that
 * consume them. The engine-level verification lives in the AXIS local engine
 * (POST /run + /lsp/diagnostics); these tests pin the catalog surface,
 * resolution order (built-in registry first, published cache second), and
 * the runner payload.
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  AXIS_PINE_BANNER,
  BUILTIN_LIBRARIES,
  BUILTIN_SCRIPTS,
  getBuiltinLibrary,
  getBuiltinScript,
  resolveBuiltinLibraryImports,
} from '../src/indicators/builtins';
import { parseLibraryDeclaration, parseLibraryImports } from '../src/storage/library-publish';
import {
  _resetPublishedCacheForTests,
  publishLibrary,
  resolveLibrariesForScript,
} from '../src/storage/library-publish-io';
import { applyBuiltinScript } from '../src/indicators/builtins';
import {
  setStore,
  store,
  clearLogs,
  setActivePlugin,
  setEditorInputValues,
  setIndicatorPanelOpen,
  setStore as setStoreRaw,
} from '../src/store';
import { setManager } from '../src/chart/manager-access';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { SAMPLE_BARS } from './fixtures/bars';

const BANNER = AXIS_PINE_BANNER;
const BANNED = [/copyright\s*\(c\)\s*tradingview/i, /tradingview,\s*inc/i, /©\s*tradingview/i];

describe('BUILTIN_LIBRARIES catalog', () => {
  it('ships exactly the two first-party libraries under the axis namespace', () => {
    expect(BUILTIN_LIBRARIES.length).toBe(2);
    for (const lib of BUILTIN_LIBRARIES) {
      expect(lib.namespace).toBe('axis');
      expect(lib.version).toBe(1);
      expect(lib.source.startsWith(BANNER)).toBe(true);
      expect(lib.source).toContain('//@version=6');
      expect(lib.source).toContain(`library("${lib.name}")`);
      expect(lib.description.length).toBeGreaterThan(20);
      for (const re of BANNED) expect(lib.source).not.toMatch(re);
    }
    expect(BUILTIN_LIBRARIES.map((l) => l.name).sort()).toEqual(['AxisMa', 'AxisOsc']);
  });

  it('declares only UDTs with full field typing and exported constructors/methods', () => {
    for (const lib of BUILTIN_LIBRARIES) {
      // every library declares at least one exported UDT and one exported method
      expect(lib.source).toMatch(/export type \w+/);
      expect(lib.source).toMatch(/export method \w+\(/);
      expect(lib.source).toMatch(/export new\w*\(/);
      // the declaration parser agrees on the library name
      expect(parseLibraryDeclaration(lib.source)?.name).toBe(lib.name);
    }
  });

  it('chain implementations use flat parallel arrays, not nested stage UDTs', () => {
    // Engine constraint: arrays of UDTs whose fields are themselves UDTs read
    // back as na across the library boundary — legs must be flat UDTs in
    // parallel arrays plus an int order array. See libraries.ts.
    const ma = getBuiltinLibrary('axis', 'AxisMa', 1)!.source;
    const osc = getBuiltinLibrary('axis', 'AxisOsc', 1)!.source;
    expect(ma).toContain('array<EmaState>');
    expect(ma).toContain('array<RmaState>');
    expect(ma).toContain('array<int>');
    expect(ma).not.toContain('MaStage');
    expect(osc).toContain('array<RsiState>');
    expect(osc).toContain('array<AtrState>');
    expect(osc).toContain('array<int>');
    expect(osc).not.toContain('OscStage');
  });

  it('getBuiltinLibrary resolves exact coordinates and rejects everything else', () => {
    expect(getBuiltinLibrary('axis', 'AxisMa', 1)?.name).toBe('AxisMa');
    expect(getBuiltinLibrary('axis', 'AxisOsc', 1)?.name).toBe('AxisOsc');
    expect(getBuiltinLibrary('axis', 'AxisMa', 2)).toBeUndefined();
    expect(getBuiltinLibrary('axis', 'AxisNope', 1)).toBeUndefined();
    expect(getBuiltinLibrary('user', 'AxisMa', 1)).toBeUndefined();
  });

  it('resolveBuiltinLibraryImports splits builtin hits from the rest', () => {
    const specs = parseLibraryImports(
      'import axis/AxisMa/1 as ma\nimport axis/AxisOsc/1 as osc\nimport user/Thing/2 as t\n',
    );
    const { libraries, rest } = resolveBuiltinLibraryImports(specs);
    expect(libraries.map((l) => l.name)).toEqual(['AxisMa', 'AxisOsc']);
    expect(rest).toEqual([{ namespace: 'user', name: 'Thing', version: 2, alias: 't' }]);
  });
});

describe('resolveLibrariesForScript with built-in axis/* imports', () => {
  beforeEach(() => {
    _resetPublishedCacheForTests();
    setStore('pluginsConfig', {});
  });

  it('resolves built-in imports offline with an empty cache and no git', async () => {
    const code = getBuiltinScript('axis-kit-ema')!.code;
    expect(code).toContain('import axis/AxisMa/1 as axisMa');
    const { libraries, missing } = await resolveLibrariesForScript(code);
    expect(missing).toEqual([]);
    expect(libraries).toHaveLength(1);
    expect(libraries[0]).toMatchObject({ namespace: 'axis', name: 'AxisMa', version: 1 });
    expect(libraries[0].source).toContain('export type EmaState');
  });

  it('resolves both libraries when a consumer imports both', async () => {
    const code =
      '//@version=6\nindicator("x")\nimport axis/AxisMa/1 as ma\nimport axis/AxisOsc/1 as osc\nplot(close)\n';
    const { libraries, missing } = await resolveLibrariesForScript(code);
    expect(missing).toEqual([]);
    expect(libraries.map((l) => l.name).sort()).toEqual(['AxisMa', 'AxisOsc']);
  });

  it('leaves unknown axis/* imports to the published path (missing here)', async () => {
    const code = '//@version=6\nindicator("x")\nimport axis/AxisFuture/9 as f\nplot(close)\n';
    const { libraries, missing } = await resolveLibrariesForScript(code);
    expect(libraries).toEqual([]);
    expect(missing).toEqual([{ namespace: 'axis', name: 'AxisFuture', version: 9, alias: 'f' }]);
  });

  it('falls back to the published cache for non-builtin axis libraries', async () => {
    const lib = '//@version=6\nlibrary("AxisFuture")\nexport answer() => 42\n';
    await publishLibrary(lib, { namespace: 'axis', origin: 'manual' });
    const code = '//@version=6\nindicator("x")\nimport axis/AxisFuture/1 as f\nplot(f.answer())\n';
    const { libraries, missing } = await resolveLibrariesForScript(code);
    expect(missing).toEqual([]);
    expect(libraries).toHaveLength(1);
    expect(libraries[0].name).toBe('AxisFuture');
  });

  it('rewritten built-ins resolve their libraries without any cache', async () => {
    for (const [id, lib] of [
      ['ema', 'AxisMa'],
      ['rma', 'AxisMa'],
      ['atr', 'AxisOsc'],
      ['axis-kit-ema', 'AxisMa'],
      ['axis-kit-rsi', 'AxisOsc'],
    ] as const) {
      const code = getBuiltinScript(id)!.code;
      const { libraries, missing } = await resolveLibrariesForScript(code);
      expect(missing).toEqual([]);
      expect(libraries.map((l) => l.name)).toEqual([lib]);
    }
  });
});

describe('built-in kit consumers (catalog)', () => {
  it('kit scripts exist, are indicators, and import their library', () => {
    const kitEma = getBuiltinScript('axis-kit-ema');
    const kitRsi = getBuiltinScript('axis-kit-rsi');
    expect(kitEma?.kind).toBe('indicator');
    expect(kitRsi?.kind).toBe('indicator');
    expect(kitEma?.category).toBe('moving-average');
    expect(kitRsi?.category).toBe('oscillator');
    expect(kitEma?.code).toContain('import axis/AxisMa/1 as axisMa');
    expect(kitRsi?.code).toContain('import axis/AxisOsc/1 as axisOsc');
    expect(kitEma?.code).toContain('axisMa.newChain()');
    expect(kitEma?.code).toContain('.feed(');
    expect(kitRsi?.code).toContain('axisOsc.newChain()');
    expect(kitRsi?.code).toContain('.feed(');
  });

  it('rewritten built-ins keep their ids, titles and plot titles', () => {
    expect(getBuiltinScript('ema')?.code).toContain('plot(out, "EMA"');
    expect(getBuiltinScript('rma')?.code).toContain('plot(out, "RMA"');
    expect(getBuiltinScript('atr')?.code).toContain('plot(a, "ATR"');
    expect(getBuiltinScript('atr')?.code).toContain('plot(atrPct, "ATR%"');
    expect(getBuiltinScript('ema')?.title).toBe('AXIS EMA');
    expect(getBuiltinScript('rma')?.title).toBe('AXIS RMA');
    expect(getBuiltinScript('atr')?.title).toBe('AXIS ATR');
  });

  it('all built-in library imports point at versioned axis libraries', () => {
    const importing = BUILTIN_SCRIPTS.filter((s) => /^import axis\//m.test(s.code));
    expect(importing.length).toBeGreaterThanOrEqual(5);
    for (const s of importing) {
      for (const spec of parseLibraryImports(s.code)) {
        expect(spec.namespace).toBe('axis');
        expect(getBuiltinLibrary(spec.namespace, spec.name, spec.version)).toBeDefined();
      }
    }
  });
});

describe('applyBuiltinScript passes resolved libraries to the engine', () => {
  let restoreFetch: (() => void) | null = null;
  let capturedBody: {
    libraries?: { namespace: string; name: string; version: number; source: string }[];
  } | null = null;

  beforeEach(() => {
    registry.clear();
    _resetSourceRegistrationFlag();
    _resetStreamRegistrationFlag();
    _resetEngineRegistrationFlag();
    _resetStorageRegistrationFlag();
    _resetBootstrapFlag();
    ensureBuiltins();
    clearLogs();
    _resetPublishedCacheForTests();
    setStore('bars', SAMPLE_BARS);
    setStore('endpoint', 'http://run.test:5002');
    setStore('pluginsConfig', { 'engine:server': { preferWs: false } });
    setStore('scripts', []);
    setStore('resultsPanel', { open: false, height: 220 });
    setIndicatorPanelOpen(false);
    setActivePlugin('engine', 'server');
    setEditorInputValues({});
    setManager({
      getPane: () => undefined,
      createPane: () => undefined,
      syncTimeScales: () => {},
      syncOverlayLines: () => {},
      syncOverlayOhlc: () => {},
      syncBgcolorBands: () => {},
      refreshBadges: () => {},
      setTradeMarkers: () => {},
      clearTradeMarkers: () => {},
    } as never);
    capturedBody = null;
    restoreFetch = mockFetch(async (_input, init) => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      capturedBody = raw ? (JSON.parse(raw) as typeof capturedBody) : null;
      return jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map(() => 1),
        series: { EMA: SAMPLE_BARS.map(() => 1) },
        events: [],
        meta: { overlay: true, script_name: 'AXIS Kit EMA' },
      });
    });
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    setEditorInputValues({});
    setManager(undefined);
  });

  it('axis-kit-ema POST body carries the AxisMa library payload', async () => {
    const r = await applyBuiltinScript('axis-kit-ema');
    expect(r.status).toBe('success');
    expect(capturedBody?.libraries).toHaveLength(1);
    expect(capturedBody?.libraries?.[0]).toMatchObject({
      namespace: 'axis',
      name: 'AxisMa',
      version: 1,
    });
    expect(capturedBody?.libraries?.[0].source).toContain('export type EmaState');
  });
});
