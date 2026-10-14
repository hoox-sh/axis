// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PYNE `/health` capability model: typed parsing of `features.*` / `compile.*`
 * / `endpoints`, conservative fallbacks for older or unreachable backends, and
 * the compile-readiness summary the UI badges use.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  DEFAULT_ENGINE_HEALTH,
  compileReadiness,
  healthAdvertises,
  healthFromBody,
  type EngineHealth,
} from '../src/engines/health';
import {
  _resetEngineRegistrationFlag,
  _setCachedEngineHealthForTests,
  capabilitiesFromHealth,
  ensureEnginesRegistered,
  getCachedEngineHealth,
  getEngineCapabilities,
} from '../src/engines/catalog';
import { registry } from '../src/plugins/registry';
import { setStore } from '../src/store';

/** Trimmed copy of a real `pynescript-pro-api` /health body. */
const PRO_HEALTH = {
  status: 'healthy',
  service: 'pynescript-pro-api',
  version: '1.0.0',
  timestamp: 1_770_000_000,
  websocket: true,
  features: {
    alerts: true,
    alert_webhooks: true,
    alert_webhook_default: false,
    warm_compile: true,
    default_run_mode: 'auto',
    optimize: true,
    free_tier_limits: false,
    script_runner: true,
    script_runner_scheduler: false,
    live_modes: ['every-tick', 'bar-close'],
    data_session: true,
  },
  compile: {
    has_numba: true,
    builtins_warmed: true,
    disk_cache_enabled: true,
    disk_cache_dir: '/var/cache/pyne',
    prewarm_enabled: true,
    source_entries: 12,
    ir_entries: 9,
    default_mode: 'auto',
    host_prewarmed: true,
  },
  endpoints: {
    'GET /': 'This health check',
    'POST /run': 'Run Pine Script',
    'POST /compile/prewarm': 'Warm Numba builtins / optional scripts (free)',
    'POST /scripts': 'Deploy a hosted script (optional runner)',
  },
};

describe('healthFromBody', () => {
  it('parses the full Pro payload', () => {
    const h = healthFromBody(PRO_HEALTH);
    expect(h.service).toBe('pynescript-pro-api');
    expect(h.version).toBe('1.0.0');
    expect(h.websocket).toBe(true);
    expect(h.compile).toEqual({
      hasNumba: true,
      builtinsWarmed: true,
      prewarmEnabled: true,
      hostPrewarmed: true,
      diskCacheEnabled: true,
      diskCacheDir: '/var/cache/pyne',
      sourceEntries: 12,
      irEntries: 9,
      defaultMode: 'auto',
    });
    expect(h.features).toMatchObject({
      warmCompile: true,
      optimize: true,
      alerts: true,
      alertWebhooks: true,
      alertWebhookDefault: false,
      defaultRunMode: 'auto',
      freeTierLimits: false,
      scriptRunner: true,
      scriptRunnerScheduler: false,
    });
    expect(h.endpoints).toContain('POST /compile/prewarm');
    expect(h.endpoints).toContain('POST /scripts');
  });

  it('degrades to defaults for non-object bodies', () => {
    expect(healthFromBody(null)).toEqual(DEFAULT_ENGINE_HEALTH);
    expect(healthFromBody(undefined)).toEqual(DEFAULT_ENGINE_HEALTH);
    expect(healthFromBody('<html>SPA shell</html>')).toEqual(DEFAULT_ENGINE_HEALTH);
    expect(healthFromBody([1, 2])).toEqual(DEFAULT_ENGINE_HEALTH);
  });

  it('leaves compile/features null when the backend does not advertise them', () => {
    const h = healthFromBody({ status: 'ok', worker: 'pyne-worker', websocket: false });
    expect(h.compile).toBeNull();
    expect(h.features).toBeNull();
    expect(h.endpoints).toEqual([]);
    expect(h.service).toBeNull();
    expect(h.version).toBeNull();
  });

  it('never coerces truthy non-booleans into capability claims', () => {
    const h = healthFromBody({
      features: {
        warm_compile: 'yes',
        script_runner: 1,
        default_run_mode: 42,
        live_modes: 'every-tick',
        data_session: 'true',
      },
      compile: {
        has_numba: 'true',
        builtins_warmed: 1,
        prewarm_enabled: {},
        source_entries: 'twelve',
        disk_cache_dir: '',
      },
    });
    expect(h.features).toEqual({
      warmCompile: false,
      optimize: false,
      alerts: false,
      alertWebhooks: false,
      alertWebhookDefault: false,
      defaultRunMode: null,
      freeTierLimits: false,
      scriptRunner: false,
      scriptRunnerScheduler: false,
    });
    expect(h.compile?.hasNumba).toBe(false);
    expect(h.compile?.builtinsWarmed).toBe(false);
    expect(h.compile?.prewarmEnabled).toBe(false);
    expect(h.compile?.sourceEntries).toBeNull();
    expect(h.compile?.diskCacheDir).toBeNull();
    // The live-mode subset must stay conservative too.
    expect(capabilitiesFromHealth({ features: { live_modes: 'every-tick', data_session: 'true' } }))
      .toMatchObject({ dataSession: false, liveModes: ['bar-close'] });
  });

  it('keeps the live-mode subset in sync with the shared payload', () => {
    const caps = capabilitiesFromHealth(PRO_HEALTH);
    expect(caps.dataSession).toBe(true);
    expect(caps.ownsData).toBe(true);
    expect(caps.liveModes).toEqual(['every-tick', 'bar-close']);
  });
});

