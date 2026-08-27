// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workers studio canvas — backend inventory. Not a Runtime tab.
 *
 * Master-detail: health cards select a worker; inspector shows probe
 * features, numbered install steps, and “Use as calculation backend”.
 *
 * @module ui/workers/WorkersPage
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { store, setStatus } from '../../store';
import { loadPluginFromUrl, getInstalledPlugins } from '../../plugins/loader';
import { preloadPyodide } from '../../engines/catalog';
import { copyToClipboard } from '../clipboard';
import { Icons } from '../icons';
import { HooxLoader } from '../HooxLoader';
import {
  listWorkerCatalog,
  getWorkerCatalogEntry,
  probeAllWorkers,
  probeWorker,
  matchCatalogForEndpoint,
  type WorkerCatalogEntry,
  type WorkerId,
  type WorkerProbeResult,
  type WorkersOverviewSnapshot,
} from '../../workers';
import type { StudioPageId } from '../studio/types';
import {
  StudioButton,
  StudioCard,
  StudioCode,
  StudioField,
  StudioFooter,
  StudioHint,
  StudioList,
  StudioRow,
  StudioSection,
  StudioStat,
  StudioStatus,
  StudioToggle,
} from '../studio';
import type { StudioHealth } from '../studio';
import { saveEngineConfig } from '../runtime/engine-config';

function kindLabel(k: WorkerCatalogEntry['kind']): string {
  switch (k) {
    case 'process':
      return 'Process';
    case 'edge':
      return 'Edge';
    case 'browser':
      return 'Browser';
    case 'pwa':
      return 'PWA';
    case 'optional':
      return 'Optional';
    default:
      return k;
  }
}

