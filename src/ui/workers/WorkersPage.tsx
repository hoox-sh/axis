// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workers studio canvas — backend inventory. Not a Runtime tab.
 *
 * Master-detail: health cards select a worker; the inspector shows probe
 * features, capabilities, and numbered install steps. This page does not
 * write the Runtime engine or edit the PYNE agent.
 *
 * @module ui/workers/WorkersPage
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../store';
import { getInstalledPlugins } from '../../plugins/loader';
import { copyToClipboard } from '../clipboard';
import { Icons } from '../icons';
import { HooxLoader } from '../HooxLoader';
import {
  listWorkerCatalog,
  getWorkerCatalogEntry,
  probeWorker,
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

/**
 * Workers studio page: catalog + health probes. The selected worker seeds
 * from `initialWorkerId`. Optional workers (agent, edge eval) stay hidden
 * until the inventory toggle is on.
 *
 * @param props - Close/navigate handlers, change notification, and initial worker.
 * @returns The workers page body.
 */
export function WorkersPage(props: {
  onClose: () => void;
  onNavigate?: (id: StudioPageId) => void;
  onChanged?: () => void;
  initialWorkerId?: WorkerId;
}): JSX.Element {
  const [selectedId, setSelectedId] = createSignal<WorkerId>(props.initialWorkerId || 'pyne-pro');
  const [snap, setSnap] = createSignal<WorkersOverviewSnapshot | null>(null);
  const [probing, setProbing] = createSignal(false);
  const [probeError, setProbeError] = createSignal('');
  const [copied, setCopied] = createSignal('');
  const [showOptional, setShowOptional] = createSignal(false);
  const catalog = createMemo(() => {
    const all = listWorkerCatalog();
    if (showOptional()) return all;
    return all.filter((w) => !w.optional);
  });

  const selected = createMemo(() => getWorkerCatalogEntry(selectedId()));
  const selectedResult = createMemo(() => resultFor(snap(), selectedId()));

  let probeGen = 0;

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
          unknown: results.filter((x) => ['unknown', 'idle', 'skipped'].includes(x.status)).length,
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

  // Lazy probe — defer past the first paint (double rAF) so the studio
  // overlay is visible and interactive before any network request fires.
  // Inventory/cards render from the local catalog immediately; only the
  // health snapshot waits, and a slow/failed probe never blocks the panel.
  let rafId = 0;
  onMount(() => {
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        void refreshOne(selectedId());
      });
    });
  });

  onCleanup(() => {
    if (rafId) cancelAnimationFrame(rafId);
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

  const agentInstalled = createMemo(() =>
    getInstalledPlugins().some((p) => p.id === 'pyne-agent'),
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
        <Show when={probeError()}>
          <p class="ax-error">{probeError()}</p>
        </Show>
        <Show when={probing() && !snap()}>
          <StudioHint>
            Probing backends — the panel is ready; results fill in as each responds.
          </StudioHint>
        </Show>

        <div class="ax-deck">
          <div class="ax-deck-pane">
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
              <div class="ax-grid ax-grid--2" aria-busy={!snap()}>
                <Show
                  when={snap()}
                  fallback={
                    <For each={[0, 1, 2, 3, 4, 5]}>
                      {(_n) => (
                        <div class="ax-skel" data-testid="axis-worker-skel" aria-hidden="true">
                          <div class="ax-skel-line ax-skel-line--title" />
                          <div class="ax-skel-line ax-skel-line--meta" />
                        </div>
                      )}
                    </For>
                  }
                >
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
                            {r()?.latencyMs != null ? `${r()?.latencyMs}ms · ` : ''}
                            last probe {relativeTime(r()?.checkedAt)}
                            <Show when={r()?.isActiveBackend}> · backend</Show>
                            <Show when={r()?.isActiveEngine}> · engine</Show>
                          </StudioHint>
                        </StudioCard>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </StudioSection>

            <StudioSection
              title="Related"
              lead="The contract catalog lives next door — not nested here."
            >
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

          <div class="ax-deck-pane ax-deck-pane--inspect">
            <Show when={!snap()}>
              <div class="ax-skel" data-testid="axis-worker-skel-inspect" aria-hidden="true">
                <div class="ax-skel-line ax-skel-line--title" />
                <div class="ax-skel-line ax-skel-line--meta" />
                <div class="ax-skel-line" />
                <div class="ax-skel-line ax-skel-line--meta" />
              </div>
            </Show>
            <Show
              when={snap() && selected()}
              fallback={
                <Show when={snap()}>
                  <StudioHint>Select a worker.</StudioHint>
                </Show>
              }
            >
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
                          value={r()?.latencyMs != null ? `${r()?.latencyMs}ms` : '—'}
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
                      <Show when={r()?.readiness && r()?.readiness !== 'unknown'}>
                        <StudioField
                          label="Compile"
                          hint="Numba / IR-cache readiness reported by the backend /health."
                        >
                          <StudioCode>
                            {r()?.readiness === 'warm'
                              ? 'warm — builtins / host already prewarmed'
                              : r()?.readiness === 'cold'
                                ? 'cold — first compile pays Numba JIT (prewarm available)'
                                : 'unavailable — no Numba; compile runs in object mode'}
                            {r()?.compile?.diskCacheEnabled
                              ? ` · disk cache${r()?.compile?.irEntries != null ? ` (${r()?.compile?.irEntries} IR)` : ''}`
                              : ' · no disk cache'}
                          </StudioCode>
                        </StudioField>
                      </Show>
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
                        <StudioList class="ax-list--dense">
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

                    <Show when={w().id === 'pyne-agent'}>
                      <StudioHint>
                        {agentInstalled() ? 'Installed.' : 'Not installed.'} Open Plugins to install
                        or configure the agent.
                      </StudioHint>
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
        </div>
      </div>
      <StudioFooter status={footerStatus()}>
        <StudioButton
          variant="ghost"
          disabled={probing()}
          onClick={() => void refreshOne(selectedId())}
          testId="axis-workers-refresh"
          title="Probe the selected worker"
        >
          {probing() ? <HooxLoader size="xs" /> : <Icons.refresh />}
          Refresh
        </StudioButton>
      </StudioFooter>
    </div>
  );
}
