// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runtime studio canvas — active engine, endpoint, exec mode, health.
 * Workers and Plugins are sibling pages, not tabs.
 *
 * @module ui/runtime/RuntimePage
 */

import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { appendLog, store } from '../../store';
import { requestChartReload } from '../../chart/reload';
import {
  listEngines,
  getEngine,
  clearCachedEngineHealth,
  getCachedEngineHealth,
  probeEngineHealth,
  preloadPyodide,
  subscribeEngineHealthCache,
} from '../../engines/catalog';
import {
  compileReadiness,
  healthAdvertises,
  advertisedRunMode,
  type EngineHealth,
} from '../../engines/health';
import { prewarmEngine, prewarmAppliedScripts } from '../../engines/prewarm';
import { BETA_COPY } from '../../engines/request-headers';
import { EngineProPanel } from './EngineProPanel';
import { probeEndpoint } from '../../indicators/runner';
import { engineFamilyForId } from '../../plugins/engine-family';
import { matchCatalogForEndpoint } from '../../workers';
import { CapabilityBadges, engineOptionLabel } from '../plugin-badges';
import { HooxLoader } from '../HooxLoader';
import { Icons } from '../icons';
import type { StudioPageId } from '../studio/types';
import {
  StudioButton,
  StudioCard,
  StudioChip,
  StudioCode,
  StudioField,
  StudioFooter,
  StudioHint,
  StudioInput,
  StudioSection,
  StudioStat,
  StudioStatus,
  StudioToggle,
} from '../studio';
import type { StudioHealth } from '../studio';
import {
  EXEC_MODE_OPTIONS,
  AUTO_PREWARM_FIELD,
  engineHasApiKey,
  engineHasAutoPrewarm,
  engineHasExecMode,
  engineHasPreferWs,
  engineNeedsEndpoint,
  execModeOptionsFor,
  normalizeExecMode,
  readEnginePluginConfig,
  runtimeHealthFromCache,
  writeLiveEngine,
  type EngineExecMode,
  type SaveEngineConfigInput,
} from './engine-config';
import { getEngineApiKey } from '../../storage/vault';

/**
 * Runtime studio page: the live engine, its endpoint, and its cached health.
 *
 * Fields write through {@link writeLiveEngine} as they change. There is no
 * draft and no Save. Close does not write. Test probes without becoming the
 * health stat.
 *
 * @param props - Navigation and close handlers supplied by the studio shell.
 * @returns The runtime configuration page body.
 */
