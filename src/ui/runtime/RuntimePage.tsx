// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runtime studio canvas — active engine, endpoint, exec mode, health.
 * Workers and Plugins are sibling pages, not tabs.
 *
 * @module ui/runtime/RuntimePage
 */

import { For, Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { store } from '../../store';
import { listEngines, getEngine } from '../../engines/catalog';
import { probeEndpoint } from '../../indicators/runner';
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
  engineHasApiKey,
  engineHasExecMode,
  engineHasPreferWs,
  engineNeedsEndpoint,
  execModeOptionsFor,
  normalizeExecMode,
  readEnginePluginConfig,
  saveEngineConfig,
  type EngineExecMode,
} from './engine-config';

export function RuntimePage(props: {
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
}) {
  const [engine, setEngine] = createSignal(store.engine);
  const [endpoint, setEndpoint] = createSignal(store.endpoint || '');
  const [execMode, setExecMode] = createSignal<EngineExecMode>('interpret');
  const [preferWs, setPreferWs] = createSignal(true);
  const [apiKey, setApiKey] = createSignal('');
  const [probing, setProbing] = createSignal(false);
  const [probeOk, setProbeOk] = createSignal<boolean | null>(null);
  const [probeMsg, setProbeMsg] = createSignal('');

  const engines = createMemo(() => listEngines());
  const selected = createMemo(() => getEngine(engine()) || engines()[0]);
  const needsEndpoint = createMemo(() => engineNeedsEndpoint(engine()));
  const hasExecMode = createMemo(() => engineHasExecMode(engine()));
  const hasPreferWs = createMemo(() => engineHasPreferWs(engine()));
  const hasApiKey = createMemo(() => engineHasApiKey(engine()));
  const modeOptions = createMemo(() => execModeOptionsFor(engine()));
  const modeHint = createMemo(
    () => EXEC_MODE_OPTIONS.find((o) => o.value === execMode())?.hint || '',
  );
  const matched = createMemo(() => matchCatalogForEndpoint(endpoint()) || '—');

  const hydrate = (engineId: string) => {
    const cfg = readEnginePluginConfig(engineId);
    const schema = getEngine(engineId)?.configSchema;
    const defaultMode = normalizeExecMode(schema?.mode?.default, 'interpret');
    setExecMode(normalizeExecMode(cfg.mode, defaultMode));
    if (typeof cfg.preferWs === 'boolean') setPreferWs(cfg.preferWs);
    else setPreferWs(schema?.preferWs?.default !== false);
    setApiKey(typeof cfg.apiKey === 'string' ? cfg.apiKey : String(schema?.apiKey?.default || ''));
    if (engineId === 'pyne-worker') {
      const def = String(
        schema?.endpoint?.default || 'https://pyne-worker.cryptolinx.workers.dev',
      ).replace(/\/$/, '');
      const cur = endpoint().trim();
      if (!cur || /127\.0\.0\.1|localhost|:5002/i.test(cur)) setEndpoint(def);
    }
  };

  createEffect(() => {
    untrack(() => {
      setEngine(store.engine);
      setEndpoint(store.endpoint || '');
      hydrate(store.engine);
      setProbeMsg('');
      setProbeOk(null);
    });
  });

  const health = (): StudioHealth => {
    if (probeOk() === true) return 'healthy';
    if (probeOk() === false) return 'down';
    return 'idle';
  };

  const testEndpoint = async () => {
    setProbing(true);
    setProbeMsg('Probing…');
    const r = await probeEndpoint(endpoint().trim());
    setProbing(false);
    setProbeOk(r.ok);
    setProbeMsg(r.ok ? r.message : r.message);
  };

  const applyPreset = (ep: string, engineId: string, extra?: { mode?: EngineExecMode; ws?: boolean }) => {
    setEndpoint(ep);
    setEngine(engineId);
    hydrate(engineId);
    if (extra?.mode) setExecMode(extra.mode);
    if (typeof extra?.ws === 'boolean') setPreferWs(extra.ws);
    setProbeMsg('');
    setProbeOk(null);
  };

  const save = () => {
    saveEngineConfig({
      engine: engine(),
      endpoint: endpoint().trim(),
      mode: execMode(),
      preferWs: preferWs(),
      apiKey: apiKey().trim(),
    });
    props.onClose();
  };

  const loopbackWarn = createMemo(() => {
    const ep = endpoint().trim().toLowerCase();
    const loop =
      ep.includes('localhost') || ep.includes('127.0.0.1') || ep.includes('0.0.0.0');
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
          <StudioStat label="Engine" value={selected()?.name || engine() || '—'} />
          <StudioStat
            label="Health"
            value={<StudioStatus status={health()} />}
          />
          <StudioStat label="Catalog match" value={matched()} />
        </div>

        <StudioSection
          title="Engine"
          lead="Which runtime evaluates Pine. Changing engine does not install plugins — it selects one already in the catalog."
        >
          <div class="ax-chip-row">
            <For each={engines()}>
              {(en) => (
                <StudioChip
                  pressed={engine() === en.id}
                  onClick={() => {
                    setEngine(en.id);
                    hydrate(en.id);
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
                    onClick={() => setExecMode(o.value)}
                    title={o.hint}
                  >
                    {o.label}
                  </StudioChip>
                )}
              </For>
            </div>
            <Show when={engine() === 'pyodide'}>
              <StudioHint>
                HUD: ENG local · RUN browser. Numba compile needs RUN server (CPython).
              </StudioHint>
            </Show>
          </StudioSection>
        </Show>

        <Show when={hasPreferWs()}>
          <StudioToggle
            id="axis-prefer-ws"
            testId="axis-prefer-ws"
            checked={preferWs()}
            onChange={setPreferWs}
            label="Prefer WebSocket run"
            hint={
              <>
                Use <code>/ws/run</code> when the backend advertises it; fall back to REST{' '}
                <code>POST /run</code>.
              </>
            }
          />
        </Show>

        <Show when={hasApiKey()}>
          <StudioField
            label="Engine API key"
            for="axis-engine-api-key"
            testId="axis-engine-api-key-field"
            hint="Sent as X-API-Key and Bearer on POST /run. Leave empty for open local backends."
          >
            <StudioInput
              id="axis-engine-api-key"
              type="password"
              mono
              testId="axis-engine-api-key"
              value={apiKey()}
              onInput={setApiKey}
              placeholder="X-API-Key (pyne-worker / secured backends)"
              autocomplete="off"
              spellcheck={false}
            />
          </StudioField>
        </Show>

        <Show when={needsEndpoint()}>
          <StudioSection
            title="Backend endpoint"
            lead="Server engine and LSP (completion / hover) use this URL. Cross-origin needs CORS on pyne."
          >
            <StudioField for="axis-endpoint" label="URL">
              <div class="ax-inline">
                <StudioInput
                  id="axis-endpoint"
                  mono
                  value={endpoint()}
                  onInput={setEndpoint}
                  placeholder="http://host:5002 or Worker URL"
                  spellcheck={false}
                />
                <StudioButton variant="ghost" disabled={probing()} onClick={() => void testEndpoint()}>
                  {probing() ? <HooxLoader size="xs" /> : <Icons.activity />}
                  Test
                </StudioButton>
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
                  applyPreset(
                    'https://pyne-worker.cryptolinx.workers.dev',
                    'pyne-worker',
                    { ws: false },
                  )
                }
              >
                pyne-worker edge
              </StudioChip>
            </div>
            <Show when={loopbackWarn()}>
              <p class="ax-error" data-testid="axis-endpoint-loopback-warn">
                VPS UI → local compile: the browser calls this PC at 127.0.0.1:5002, not the VPS
                API. Run pyne on :5002, allow this origin in CORS, then Test and Save.
              </p>
            </Show>
            <Show when={probeMsg()}>
              <StudioCode>{probeOk() ? `✓ ${probeMsg()}` : `✗ ${probeMsg()}`}</StudioCode>
            </Show>
          </StudioSection>
        </Show>

        <StudioSection title="Related" lead="Inventory lives next door — not as tabs on this page.">
          <div class="ax-grid ax-grid--2">
            <StudioCard
              kicker="Catalog"
              title="Workers"
              onClick={() => props.onNavigate('workers')}
            >
              <StudioHint>
                Probe pyne Pro, the AXIS Worker, Pyodide, and the service worker. Activate one to
                become this Runtime.
              </StudioHint>
            </StudioCard>
            <StudioCard
              kicker="Catalog"
              title="Plugins"
              onClick={() => props.onNavigate('plugins')}
            >
              <StudioHint>
                Sources, streams, engines, storage, and the script library. Compose them on Wire.
              </StudioHint>
            </StudioCard>
          </div>
        </StudioSection>
      </div>
      <StudioFooter status={`AXIS · engine ${engine()} · ${endpoint() || 'no endpoint'}`}>
        <StudioButton variant="ghost" onClick={props.onClose}>
          Cancel
        </StudioButton>
        <StudioButton variant="primary" onClick={save}>
          <Icons.check />
          Save
        </StudioButton>
      </StudioFooter>
    </div>
  );
}
