// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workers Manager modal — overview, detail, install helper, configure.
 *
 * Surfaces AXIS-related runtimes: pyne Pro API, Cloudflare Worker (prod + local),
 * Pyodide, PWA service worker, optional PYNE Agent / pyne-worker.
 *
 * Tabs:
 * - **Overview** — health cards + summary
 * - **Detail** — selected worker deep dive + probe features
 * - **Install** — step-by-step setup with copyable commands
 * - **Configure** — set backend URL, activate engine, install agent plugin
 *
 * @module ui/WorkersManager
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { store, setStore, setActivePlugin, persist, setStatus, flushPersist } from '../store';
import { pluginKey } from '../plugins/types';
import { loadPluginFromUrl, getInstalledPlugins } from '../plugins/loader';
import { preloadPyodide } from '../engines/catalog';
import { copyToClipboard } from './clipboard';
import { Icons } from './icons';
import { HooxLoader } from './HooxLoader';
import {
  listWorkerCatalog,
  getWorkerCatalogEntry,
  probeAllWorkers,
  probeWorker,
  workerHealthLabel,
  matchCatalogForEndpoint,
  DEFAULT_AXIS_WORKER_BASE,
  LOCAL_AXIS_WORKER_BASE,
  DEFAULT_PYNE_PRO_BASE,
  PRODUCT_PYNE_PRO_HINT,
  type WorkerCatalogEntry,
  type WorkerId,
  type WorkerIconKey,
  type WorkerProbeResult,
  type WorkerHealthStatus,
  type WorkersOverviewSnapshot,
} from '../workers';

type TabId = 'overview' | 'detail' | 'install' | 'configure';