function relativeTime(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

function resultFor(
  snap: WorkersOverviewSnapshot | null,
  id: WorkerId,
): WorkerProbeResult | undefined {
  return snap?.results.find((r) => r.id === id);
}

function toStudioHealth(status: WorkerProbeResult['status'] | undefined): StudioHealth {
  if (
    status === 'healthy' ||
    status === 'degraded' ||
    status === 'down' ||
    status === 'idle' ||
    status === 'skipped'
  ) {
    return status;
  }
  return 'unknown';
}

function engineForWorker(id: WorkerId, endpoint: string): string {
  if (id === 'pyodide') return 'pyodide';
  if (id === 'pyne-worker' || /pyne-worker|pine-worker/i.test(endpoint)) return 'pyne-worker';
  return 'server';
}

export function WorkersPage(props: {
  onClose: () => void;
  onNavigate?: (id: StudioPageId) => void;
  onChanged?: () => void;
  initialWorkerId?: WorkerId;
}) {
  const [selectedId, setSelectedId] = createSignal<WorkerId>(props.initialWorkerId || 'pyne-pro');
  const [snap, setSnap] = createSignal<WorkersOverviewSnapshot | null>(null);
  const [probing, setProbing] = createSignal(false);
  const [probeError, setProbeError] = createSignal('');
  const [busyAction, setBusyAction] = createSignal('');
  const [actionMsg, setActionMsg] = createSignal('');
  const [actionErr, setActionErr] = createSignal('');
  const [copied, setCopied] = createSignal('');
  const [showOptional, setShowOptional] = createSignal(true);
  const [hasLoaded, setHasLoaded] = createSignal(false);

  const catalog = createMemo(() => {
    const all = listWorkerCatalog();
    if (showOptional()) return all;
    return all.filter((w) => !w.optional);
  });

  const selected = createMemo(() => getWorkerCatalogEntry(selectedId()));
  const selectedResult = createMemo(() => resultFor(snap(), selectedId()));
  const matchedBackend = createMemo(() => matchCatalogForEndpoint(store.endpoint));

  let abort: AbortController | null = null;
  let probeGen = 0;

  const refresh = async () => {
    abort?.abort();
    abort = new AbortController();
    const gen = ++probeGen;
    setProbing(true);
    setProbeError('');
    try {
      const next = await probeAllWorkers({
        timeoutMs: 5000,
        signal: abort.signal,
      });
      if (gen !== probeGen) return;
      setSnap(next);
    } catch (e: unknown) {
      if (gen !== probeGen) return;
      if ((e as { name?: string })?.name === 'AbortError') return;
      setProbeError(e instanceof Error ? e.message : String(e));
      if (!snap()) {
        setSnap({
          results: [],
          healthy: 0,
          degraded: 0,
          down: 0,
          unknown: 0,
          checkedAt: Date.now(),
        });
      }
    } finally {
      if (gen === probeGen) setProbing(false);
    }
  };

  const refreshOne = async (id: WorkerId) => {
    const gen = ++probeGen;
    setProbing(true);
    try {
      const r = await probeWorker(id, { timeoutMs: 5000 });
      if (gen !== probeGen) return;
      setSnap((prev) => {
        if (!prev) {
          return {
            results: [r],
            healthy: r.status === 'healthy' ? 1 : 0,
            degraded: r.status === 'degraded' ? 1 : 0,
            down: r.status === 'down' ? 1 : 0,
            unknown: ['unknown', 'idle', 'skipped'].includes(r.status) ? 1 : 0,
            checkedAt: Date.now(),
          };
        }
        const results = prev.results.map((x) => (x.id === id ? r : x));
        if (!results.some((x) => x.id === id)) results.push(r);
        return {
          results,
          healthy: results.filter((x) => x.status === 'healthy').length,
          degraded: results.filter((x) => x.status === 'degraded').length,
          down: results.filter((x) => x.status === 'down').length,
          unknown: results.filter((x) =>
            ['unknown', 'idle', 'skipped'].includes(x.status),
          ).length,
          checkedAt: Date.now(),
        };
      });
    } catch (e: unknown) {
      if (gen !== probeGen) return;
      setProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === probeGen) setProbing(false);
    }
  };

  // Lazy load probes - only run when the page is actually opened
  onMount(() => {
    // Defer probe to next frame to avoid blocking studio startup
    requestAnimationFrame(() => {
      if (!hasLoaded()) {
        setHasLoaded(true);
        void refresh();
      }
    });
  });

  onCleanup(() => {
    abort?.abort();
    probeGen += 1;
  });

  createEffect(() => {
    const ids = catalog().map((w) => w.id);
    if (ids.length && !ids.includes(selectedId())) {
      setSelectedId(ids[0]!);
    }
  });

  const copy = async (text: string, key: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
    }
  };

  const setBackend = (endpoint: string, label: string, workerId: WorkerId) => {
    const base = endpoint.replace(/\/$/, '');
    if (!base) return;
    setBusyAction('backend');
    setActionErr('');
    try {
      const eng = engineForWorker(workerId, base);
      saveEngineConfig({
        engine: eng,
        endpoint: base,
        statusMessage: `Workers · backend ${base}`,
      });
      setActionMsg(`Backend → ${label} (${base}) · engine=${eng}`);
      void refresh();
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction('');
    }
  };

  const usePyodide = async () => {
    setBusyAction('pyodide');
    setActionErr('');
    try {
      saveEngineConfig({
        engine: 'pyodide',
        statusMessage: 'Workers · engine=pyodide',
      });
      setActionMsg('Engine → Client-Side (Pyodide)');
      void preloadPyodide();
      await refreshOne('pyodide');
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction('');
    }
  };

  const installAgent = async () => {
    const entry = getWorkerCatalogEntry('pyne-agent');
    const url = entry?.pluginUrl;
    if (!url) return;
    setBusyAction('agent');
    setActionErr('');
    try {
      await loadPluginFromUrl(url);
      props.onChanged?.();
      setActionMsg('PYNE Agent plugin installed');
      setStatus('ready', 'PYNE Agent plugin loaded');
      await refreshOne('pyne-agent');
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction('');
    }
  };

  const agentInstalled = createMemo(() =>
    getInstalledPlugins().some((p) => p.id === 'pyne-agent' || p.kind === 'component'),
  );

  const footerStatus = createMemo(() => {
    const s = snap();
    const eng = store.engine || store.activePlugins?.engine || 'server';
    if (probing() && !s) return 'Probing…';
    if (!s) return 'No probe yet — Refresh';
    const updating = probing() ? ' · updating' : '';
    return `${s.healthy} healthy · ${s.degraded} degraded · ${s.down} down · engine ${eng}${updating}`;
  });

  const openPlugins = () => props.onNavigate?.('plugins');

  return (
    <div class="ax-page-stack">
      <div class="ax-page-canvas">
        <div class="ax-grid ax-grid--3">
          <StudioStat label="Healthy" value={snap()?.healthy ?? '—'} />
          <StudioStat
            label="Health"
            value={
              <StudioStatus
                status={
                  probing() && !snap()
                    ? 'idle'
                    : (snap()?.down ?? 0) > 0
                      ? 'down'
                      : (snap()?.degraded ?? 0) > 0
                        ? 'degraded'
                        : (snap()?.healthy ?? 0) > 0
                          ? 'healthy'
                          : 'unknown'
                }
              />
            }
          />
          <StudioStat
            label="Active backend"
            value={
              matchedBackend()
                ? getWorkerCatalogEntry(matchedBackend()!)?.name || matchedBackend()
                : '—'
            }
          />
        </div>

        <Show when={probeError()}>
          <p class="ax-error">{probeError()}</p>
        </Show>
        <Show when={actionMsg()}>
          <StudioHint>{actionMsg()}</StudioHint>
        </Show>
        <Show when={actionErr()}>
          <p class="ax-error">{actionErr()}</p>
        </Show>

        <div class="ax-split">
          <StudioSection
            title="Inventory"
            lead="Each card is a way AXIS can run Pine or fetch data. Click one to inspect health, features, and install steps."
          >
            <StudioToggle
              id="axis-workers-optional"
              checked={showOptional()}
              onChange={setShowOptional}
              label="Show optional workers"
              hint="PYNE Agent and edge eval are optional — they do not replace the calculation backend."
            />
            <div class="ax-grid ax-grid--2">
              <For each={catalog()}>
                {(w) => {
                  const r = () => resultFor(snap(), w.id);
                  const st = () => toStudioHealth(r()?.status);
                  return (
                    <StudioCard
                      kicker={kindLabel(w.kind)}
                      title={w.name}
                      selected={selectedId() === w.id}
                      onClick={() => setSelectedId(w.id)}
                      testId={`axis-worker-card-${w.id}`}
                    >
                      <StudioStatus status={st()} />
                      <StudioHint>
                        {r()?.latencyMs != null ? `${r()!.latencyMs}ms · ` : ''}
                        last probe {relativeTime(r()?.checkedAt)}
                        <Show when={r()?.isActiveBackend}> · backend</Show>
                        <Show when={r()?.isActiveEngine}> · engine</Show>
                      </StudioHint>
                    </StudioCard>
                  );
                }}
              </For>
            </div>
          </StudioSection>

          <Show when={selected()} fallback={<StudioHint>Select a worker.</StudioHint>}>
            {(w) => {
              const r = () => selectedResult();
              const features = () => Object.entries(r()?.features || {});
              return (
                <div class="ax-section">
                  <StudioSection title={w().name} lead={w().description}>
                    <div class="ax-grid ax-grid--3">
                      <StudioStat
                        label="Status"
                        value={<StudioStatus status={toStudioHealth(r()?.status)} />}
                      />
                      <StudioStat
                        label="Latency"
                        value={r()?.latencyMs != null ? `${r()!.latencyMs}ms` : '—'}
                      />
                      <StudioStat label="Kind" value={kindLabel(w().kind)} />
                    </div>
                    <StudioHint>{w().usage}</StudioHint>
                    <StudioField label="Endpoint">
                      <StudioCode>{r()?.endpoint || w().defaultEndpoint || '(none)'}</StudioCode>
                    </StudioField>
                    <StudioField label="Probe">
                      <StudioCode>{r()?.detail || 'Not probed yet'}</StudioCode>
                    </StudioField>
                    <div class="ax-inline">
                      <StudioButton
                        variant="ghost"
                        disabled={probing()}
                        onClick={() => void refreshOne(w().id)}
                      >
                        {probing() ? <HooxLoader size="xs" /> : <Icons.refresh />}
                        Re-probe
                      </StudioButton>
                      <Show when={w().defaultEndpoint}>
                        <StudioButton
                          variant="ghost"
                          onClick={() => void copy(w().defaultEndpoint, `ep-${w().id}`)}
                        >
                          <Icons.copy />
                          {copied() === `ep-${w().id}` ? 'Copied' : 'Copy URL'}
                        </StudioButton>
                      </Show>
                    </div>
                  </StudioSection>

                  <Show when={features().length}>
                    <StudioSection title="Features" lead="Flags from the last successful probe.">
                      <StudioList>
                        <For each={features()}>
                          {([k, v]) => (
                            <StudioRow>
                              <span>{k}</span>
                              <span>{String(v)}</span>
                            </StudioRow>
                          )}
                        </For>
                      </StudioList>
                    </StudioSection>
                  </Show>

                  <Show when={w().capabilities.length}>
                    <StudioSection title="Capabilities">
                      <StudioHint>{w().capabilities.join(' · ')}</StudioHint>
                    </StudioSection>
                  </Show>

                  <StudioSection
                    title="Activate"
                    lead="Selecting a worker here writes the Runtime engine and endpoint."
                  >
                    <Show when={w().canUseAsBackend && (w().defaultEndpoint || w().localEndpoint)}>
                      <StudioButton
                        variant="primary"
                        disabled={!!busyAction()}
                        onClick={() =>
                          setBackend(
                            w().defaultEndpoint || w().localEndpoint || '',
                            w().name,
                            w().id,
                          )
                        }
                      >
                        Use as calculation backend
                      </StudioButton>
                    </Show>
                    <Show when={w().localEndpoint && w().localEndpoint !== w().defaultEndpoint}>
                      <StudioButton
                        variant="ghost"
                        disabled={!!busyAction()}
                        onClick={() =>
                          setBackend(w().localEndpoint!, `${w().name} (local)`, w().id)
                        }
                      >
                        Use local endpoint
                      </StudioButton>
                    </Show>
                    <Show when={w().canUseAsEngine && w().id === 'pyodide'}>
                      <StudioButton
                        variant="primary"
                        disabled={!!busyAction()}
                        onClick={() => void usePyodide()}
                      >
                        {busyAction() === 'pyodide' ? <HooxLoader size="xs" /> : <Icons.play />}
                        Use as engine + preload
                      </StudioButton>
                    </Show>
                    <Show when={w().canUseAsEngine && w().id === 'pyne-worker'}>
                      <StudioButton
                        variant="primary"
                        disabled={!!busyAction()}
                        onClick={() =>
                          setBackend(
                            w().defaultEndpoint ||
                              'https://pyne-worker.cryptolinx.workers.dev',
                            w().name,
                            'pyne-worker',
                          )
                        }
                      >
                        <Icons.play />
                        Use pyne-worker engine
                      </StudioButton>
                    </Show>
                    <Show when={w().pluginUrl}>
                      <StudioButton
                        variant="primary"
                        disabled={!!busyAction()}
                        onClick={() => void installAgent()}
                      >
                        {busyAction() === 'agent' ? (
                          <HooxLoader size="xs" />
                        ) : (
                          <Icons.download />
                        )}
                        {agentInstalled() ? 'Re-install agent plugin' : 'Install agent plugin'}
                      </StudioButton>
                    </Show>
                    <Show when={w().docsPath || w().homepage}>
                      <StudioHint>
                        <Show when={w().docsPath}>Docs {w().docsPath}</Show>
                        <Show when={w().homepage}>
                          {' '}
                          <a href={w().homepage} target="_blank" rel="noopener noreferrer">
                            {w().homepage}
                          </a>
                        </Show>
                      </StudioHint>
                    </Show>
                  </StudioSection>

                  <For each={w().install}>
                    {(step, i) => (
                      <StudioSection title={`${i() + 1}. ${step.title}`} lead={step.detail}>
                        <Show when={step.command}>
                          <div class="ax-inline">
                            <StudioCode>{step.command}</StudioCode>
                            <StudioButton
                              variant="ghost"
                              class="ax-btn--icon"
                              title="Copy"
                              ariaLabel="Copy command"
                              onClick={() => void copy(step.command!, `step-${w().id}-${i()}`)}
                            >
                              {copied() === `step-${w().id}-${i()}` ? (
                                <Icons.check />
                              ) : (
                                <Icons.copy />
                              )}
                            </StudioButton>
                          </div>
                        </Show>
                      </StudioSection>
                    )}
                  </For>
                </div>
              );
            }}
          </Show>
        </div>

        <StudioSection title="Related" lead="The contract catalog lives next door — not nested here.">
          <StudioCard
            kicker="Catalog"
            title="Open Plugins"
            testId="axis-workers-goto-plugins"
            onClick={openPlugins}
          >
            <StudioHint>
              Sources, streams, engines, storage, and the script library. Compose them on Wire.
            </StudioHint>
          </StudioCard>
        </StudioSection>
      </div>
      <StudioFooter status={footerStatus()}>
        <StudioButton
          variant="ghost"
          disabled={probing()}
          onClick={() => void refresh()}
          testId="axis-workers-refresh"
          title="Probe all workers"
        >
          {probing() ? <HooxLoader size="xs" /> : <Icons.refresh />}
          Refresh
        </StudioButton>
      </StudioFooter>
    </div>
  );
}