export function RuntimePage(props: {
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
}): JSX.Element {
  const [probing, setProbing] = createSignal(false);
  const [probeOk, setProbeOk] = createSignal<boolean | null>(null);
  const [probeMsg, setProbeMsg] = createSignal('');
  /** `/health` of the endpoint last probed by Test. Not the top health stat. */
  const [probedHealth, setProbedHealth] = createSignal<EngineHealth | null>(null);
  const [probedFor, setProbedFor] = createSignal('');
  const [prewarming, setPrewarming] = createSignal(false);
  const [healthTick, setHealthTick] = createSignal(0);

  onMount(() => {
    const unsubscribe = subscribeEngineHealthCache(() => setHealthTick((n) => n + 1));
    onCleanup(unsubscribe);
  });

  const engineId = () => store.engine || 'server';
  const endpoint = () => store.endpoint || '';
  const cfg = createMemo(() => {
    healthTick();
    return readEnginePluginConfig(engineId());
  });

  const engines = createMemo(() => listEngines());
  const selected = createMemo(() => getEngine(engineId()) || engines()[0]);
  const needsEndpoint = createMemo(() => engineNeedsEndpoint(engineId()));
  const hasExecMode = createMemo(() => engineHasExecMode(engineId()));
  const hasPreferWs = createMemo(() => engineHasPreferWs(engineId()));
  const hasApiKey = createMemo(() => engineHasApiKey(engineId()));
  const modeOptions = createMemo(() => execModeOptionsFor(engineId()));
  const execMode = createMemo((): EngineExecMode => {
    const id = engineId();
    const schema = getEngine(id)?.configSchema;
    const advertised = id === 'server' ? advertisedRunMode(getCachedEngineHealth()) : null;
    const defaultMode = normalizeExecMode(advertised ?? schema?.['mode']?.default, 'interpret');
    return normalizeExecMode(cfg()['mode'], defaultMode);
  });
  const preferWs = createMemo(() => {
    const stored = cfg()['preferWs'];
    if (typeof stored === 'boolean') return stored;
    return getEngine(engineId())?.configSchema?.['preferWs']?.default !== false;
  });
  const apiKey = createMemo(() => {
    const id = engineId();
    const rawKey = cfg()['apiKey'];
    const bagKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    const vaultKey = getEngineApiKey(store.pluginsConfig, id);
    return bagKey || vaultKey || String(getEngine(id)?.configSchema?.['apiKey']?.default || '');
  });
  const autoPrewarm = createMemo(() => cfg()[AUTO_PREWARM_FIELD] === true);
  const modeHint = createMemo(
    () => EXEC_MODE_OPTIONS.find((o) => o.value === execMode())?.hint || '',
  );
  const matched = createMemo(() => matchCatalogForEndpoint(endpoint()) || '—');

  const clearProbe = () => {
    setProbeMsg('');
    setProbeOk(null);
    setProbedHealth(null);
    setProbedFor('');
  };

  /**
   * Write one live-engine change. Closing the page must not call this.
   * An engine id change reloads the chart the same way the topbar switch does.
   */
  const commit = (patch: Partial<SaveEngineConfigInput> & { engine?: string }) => {
    const nextEngine = patch.engine || engineId();
    const prevEngine = engineId();
    if (patch.endpoint !== undefined) {
      const next = String(patch.endpoint || '').trim().replace(/\/$/, '');
      const prev = String(store.endpoint || '').trim().replace(/\/$/, '');
      if (next !== prev) clearCachedEngineHealth();
    }
    writeLiveEngine({
      ...patch,
      engine: nextEngine,
      statusMessage: patch.statusMessage ?? `Runtime · engine=${nextEngine}`,
    });
    if (nextEngine !== prevEngine) {
      if (engineFamilyForId(nextEngine) === 'pyodide') void preloadPyodide();
      void requestChartReload('topbar:data');
    }
  };

  const health = (): StudioHealth => {
    healthTick();
    return runtimeHealthFromCache(getCachedEngineHealth(), engineId());
  };

  const endpointKey = () => endpoint().trim().replace(/\/$/, '');

  /**
   * Compile readiness for the live endpoint.
   *
   * Test's own `/health` wins when it was for this URL. Otherwise the app-wide
   * cache. A URL that has not been probed and has no cache stays unknown.
   */
  const compileState = createMemo(() => {
    if (engineId() !== 'server') return 'unknown' as const;
    healthTick();
    const ep = endpointKey();
    if (!ep) return 'unknown' as const;
    if (probedFor() && probedFor() !== ep) return 'unknown' as const;
    if (probedHealth() && probedFor() === ep) return compileReadiness(probedHealth());
    return compileReadiness(getCachedEngineHealth());
  });

  /**
   * Whether the endpoint advertises `POST /compile/prewarm`.
   *
   * Unknown (no health yet, or a draft endpoint) keeps the action enabled — the
   * client falls back to a typed "older PYNE" message on 404. A host that
   * answered without the route disables it up front.
   */
  const canPrewarm = createMemo(() => {
    if (engineId() !== 'server') return false;
    healthTick();
    const ep = endpointKey();
    const h =
      !probedFor() || probedFor() === ep
        ? (probedHealth() ?? getCachedEngineHealth())
        : null;
    if (!h) return true;
    if (!h.endpoints.length) return true;
    return healthAdvertises(h, 'POST /compile/prewarm');
  });

  const testEndpoint = async () => {
    const base = endpoint().trim();
    setProbing(true);
    setProbeMsg('Probing…');
    setProbedHealth(null);
    setProbedFor('');
    const r = await probeEndpoint(base);
    if (r.ok) {
      // Reuse the probe's own round-trip: read readiness from the same /health.
      // This does not write config and does not feed the top health stat.
      const probe = await probeEngineHealth(base);
      setProbedHealth(probe?.health ?? null);
      setProbedFor(base.replace(/\/$/, ''));
    }
    setProbing(false);
    setProbeOk(r.ok);
    setProbeMsg(r.ok ? r.message : r.message);
  };

  /**
   * Pay Numba JIT / IR-cache cost now instead of on the first Run.
   *
   * Uses the live endpoint and key. Re-reads readiness afterwards so the
   * compile badge reflects the warm state. The top health stat stays on the cache.
   */
  const prewarm = async () => {
    const base = endpoint().trim();
    if (!base) return;
    setPrewarming(true);
    setProbeMsg('');
    try {
      const r = await prewarmEngine({ endpoint: base, apiKey: apiKey().trim() });
      if (!r.ok) {
        const msg = r.error || 'Prewarm failed';
        appendLog('error', `Prewarm · ${base} · ${msg}`, 'engine');
        setProbeOk(false);
        setProbeMsg(msg);
        return;
      }
      const ms = r.prewarmMs != null ? ` in ${Math.round(r.prewarmMs)}ms` : '';
      const failed = r.scriptsFailed ? ` · ${r.scriptsFailed} script(s) failed` : '';
      appendLog('ok', `Compiler prewarmed${ms}${failed}`, 'engine');
      const probe = await probeEngineHealth(base);
      setProbedHealth(probe?.health ?? null);
      setProbedFor(base.replace(/\/$/, ''));
      setProbeOk(true);
      setProbeMsg(
        r.hasNumba
          ? `Compiler warmed${ms}${failed}`
          : `Prewarm ran, but this host has no Numba (object mode)`,
      );
    } finally {
      setPrewarming(false);
    }
  };

  const applyPreset = (
    ep: string,
    nextEngine: string,
    extra?: { mode?: EngineExecMode; ws?: boolean },
  ) => {
    clearProbe();
    commit({
      engine: nextEngine,
      endpoint: ep,
      mode: extra?.mode,
      preferWs: extra?.ws,
    });
  };

  const warmApplied = () => {
    // Fire-and-forget: pay Numba JIT now so the first Run is fast. The client
    // is memoised per source set and never throws, so this cannot spam or
    // break the write; failures are Logs-only.
    void prewarmAppliedScripts().then((r) => {
      if (!r) return;
      if (r.ok) {
        const ms = r.prewarmMs != null ? ` in ${Math.round(r.prewarmMs)}ms` : '';
        appendLog('ok', `Auto-prewarm · ${r.scriptsOk} script(s)${ms}`, 'engine');
      } else {
        appendLog('warn', `Auto-prewarm skipped · ${r.error}`, 'engine');
      }
    });
  };

  const loopbackWarn = createMemo(() => {
    const ep = endpoint().trim().toLowerCase();
    const loop = ep.includes('localhost') || ep.includes('127.0.0.1') || ep.includes('0.0.0.0');
    const remotePage =
      typeof location !== 'undefined' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1';
    return loop && remotePage;
  });

  return (
    <div class="ax-page-stack">
      <div class="ax-page-canvas">
        <div class="ax-grid ax-grid--3">
          <StudioStat label="Engine" value={selected()?.name || engineId() || '—'} />
          <StudioStat label="Health" value={<StudioStatus status={health()} />} />
          <StudioStat label="Catalog match" value={matched()} />
        </div>

        <div class="ax-split">
          <div class="ax-split-col">
            <StudioSection
              title="Engine"
              lead="Which runtime evaluates Pine. Changing engine does not install plugins — it selects one already in the catalog."
            >
              <div class="ax-chip-row">
                <For each={engines()}>
                  {(en) => (
                    <StudioChip
                      pressed={engineId() === en.id}
                      onClick={() => {
                        if (engineId() === en.id) return;
                        clearProbe();
                        commit({ engine: en.id });
                      }}
                    >
                      {engineOptionLabel(en)}
                    </StudioChip>
                  )}
                </For>
              </div>
              <Show when={selected()}>
                {(en) => (
                  <>
                    <CapabilityBadges capabilities={en().capabilities} builtIn={en().builtIn} />
                    <StudioHint>{en().description}</StudioHint>
                  </>
                )}
              </Show>
            </StudioSection>

            <Show when={hasExecMode()}>
              <StudioSection title="Execution mode" lead={modeHint()} testId="axis-exec-mode-field">
                <div class="ax-chip-row" data-testid="axis-exec-mode">
                  <For each={modeOptions()}>
                    {(o) => (
                      <StudioChip
                        pressed={execMode() === o.value}
                        onClick={() => {
                          if (execMode() === o.value) return;
                          commit({ mode: o.value });
                        }}
                        title={o.hint}
                      >
                        {o.label}
                      </StudioChip>
                    )}
                  </For>
                </div>
                <Show when={engineId() === 'pyodide'}>
                  <StudioHint>
                    HUD: ENG local · RUN browser. Numba compile needs RUN server (CPython).
                  </StudioHint>
                </Show>
              </StudioSection>
            </Show>

            <Show when={hasPreferWs() || engineHasAutoPrewarm(engineId())}>
              <StudioSection
                title="Session"
                lead="How this runtime talks to the backend."
              >
                <Show when={hasPreferWs()}>
                  <StudioToggle
                    id="axis-prefer-ws"
                    testId="axis-prefer-ws"
                    checked={preferWs()}
                    onChange={(checked) => {
                      if (checked === preferWs()) return;
                      commit({ preferWs: checked });
                    }}
                    label="Prefer WebSocket run"
                    hint={
                      <>
                        Use <code>/ws/run</code> when the backend advertises it; fall back to REST{' '}
                        <code>POST /run</code>.
                      </>
                    }
                  />
                </Show>
                <Show when={engineHasAutoPrewarm(engineId())}>
                  <StudioToggle
                    id="axis-auto-prewarm"
                    testId="axis-auto-prewarm"
                    checked={autoPrewarm()}
                    onChange={(checked) => {
                      if (checked === autoPrewarm()) return;
                      commit({ autoPrewarm: checked });
                      if (checked) warmApplied();
                    }}
                    label="Warm compiler after save"
                    hint={
                      <>
                        Send the applied chart scripts to <code>POST /compile/prewarm</code> when
                        this is turned on, so the next Run does not pay Numba JIT.
                      </>
                    }
                  />
                </Show>
              </StudioSection>
            </Show>

            <Show when={hasApiKey()}>
              <StudioField
                label="Engine API key"
                for="axis-engine-api-key"
                testId="axis-engine-api-key-field"
                hint={`${BETA_COPY} Sent as X-API-Key and Bearer on POST /run. Leave empty for open local backends.`}
              >
                <StudioInput
                  id="axis-engine-api-key"
                  type="password"
                  mono
                  icon={<Icons.key />}
                  testId="axis-engine-api-key"
                  value={apiKey()}
                  onInput={(value) => commit({ apiKey: value })}
                  placeholder="X-API-Key (pyne-worker / secured backends)"
                  autocomplete="off"
                  spellcheck={false}
                />
              </StudioField>
            </Show>
          </div>

          <div class="ax-split-col">
            <Show when={needsEndpoint()}>
              <StudioSection
                title="Backend endpoint"
                lead="Server engine and LSP (completion / hover) use this URL. Cross-origin needs CORS on pyne."
              >
                <StudioField
                  for="axis-endpoint"
                  label="URL"
                  hint="No trailing slash. Test checks this URL."
                >
                  <div class="ax-inline">
                    <StudioInput
                      id="axis-endpoint"
                      mono
                      icon={<Icons.server />}
                      copyable
                      value={endpoint()}
                      onInput={(value) => {
                        clearProbe();
                        commit({ endpoint: value });
                      }}
                      placeholder="http://host:5002 or Worker URL"
                      spellcheck={false}
                    />
                    <StudioButton
                      variant="ghost"
                      disabled={probing()}
                      onClick={() => void testEndpoint()}
                    >
                      {probing() ? <HooxLoader size="xs" /> : <Icons.activity />}
                      Test
                    </StudioButton>
                    <Show when={engineId() === 'server'}>
                      <StudioButton
                        variant="ghost"
                        testId="axis-engine-prewarm"
                        disabled={prewarming() || !endpoint().trim() || !canPrewarm()}
                        title={
                          canPrewarm()
                            ? 'Warm Numba builtins / IR cache now so the first Run is fast'
                            : 'This backend does not advertise /compile/prewarm'
                        }
                        onClick={() => void prewarm()}
                      >
                        {prewarming() ? <HooxLoader size="xs" /> : <Icons.zap />}
                        Warm compiler
                      </StudioButton>
                    </Show>
                  </div>
                </StudioField>
                <div class="ax-chip-row">
                  <StudioChip
                    testId="axis-endpoint-preset-local"
                    onClick={() =>
                      applyPreset('http://127.0.0.1:5002', 'server', { mode: 'compile', ws: true })
                    }
                  >
                    Local pyne · compile
                  </StudioChip>
                  <StudioChip
                    testId="axis-endpoint-preset-vps"
                    onClick={() => applyPreset('https://pynescript.online', 'server')}
                  >
                    pynescript.online API
                  </StudioChip>
                  <StudioChip
                    testId="axis-endpoint-preset-pyne-worker"
                    onClick={() =>
                      applyPreset('https://pyne-worker.cryptolinx.workers.dev', 'pyne-worker', {
                        ws: false,
                      })
                    }
                  >
                    pyne-worker edge
                  </StudioChip>
                </div>
                <Show when={loopbackWarn()}>
                  <p class="ax-error" data-testid="axis-endpoint-loopback-warn">
                    VPS UI → local compile: the browser calls this PC at 127.0.0.1:5002, not the VPS
                    API. Run pyne on :5002, allow this origin in CORS, then Test.
                  </p>
                </Show>
                <Show when={probeMsg()}>
                  <StudioCode>{probeOk() ? `✓ ${probeMsg()}` : `✗ ${probeMsg()}`}</StudioCode>
                </Show>
                <Show when={compileState() !== 'unknown'}>
                  <StudioField
                    label="Compile readiness"
                    hint="From the backend's /health compile section. Prewarm pays Numba JIT before the first run."
                  >
                    <StudioCode>
                      {compileState() === 'warm'
                        ? 'warm — builtins / host already prewarmed'
                        : compileState() === 'cold'
                          ? 'cold — first compile pays Numba JIT'
                          : 'unavailable — no Numba; compile runs in object mode'}
                    </StudioCode>
                  </StudioField>
                </Show>
              </StudioSection>
            </Show>

            <EngineProPanel engine={engineId()} />

            <StudioSection
              title="Related"
              lead="Inventory lives next door — not as tabs on this page."
            >
              <div class="ax-grid ax-grid--2">
                <StudioCard
                  kicker="Catalog"
                  title="Workers"
                  onClick={() => props.onNavigate('workers')}
                >
                  <StudioHint>
                    Probe pyne Pro, the AXIS Worker, Pyodide, and the service worker. Activate one
                    to become this Runtime.
                  </StudioHint>
                </StudioCard>
                <StudioCard
                  kicker="Catalog"
                  title="Plugins"
                  onClick={() => props.onNavigate('plugins')}
                >
                  <StudioHint>
                    Sources, streams, engines, storage, and the script library. Compose them on
                    Wire.
                  </StudioHint>
                </StudioCard>
              </div>
            </StudioSection>
          </div>
        </div>
      </div>
      <StudioFooter status={`AXIS · engine ${engineId()} · ${endpoint() || 'no endpoint'}`}>
        <StudioButton variant="ghost" onClick={props.onClose}>
          Close
        </StudioButton>
      </StudioFooter>
    </div>
  );
}