/** Map catalog icon keys → product Icons (distinct per worker card). */
function workerIcon(key: WorkerIconKey | undefined) {
  switch (key) {
    case 'server':
      return Icons.server;
    case 'cpu':
      return Icons.cpu;
    case 'zap':
      return Icons.zap;
    case 'activity':
      return Icons.activity;
    case 'wifi':
      return Icons.wifi;
    case 'download':
      return Icons.download;
    case 'settings':
      return Icons.settings;
    case 'chain':
      return Icons.chain;
    default:
      return Icons.server;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Initial tab when opening. */
  initialTab?: TabId;
  /** Prefocus a catalog worker. */
  initialWorkerId?: WorkerId;
  /** Called after plugin install (agent). */
  onChanged?: () => void;
  /**
   * When true, render body only (no backdrop/dialog chrome).
   * Used inside {@link RuntimesHub}.
   */
  embedded?: boolean;
  /** Cross-link to Runtimes → Plugins. */
  onOpenPlugins?: () => void;
}

function statusDotClass(s: WorkerHealthStatus): string {
  switch (s) {
    case 'healthy':
      return 'bg-accent-2 shadow-[0_0_6px_rgba(52,211,153,0.5)]';
    case 'degraded':
      return 'bg-orange shadow-[0_0_6px_rgba(251,146,60,0.45)]';
    case 'down':
      return 'bg-red shadow-[0_0_6px_rgba(248,113,113,0.45)]';
    case 'idle':
      return 'bg-accent/80';
    case 'skipped':
      return 'bg-text-faint';
    default:
      return 'bg-text-faint/60';
  }
}

function statusTextClass(s: WorkerHealthStatus): string {
  switch (s) {
    case 'healthy':
      return 'text-accent-2';
    case 'degraded':
      return 'text-orange';
    case 'down':
      return 'text-red';
    case 'idle':
      return 'text-accent';
    default:
      return 'text-text-faint';
  }
}

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

/** Modal host for workers / runtimes overview and install. */
export const WorkersManager: Component<Props> = (props) => {
  const [tab, setTab] = createSignal<TabId>(props.initialTab || 'overview');
  const [selectedId, setSelectedId] = createSignal<WorkerId>(
    props.initialWorkerId || 'pyne-pro',
  );
  const [snap, setSnap] = createSignal<WorkersOverviewSnapshot | null>(null);
  const [probing, setProbing] = createSignal(false);
  const [probeError, setProbeError] = createSignal('');
  const [busyAction, setBusyAction] = createSignal('');
  const [actionMsg, setActionMsg] = createSignal('');
  const [actionErr, setActionErr] = createSignal('');
  const [customEndpoint, setCustomEndpoint] = createSignal(store.endpoint || '');
  const [copied, setCopied] = createSignal('');
  const [filterOptional, setFilterOptional] = createSignal(true);

  const catalog = createMemo(() => {
    const all = listWorkerCatalog();
    if (filterOptional()) return all;
    return all.filter((w) => !w.optional);
  });

  const selected = createMemo(() => getWorkerCatalogEntry(selectedId()));
  const selectedResult = createMemo(() => resultFor(snap(), selectedId()));

  const matchedBackend = createMemo(() => matchCatalogForEndpoint(store.endpoint));

  let abort: AbortController | null = null;
  /** Monotonic gen so stale refresh/finally never leave probing stuck or wipe newer results. */
  let probeGen = 0;

  const refresh = async () => {
    abort?.abort();
    abort = new AbortController();
    const gen = ++probeGen;
    setProbing(true);
    setProbeError('');
    try {
      // Cap wall-clock: each worker has its own timeout; 5s is enough for overview.
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
      // Keep last good snap if any — never block the UI on a failed probe pass
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

  // Probe once when the modal opens. Only track `open` — never `store.endpoint`
  // (setBackend would re-fire this effect and loop “Probing…” forever).
  createEffect(() => {
    const open = props.open;
    if (!open) {
      abort?.abort();
      probeGen += 1;
      return;
    }
    untrack(() => {
      setTab(props.initialTab || 'overview');
      if (props.initialWorkerId) setSelectedId(props.initialWorkerId);
      setCustomEndpoint(store.endpoint || '');
      setActionMsg('');
      setActionErr('');
      setProbeError('');
      void refresh();
    });
    onCleanup(() => {
      abort?.abort();
      probeGen += 1;
    });
  });

  onCleanup(() => {
    abort?.abort();
    probeGen += 1;
  });

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };

  const copy = async (text: string, key: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
    }
  };

  const setBackend = (endpoint: string, label: string) => {
    const base = endpoint.replace(/\/$/, '');
    if (!base) return;
    setBusyAction('backend');
    setActionErr('');
    try {
      setStore('endpoint', base);
      setActivePlugin('engine', 'server');
      const key = pluginKey('engine', 'server');
      const prev = (store.pluginsConfig?.[key] || {}) as Record<string, unknown>;
      setStore('pluginsConfig', key, { ...prev, endpoint: base });
      flushPersist();
      setCustomEndpoint(base);
      setActionMsg(`Backend → ${label} (${base})`);
      setStatus('ready', `Workers · backend ${base}`);
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
      setActivePlugin('engine', 'pyodide');
      persist();
      setActionMsg('Engine → Client-Side (Pyodide)');
      setStatus('loading', 'Switching to Pyodide…');
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

  const selectAndDetail = (id: WorkerId) => {
    setSelectedId(id);
    setTab('detail');
  };

  const tabBtn = (id: TabId, label: string) => (
    <button
      role="tab"
      aria-selected={tab() === id}
      class={`flex-1 px-3 py-2.5 text-[12px] font-medium border-b-2 -mb-[2px] ${
        tab() === id
          ? 'border-b-accent text-text'
          : 'border-b-transparent text-text-dim hover:text-text'
      }`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  const summaryAndBody = (
    <>
          {/* Summary strip + probe refresh */}
          <div
            class="flex flex-wrap items-center gap-2 border-b border-border bg-bg-elev/40 text-[11px] font-mono flex-shrink-0"
            style={{
              'padding-inline': 'var(--ui-dialog-header-pad-x)',
              'padding-block': '0.65em',
            }}
            data-testid="axis-workers-manager"
          >
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2 inline-flex items-center gap-1 text-[11px]"
              disabled={probing()}
              onClick={() => void refresh()}
              title="Probe all workers"
              data-testid="axis-workers-refresh"
            >
              {probing() ? <HooxLoader size="xs" /> : <Icons.refresh size={13} />}
              Refresh
            </button>
            <Show when={props.onOpenPlugins}>
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-2 inline-flex items-center gap-1 text-[11px]"
                data-testid="axis-workers-goto-plugins"
                title="Sources, streams, engines, storage, script library"
                onClick={() => props.onOpenPlugins?.()}
              >
                <Icons.folder size={12} />
                Plugins
              </button>
            </Show>
            <Show
              when={snap()}
              fallback={
                <span class="text-text-faint inline-flex items-center gap-1.5">
                  {probing() ? <HooxLoader size="xs" /> : null}
                  {probing() ? 'Probing…' : 'No probe yet — click Refresh'}
                </span>
              }
            >
              {(s) => (
                <>
                  <Show when={probing()}>
                    <span class="text-text-faint inline-flex items-center gap-1 mr-1">
                      <HooxLoader size="xs" />
                      Updating…
                    </span>
                  </Show>
                  <span class="text-accent-2">{s().healthy} healthy</span>
                  <span class="text-text-faint">·</span>
                  <span class="text-orange">{s().degraded} degraded</span>
                  <span class="text-text-faint">·</span>
                  <span class="text-red">{s().down} down</span>
                  <span class="text-text-faint">·</span>
                  <span class="text-text-dim">{s().unknown} idle/skip</span>
                  <span class="text-text-faint ml-auto">
                    checked {relativeTime(s().checkedAt)}
                  </span>
                </>
              )}
            </Show>
            <Show when={matchedBackend()}>
              {(id) => (
                <span class="text-text-dim">
                  · active backend maps to{' '}
                  <button
                    type="button"
                    class="text-accent underline-offset-2 hover:underline"
                    onClick={() => selectAndDetail(id())}
                  >
                    {getWorkerCatalogEntry(id())?.name || id()}
                  </button>
                </span>
              )}
            </Show>
          </div>

          <div class="sc-dialog-tabs sc-dialog-tabs--underline" role="tablist">
            {tabBtn('overview', 'Overview')}
            {tabBtn('detail', 'Detail')}
            {tabBtn('install', 'Install')}
            {tabBtn('configure', 'Configure')}
          </div>

          <div class="sc-dialog-body flex flex-col gap-4 overflow-auto text-[12px] min-h-0 flex-1">
            <Show when={probeError()}>
              <p class="text-red font-mono text-[11px]">{probeError()}</p>
            </Show>
            <Show when={actionMsg()}>
              <p class="text-accent-2 font-mono text-[11px]">{actionMsg()}</p>
            </Show>
            <Show when={actionErr()}>
              <p class="text-red font-mono text-[11px]">{actionErr()}</p>
            </Show>

            {/* ── Overview ───────────────────────────────────── */}
            <Show when={tab() === 'overview'}>
              <div class="flex flex-wrap items-center gap-2">
                <label class="inline-flex items-center gap-1.5 text-[11px] text-text-dim cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterOptional()}
                    onChange={(e) => setFilterOptional(e.currentTarget.checked)}
                  />
                  Show optional (agent, edge eval)
                </label>
                <span class="text-text-faint text-[10px] ml-auto font-mono">
                  engine={store.engine || store.activePlugins?.engine || 'server'} · endpoint=
                  {(store.endpoint || '').slice(0, 48)}
                  {(store.endpoint || '').length > 48 ? '…' : ''}
                </span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                <For each={[...catalog()]}>
                  {(w) => {
                    const r = () => resultFor(snap(), w.id);
                    const st = () => r()?.status || 'unknown';
                    return (
                      <button
                        type="button"
                        class={`text-left border-2 px-3 py-3 bg-bg-elev flex flex-col gap-2 transition-colors hover:border-accent/60 ${
                          selectedId() === w.id ? 'border-accent' : 'border-border'
                        }`}
                        onClick={() => selectAndDetail(w.id)}
                        data-testid={`axis-worker-card-${w.id}`}
                      >
                        <div class="flex items-start gap-2">
                          <span
                            class={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-border bg-bg ${statusTextClass(st())}`}
                            aria-hidden="true"
                            title={workerHealthLabel(st())}
                          >
                            {(() => {
                              const Icon = workerIcon(w.icon);
                              return <Icon size={15} />;
                            })()}
                          </span>
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 flex-wrap">
                              <span
                                class={`h-2 w-2 rounded-full flex-shrink-0 ${statusDotClass(st())}`}
                                aria-hidden="true"
                              />
                              <span class="font-semibold text-text text-[13px]">{w.name}</span>
                              <span class="text-[9px] uppercase tracking-wider text-text-faint border border-border px-1 py-0.5">
                                {kindLabel(w.kind)}
                              </span>
                              <Show when={r()?.isActiveBackend}>
                                <span class="text-[9px] uppercase tracking-wider text-accent-2 border border-accent-2/40 px-1 py-0.5">
                                  Backend
                                </span>
                              </Show>
                              <Show when={r()?.isActiveEngine}>
                                <span class="text-[9px] uppercase tracking-wider text-accent border border-accent/40 px-1 py-0.5">
                                  Engine
                                </span>
                              </Show>
                            </div>
                            <p class="text-text-faint text-[11px] mt-0.5 line-clamp-2">
                              {w.summary}
                            </p>
                          </div>
                        </div>
                        <div class="flex items-center justify-between gap-2 text-[10px] font-mono">
                          <span class={statusTextClass(st())}>
                            {workerHealthLabel(st())}
                            <Show when={r()?.latencyMs != null}>
                              <span class="text-text-faint">
                                {' '}
                                · {r()!.latencyMs}ms
                              </span>
                            </Show>
                          </span>
                          <span class="text-text-faint truncate max-w-[50%]" title={r()?.detail}>
                            {(r()?.detail || '…').slice(0, 36)}
                          </span>
                        </div>
                        <div class="flex flex-wrap gap-1">
                          <For each={w.roles.slice(0, 4)}>
                            {(role) => (
                              <span class="text-[9px] font-mono text-text-faint bg-bg px-1 py-0.5 border border-border">
                                {role}
                              </span>
                            )}
                          </For>
                        </div>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* ── Detail ─────────────────────────────────────── */}
            <Show when={tab() === 'detail'}>
              <div class="flex flex-wrap gap-1.5 mb-1">
                <For each={[...catalog()]}>
                  {(w) => (
                    <button
                      type="button"
                      class={`sc-btn text-[10px] px-2 ${
                        selectedId() === w.id ? 'sc-btn-primary' : 'sc-btn-ghost'
                      }`}
                      onClick={() => setSelectedId(w.id)}
                    >
                      {w.name}
                    </button>
                  )}
                </For>
              </div>

              <Show when={selected()}>
                {(w) => {
                  const r = () => selectedResult();
                  return (
                    <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-0">
                      <div class="lg:col-span-3 flex flex-col gap-3 border-2 border-border bg-bg-elev p-4">
                        <div class="flex items-start gap-2.5">
                          <span
                            class={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border border-border bg-bg ${statusTextClass(r()?.status || 'unknown')}`}
                            aria-hidden="true"
                          >
                            {(() => {
                              const Icon = workerIcon(w().icon);
                              return <Icon size={17} />;
                            })()}
                          </span>
                          <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span
                                class={`h-2.5 w-2.5 rounded-full ${statusDotClass(r()?.status || 'unknown')}`}
                              />
                              <h3 class="text-[15px] font-semibold text-text">{w().name}</h3>
                              <span class="text-[9px] uppercase tracking-wider text-text-faint border border-border px-1 py-0.5">
                                {kindLabel(w().kind)}
                              </span>
                            </div>
                            <p class="text-text-dim text-[12px] mt-1 leading-relaxed">
                              {w().description}
                            </p>
                          </div>
                        </div>

                        <div class="border border-accent/25 bg-accent/5 px-3 py-2.5 rounded-sm">
                          <div class="text-[9px] uppercase tracking-wider text-accent font-semibold mb-1">
                            Usage
                          </div>
                          <p class="text-text text-[12px] leading-relaxed">{w().usage}</p>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                          <div class="border border-border px-2 py-1.5">
                            <div class="text-text-faint uppercase text-[9px] tracking-wider">
                              Status
                            </div>
                            <div class={`font-mono ${statusTextClass(r()?.status || 'unknown')}`}>
                              {workerHealthLabel(r()?.status || 'unknown')}
                            </div>
                          </div>
                          <div class="border border-border px-2 py-1.5">
                            <div class="text-text-faint uppercase text-[9px] tracking-wider">
                              Latency
                            </div>
                            <div class="font-mono text-text">
                              {r()?.latencyMs != null ? `${r()!.latencyMs}ms` : '—'}
                            </div>
                          </div>
                          <div class="border border-border px-2 py-1.5">
                            <div class="text-text-faint uppercase text-[9px] tracking-wider">
                              Kind
                            </div>
                            <div class="font-mono text-text">{kindLabel(w().kind)}</div>
                          </div>
                          <div class="border border-border px-2 py-1.5 col-span-2 sm:col-span-3">
                            <div class="text-text-faint uppercase text-[9px] tracking-wider">
                              Endpoint
                            </div>
                            <div class="font-mono text-text break-all text-[11px]">
                              {r()?.endpoint || w().defaultEndpoint || '(none)'}
                            </div>
                          </div>
                          <div class="border border-border px-2 py-1.5 col-span-2 sm:col-span-3">
                            <div class="text-text-faint uppercase text-[9px] tracking-wider">
                              Probe detail
                            </div>
                            <div class="font-mono text-text text-[11px] break-words">
                              {r()?.detail || 'Not probed yet'}
                            </div>
                          </div>
                        </div>

                        <Show when={Object.keys(r()?.features || {}).length}>
                          <div>
                            <div class="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">
                              Features / flags
                            </div>
                            <div class="flex flex-wrap gap-1.5">
                              <For each={Object.entries(r()?.features || {})}>
                                {([k, v]) => (
                                  <span class="font-mono text-[10px] border border-border px-1.5 py-0.5 bg-bg">
                                    <span class="text-text-faint">{k}=</span>
                                    <span class="text-text">{String(v)}</span>
                                  </span>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        <div>
                          <div class="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">
                            Capabilities
                          </div>
                          <div class="flex flex-wrap gap-1.5">
                            <For each={w().capabilities}>
                              {(c) => (
                                <span class="text-[10px] border border-border px-1.5 py-0.5 text-text-dim">
                                  {c}
                                </span>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>

                      <div class="lg:col-span-2 flex flex-col gap-2">
                        <div class="text-[11px] text-text-dim uppercase tracking-wider">
                          Actions
                        </div>
                        <button
                          type="button"
                          class="sc-btn sc-btn-ghost justify-start text-[11px]"
                          disabled={probing()}
                          onClick={() => void refreshOne(w().id)}
                        >
                          <Icons.refresh size={12} />
                          Re-probe this worker
                        </button>
                        <Show when={w().canUseAsBackend && (w().defaultEndpoint || w().localEndpoint)}>
                          <button
                            type="button"
                            class="sc-btn sc-btn-primary justify-start text-[11px]"
                            disabled={!!busyAction()}
                            onClick={() =>
                              setBackend(
                                w().defaultEndpoint || w().localEndpoint || '',
                                w().name,
                              )
                            }
                          >
                            Use as calculation backend
                          </button>
                        </Show>
                        <Show when={w().localEndpoint && w().localEndpoint !== w().defaultEndpoint}>
                          <button
                            type="button"
                            class="sc-btn sc-btn-ghost justify-start text-[11px]"
                            disabled={!!busyAction()}
                            onClick={() => setBackend(w().localEndpoint!, `${w().name} (local)`)}
                          >
                            Use local endpoint
                          </button>
                        </Show>
                        <Show when={w().canUseAsEngine}>
                          <button
                            type="button"
                            class="sc-btn sc-btn-primary justify-start text-[11px]"
                            disabled={!!busyAction()}
                            onClick={() => void usePyodide()}
                          >
                            {busyAction() === 'pyodide' ? (
                              <HooxLoader size="xs" />
                            ) : (
                              <Icons.play size={12} />
                            )}
                            Use as engine + preload
                          </button>
                        </Show>
                        <Show when={w().pluginUrl}>
                          <button
                            type="button"
                            class="sc-btn sc-btn-primary justify-start text-[11px]"
                            disabled={!!busyAction()}
                            onClick={() => void installAgent()}
                          >
                            {busyAction() === 'agent' ? (
                              <HooxLoader size="xs" />
                            ) : (
                              <Icons.download size={12} />
                            )}
                            Install agent plugin
                          </button>
                        </Show>
                        <Show when={w().defaultEndpoint}>
                          <button
                            type="button"
                            class="sc-btn sc-btn-ghost justify-start text-[11px]"
                            onClick={() =>
                              void copy(w().defaultEndpoint, `ep-${w().id}`)
                            }
                          >
                            <Icons.copy size={12} />
                            {copied() === `ep-${w().id}` ? 'Copied' : 'Copy default URL'}
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="sc-btn sc-btn-ghost justify-start text-[11px]"
                          onClick={() => setTab('install')}
                        >
                          <Icons.folder size={12} />
                          Open install helper
                        </button>
                        <Show when={w().docsPath || w().homepage}>
                          <div class="text-[10px] text-text-faint mt-2 space-y-1">
                            <Show when={w().docsPath}>
                              <div>
                                Docs path:{' '}
                                <span class="font-mono text-text-dim">{w().docsPath}</span>
                              </div>
                            </Show>
                            <Show when={w().homepage}>
                              <div>
                                Site:{' '}
                                <a
                                  class="text-accent hover:underline font-mono"
                                  href={w().homepage}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {w().homepage}
                                  <Icons.externalLink size={10} class="inline ml-0.5" />
                                </a>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </Show>
            </Show>

            {/* ── Install ────────────────────────────────────── */}
            <Show when={tab() === 'install'}>
              <div class="flex flex-wrap gap-1.5 mb-1">
                <For each={[...catalog()]}>
                  {(w) => (
                    <button
                      type="button"
                      class={`sc-btn text-[10px] px-2 ${
                        selectedId() === w.id ? 'sc-btn-primary' : 'sc-btn-ghost'
                      }`}
                      onClick={() => setSelectedId(w.id)}
                    >
                      {w.name}
                    </button>
                  )}
                </For>
              </div>

              <Show when={selected()}>
                {(w) => (
                  <div class="flex flex-col gap-4">
                    <div class="flex items-start gap-2.5">
                      <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border border-border bg-bg-elev text-accent">
                        {(() => {
                          const Icon = workerIcon(w().icon);
                          return <Icon size={17} />;
                        })()}
                      </span>
                      <div class="min-w-0">
                        <h3 class="text-[14px] font-semibold text-text">
                          Install · {w().name}
                        </h3>
                        <p class="text-text-faint text-[11px] mt-1">{w().summary}</p>
                      </div>
                    </div>

                    <div class="border border-accent/25 bg-accent/5 px-3 py-2.5">
                      <div class="text-[9px] uppercase tracking-wider text-accent font-semibold mb-1">
                        When to use
                      </div>
                      <p class="text-text text-[12px] leading-relaxed">{w().usage}</p>
                    </div>

                    <ol class="flex flex-col gap-3">
                      <For each={w().install}>
                        {(step, i) => (
                          <li class="border-2 border-border bg-bg-elev px-3 py-3 flex gap-3">
                            <span class="font-mono text-accent text-[13px] font-semibold w-6 flex-shrink-0">
                              {i() + 1}.
                            </span>
                            <div class="min-w-0 flex-1">
                              <div class="font-medium text-text text-[12px]">{step.title}</div>
                              <p class="text-text-dim text-[11px] mt-0.5 leading-relaxed">
                                {step.detail}
                              </p>
                              <Show when={step.command}>
                                <div class="mt-2 flex items-stretch gap-1.5">
                                  <code class="flex-1 min-w-0 font-mono text-[11px] bg-bg border border-border px-2 py-1.5 text-text break-all">
                                    {step.command}
                                  </code>
                                  <button
                                    type="button"
                                    class="sc-btn sc-btn-ghost px-2 flex-shrink-0"
                                    title="Copy"
                                    onClick={() =>
                                      void copy(step.command!, `step-${w().id}-${i()}`)
                                    }
                                  >
                                    {copied() === `step-${w().id}-${i()}` ? (
                                      <Icons.check size={13} class="text-accent-2" />
                                    ) : (
                                      <Icons.copy size={13} />
                                    )}
                                  </button>
                                </div>
                              </Show>
                            </div>
                          </li>
                        )}
                      </For>
                    </ol>

                    <div class="border border-border px-3 py-2 text-[11px] text-text-faint">
                      After install, switch to <strong class="text-text-dim">Overview</strong>{' '}
                      and Refresh — healthy probes light green. Use{' '}
                      <strong class="text-text-dim">Configure</strong> to pin a custom URL.
                    </div>
                  </div>
                )}
              </Show>
            </Show>

            {/* ── Configure ──────────────────────────────────── */}
            <Show when={tab() === 'configure'}>
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div class="flex flex-col gap-3">
                  <div>
                    <label class="text-[11px] text-text-dim uppercase tracking-wider">
                      Calculation backend URL
                    </label>
                    <p class="text-[10px] text-text-faint mt-0.5 mb-1.5">
                      Used by the server engine (`store.endpoint`). Prefer Pro API :5002 or AXIS
                      Worker. Pyodide ignores this field.
                    </p>
                    <div class="flex gap-1.5">
                      <input
                        class="sc-input flex-1 min-w-0 font-mono text-[12px]"
                        value={customEndpoint()}
                        onInput={(e) => setCustomEndpoint(e.currentTarget.value)}
                        placeholder="http://127.0.0.1:5002"
                        data-testid="axis-workers-endpoint"
                      />
                      <button
                        type="button"
                        class="sc-btn sc-btn-primary"
                        disabled={!customEndpoint().trim() || !!busyAction()}
                        onClick={() =>
                          setBackend(customEndpoint().trim(), 'custom endpoint')
                        }
                      >
                        Apply
                      </button>
                    </div>
                  </div>

                  <div>
                    <div class="text-[11px] text-text-dim uppercase tracking-wider mb-1.5">
                      Quick presets
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost justify-start font-mono text-[11px]"
                        onClick={() => {
                          setCustomEndpoint(DEFAULT_PYNE_PRO_BASE);
                          setBackend(DEFAULT_PYNE_PRO_BASE, 'pyne Pro (local)');
                        }}
                      >
                        {DEFAULT_PYNE_PRO_BASE}
                        <span class="text-text-faint ml-2">local Pro API</span>
                      </button>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost justify-start font-mono text-[11px]"
                        onClick={() => {
                          setCustomEndpoint(LOCAL_AXIS_WORKER_BASE);
                          setBackend(LOCAL_AXIS_WORKER_BASE, 'AXIS Worker (local)');
                        }}
                      >
                        {LOCAL_AXIS_WORKER_BASE}
                        <span class="text-text-faint ml-2">wrangler</span>
                      </button>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost justify-start font-mono text-[11px]"
                        onClick={() => {
                          setCustomEndpoint(DEFAULT_AXIS_WORKER_BASE);
                          setBackend(DEFAULT_AXIS_WORKER_BASE, 'AXIS Worker (prod)');
                        }}
                      >
                        {DEFAULT_AXIS_WORKER_BASE.replace('https://', '')}
                        <span class="text-text-faint ml-2">prod edge</span>
                      </button>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost justify-start font-mono text-[11px]"
                        onClick={() => {
                          setCustomEndpoint(PRODUCT_PYNE_PRO_HINT);
                          setBackend(PRODUCT_PYNE_PRO_HINT, 'axis.hoox.sh');
                        }}
                      >
                        {PRODUCT_PYNE_PRO_HINT}
                        <span class="text-text-faint ml-2">product host</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div class="flex flex-col gap-3">
                  <div class="border-2 border-border bg-bg-elev p-3 flex flex-col gap-2">
                    <div class="text-[11px] text-text-dim uppercase tracking-wider">
                      Offline / browser engine
                    </div>
                    <p class="text-[11px] text-text-faint">
                      Switch to Pyodide for in-tab evaluation. First load may take 20–30s; no
                      Backend URL required after assets are cached.
                    </p>
                    <button
                      type="button"
                      class="sc-btn sc-btn-primary self-start text-[11px]"
                      disabled={!!busyAction()}
                      onClick={() => void usePyodide()}
                    >
                      {busyAction() === 'pyodide' ? (
                        <HooxLoader size="xs" />
                      ) : null}
                      Activate Pyodide engine
                    </button>
                  </div>

                  <div class="border-2 border-border bg-bg-elev p-3 flex flex-col gap-2">
                    <div class="text-[11px] text-text-dim uppercase tracking-wider">
                      PYNE Agent plugin
                    </div>
                    <p class="text-[11px] text-text-faint">
                      Natural-language script authoring. Optional — does not replace the
                      calculation engine.
                    </p>
                    <button
                      type="button"
                      class="sc-btn sc-btn-primary self-start text-[11px]"
                      disabled={!!busyAction()}
                      onClick={() => void installAgent()}
                    >
                      {busyAction() === 'agent' ? (
                        <HooxLoader size="xs" />
                      ) : (
                        <Icons.download size={12} />
                      )}
                      {agentInstalled() ? 'Re-install agent plugin' : 'Install agent plugin'}
                    </button>
                  </div>

                  <div class="border border-border px-3 py-2 text-[10px] text-text-faint font-mono space-y-1">
                    <div>
                      current engine:{' '}
                      <span class="text-text">
                        {store.engine || store.activePlugins?.engine || 'server'}
                      </span>
                    </div>
                    <div>
                      current endpoint:{' '}
                      <span class="text-text break-all">{store.endpoint || '(empty)'}</span>
                    </div>
                    <div>
                      matched catalog:{' '}
                      <span class="text-text">{matchedBackend() || '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Show>
          </div>
    </>
  );

  if (props.embedded) {
    return (
      <Show when={props.open}>
        <div class="flex flex-col min-h-0 flex-1 overflow-hidden">{summaryAndBody}</div>
      </Show>
    );
  }

  return (
    <Show when={props.open}>
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        onKeyDown={onKey}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(1100px,calc(100vw-2*var(--ui-dialog-margin)))] h-[min(880px,calc(100vh-2*var(--ui-dialog-margin-y)))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-workers-title"
          data-testid="axis-workers-manager"
        >
          <div class="sc-dialog-accent" />
          <div class="sc-dialog-header gap-3">
            <div class="min-w-0">
              <span
                id="axis-workers-title"
                class="text-base font-semibold text-text tracking-tight inline-flex items-center gap-2"
              >
                <Icons.cpu size={16} />
                Status
              </span>
              <p class="sc-hint truncate">
                Calculation backends · edge data plane · browser runtime · PWA
              </p>
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2"
              onClick={props.onClose}
              aria-label="Close"
            >
              <Icons.x size={14} />
            </button>
          </div>
          {summaryAndBody}
        </div>
      </div>
    </Show>
  );
};