describe('healthAdvertises', () => {
  it('matches exact route keys only', () => {
    const h = healthFromBody(PRO_HEALTH);
    expect(healthAdvertises(h, 'POST /compile/prewarm')).toBe(true);
    expect(healthAdvertises(h, 'POST /preview/chart')).toBe(false);
    expect(healthAdvertises(DEFAULT_ENGINE_HEALTH, 'POST /run')).toBe(false);
  });
});

describe('compileReadiness', () => {
  const withCompile = (compile: EngineHealth['compile']): EngineHealth => ({
    ...DEFAULT_ENGINE_HEALTH,
    compile,
  });

  it('reports unknown without a compile section', () => {
    expect(compileReadiness(null)).toBe('unknown');
    expect(compileReadiness(DEFAULT_ENGINE_HEALTH)).toBe('unknown');
  });

  it('reports unavailable without Numba', () => {
    expect(
      compileReadiness(
        withCompile({
          hasNumba: false,
          builtinsWarmed: false,
          prewarmEnabled: false,
          hostPrewarmed: false,
          diskCacheEnabled: false,
          diskCacheDir: null,
          sourceEntries: null,
          irEntries: null,
          defaultMode: 'interpret',
        }),
      ),
    ).toBe('unavailable');
  });

  it('reports warm when builtins or the host are prewarmed, else cold', () => {
    const base = {
      hasNumba: true,
      builtinsWarmed: false,
      prewarmEnabled: true,
      hostPrewarmed: false,
      diskCacheEnabled: false,
      diskCacheDir: null,
      sourceEntries: null,
      irEntries: null,
      defaultMode: 'auto',
    };
    expect(compileReadiness(withCompile(base))).toBe('cold');
    expect(compileReadiness(withCompile({ ...base, builtinsWarmed: true }))).toBe('warm');
    expect(compileReadiness(withCompile({ ...base, hostPrewarmed: true }))).toBe('warm');
  });
});

describe('engine health cache', () => {
  let restore: (() => void) | null = null;

  beforeEach(() => {
    registry.clear();
    _resetEngineRegistrationFlag();
    ensureEnginesRegistered();
    _setCachedEngineHealthForTests(null);
    setStore('endpoint', 'http://health.test:5002');
  });

  afterEach(() => {
    restore?.();
    restore = null;
    _setCachedEngineHealthForTests(null);
  });

  it('populates health from the same /health probe as capabilities', async () => {
    restore = mockFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/health') return jsonResponse(PRO_HEALTH);
      return jsonResponse({ status: 'error' }, 404);
    });
    const caps = await getEngineCapabilities('server');
    expect(caps.dataSession).toBe(true);
    const health = getCachedEngineHealth();
    expect(health?.compile?.builtinsWarmed).toBe(true);
    expect(health?.features?.scriptRunner).toBe(true);
    expect(compileReadiness(health)).toBe('warm');
    expect(healthAdvertises(health ?? DEFAULT_ENGINE_HEALTH, 'POST /compile/prewarm')).toBe(true);
  });

  it('clears readiness when the endpoint stops answering', async () => {
    restore = mockFetch(() => jsonResponse({ status: 'down' }, 503));
    _setCachedEngineHealthForTests(healthFromBody(PRO_HEALTH));
    await getEngineCapabilities('server');
    expect(getCachedEngineHealth()).toBeNull();
  });

  it('does not leak server readiness onto a non-PYNE engine', async () => {
    _setCachedEngineHealthForTests(healthFromBody(PRO_HEALTH));
    await getEngineCapabilities('pyodide');
    expect(getCachedEngineHealth()).toBeNull();
  });
});

