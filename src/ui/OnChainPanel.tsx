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
 * On-Chain panel — multi-mode on-chain data plane UI.
 *
 * Modes:
 * 1. **TVL** — DefiLlama protocol search / popular presets / attach (left-scale)
 * 2. **DEX** — GeckoTerminal pool OHLCV onto the main chart (`network:0x…`)
 * 3. **Events** — TVL spike events from attached series
 *
 * TVL footer: refresh jobs, series/events CSV export, job progress list.
 * FloatableShell id `onchain`. Chart / source / manager core stay out of scope
 * beyond calling existing load + attach helpers.
 */

import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  isPanelOpen,
  persist,
  setActivePlugin,
  setOnchainLastProtocol,
  setStore,
  store,
  updateChartSlot,
} from '../store';
import {
  onchainManagerState,
  searchProtocols,
  attachDefiLlamaTvl,
  detachOnchainSeries,
  setOnchainSeriesVisible,
  clearAllOnchainSeries,
  loadTvlSpikeEventsFromAttachment,
  clearOnchainEvents,
  type DefiLlamaProtocolHit,
} from '../onchain/manager';
import {
  onchainJobsState,
  refreshAllAttachedTvl,
  dismissOnchainJob,
  type OnchainJob,
} from '../onchain/jobs';
import {
  seriesToCsv,
  eventsToCsv,
  downloadTextFile,
} from '../onchain/export';
import {
  POPULAR_TVL_PROTOCOLS,
  DEX_NETWORK_PRESETS,
  attachPopularTvl,
} from '../onchain/presets';
import {
  isWorkerLlamaProxy,
  isWorkerGeckoProxy,
  resolveDefiLlamaBaseUrl,
  resolveGeckoTerminalBaseUrl,
} from '../onchain/proxy';
import { kickOnchainHealthProbe } from '../onchain/health';
import {
  searchGeckoPools,
  type GeckoPoolSearchHit,
} from '../onchain/geckoterminal';
import { loadSymbolData } from '../data/load-symbol';
import { getSource } from '../sources/catalog';
import { defaultStreamForSource } from '../streams/catalog';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';

/** Historical source id for GeckoTerminal pool OHLCV. */
const GECKO_SOURCE_ID = 'geckoterminal-ohlcv';

/** DEX network options from {@link DEX_NETWORK_PRESETS}. */
const DEX_NETWORKS = DEX_NETWORK_PRESETS;

type DexNetworkId = (typeof DEX_NETWORK_PRESETS)[number]['id'];

type PanelMode = 'tvl' | 'dex' | 'events';

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtEventTime(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  try {
    return new Date(sec * 1000).toISOString().slice(0, 10);
  } catch {
    return String(sec);
  }
}

function fmtEventPct(ev: { payload?: Record<string, unknown> }): string {
  const raw = ev.payload?.pctChange;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function normalizePoolAddress(raw: string, network: string): string {
  let a = String(raw || '').trim();
  if (!a) return '';
  // Strip accidental network prefix if user pasted full symbol
  const colon = a.indexOf(':');
  if (colon > 0) {
    const maybeNet = a.slice(0, colon).toLowerCase();
    if (DEX_NETWORK_PRESETS.some((n) => n.id === maybeNet)) {
      a = a.slice(colon + 1).trim();
    }
  }
  // Drop trailing label after space (e.g. "0x… Uniswap V3")
  const space = a.indexOf(' ');
  if (space > 0) a = a.slice(0, space).trim();
  if (network !== 'solana' && /^[0-9a-fA-F]{40}$/.test(a)) {
    a = `0x${a}`;
  }
  return a;
}

function jobStatusLabel(job: OnchainJob): string {
  switch (job.status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'complete':
      return job.error ? 'Partial' : 'Complete';
    case 'error':
      return 'Error';
    case 'cancelled':
      return 'Cancelled';
    default:
      return job.status;
  }
}

function exportSeriesCsv(): void {
  const payload = onchainManagerState.series.map((row) => ({
    label: row.label || row.key || row.instrument?.protocolId || row.id,
    points: Array.isArray(row.points) ? row.points : [],
  }));
  const csv = seriesToCsv(payload);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(
    `axis-onchain-series-${stamp}.csv`,
    csv,
    'text/csv;charset=utf-8',
  );
}

function exportEventsCsv(): void {
  const csv = eventsToCsv(
    onchainManagerState.events.map((ev) => ({
      time: ev.time,
      type: ev.type,
      title: ev.title,
      severity: ev.severity,
      price: ev.price,
    })),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(
    `axis-onchain-events-${stamp}.csv`,
    csv,
    'text/csv;charset=utf-8',
  );
}

function buildPoolSymbol(network: string, address: string): string {
  const net = String(network || 'eth').trim().toLowerCase();
  const addr = normalizePoolAddress(address, net);
  return `${net}:${addr}`;
}

type DataPathInfo = { via: 'worker' | 'direct'; base: string };

function llamaDataPath(): DataPathInfo {
  const base = resolveDefiLlamaBaseUrl();
  return { via: isWorkerLlamaProxy(base) ? 'worker' : 'direct', base };
}

function geckoDataPath(): DataPathInfo {
  const base = resolveGeckoTerminalBaseUrl();
  return { via: isWorkerGeckoProxy(base) ? 'worker' : 'direct', base };
}

/** Dockable / floatable On-Chain multi-mode manager. */
export const OnChainPanel: Component = () => {
  const [mode, setMode] = createSignal<PanelMode>('tvl');

  // Probe Worker on-chain proxy when the panel opens (non-blocking HUD plane).
  createEffect(() => {
    if (isPanelOpen('onchain')) {
      void store.endpoint;
      kickOnchainHealthProbe();
    }
  });

  // ── TVL ────────────────────────────────────────────────────────────
  const [query, setQuery] = createSignal('');
  const [attachError, setAttachError] = createSignal('');
  const [attachingSlug, setAttachingSlug] = createSignal<string | null>(null);
  const [popularBusy, setPopularBusy] = createSignal(false);
  const [refreshBusy, setRefreshBusy] = createSignal(false);
  const [actionMsg, setActionMsg] = createSignal('');

  // ── DEX ────────────────────────────────────────────────────────────
  const [dexNetwork, setDexNetwork] = createSignal<DexNetworkId>('eth');
  const [poolAddress, setPoolAddress] = createSignal('');
  const [dexError, setDexError] = createSignal('');
  const [dexMsg, setDexMsg] = createSignal('');
  const [dexLoading, setDexLoading] = createSignal(false);
  const [poolQuery, setPoolQuery] = createSignal('');
  const [poolResults, setPoolResults] = createSignal<GeckoPoolSearchHit[]>([]);
  const [poolSearchLoading, setPoolSearchLoading] = createSignal(false);
  const [poolSearchError, setPoolSearchError] = createSignal('');

  // ── Events ─────────────────────────────────────────────────────────
  const [eventsMsg, setEventsMsg] = createSignal('');
  const [spikeBusyId, setSpikeBusyId] = createSignal<string | null>(null);

  /** React to endpoint changes so proxy path labels stay honest. */
  const llamaPath = createMemo(() => {
    void store.endpoint;
    return llamaDataPath();
  });
  const geckoPath = createMemo(() => {
    void store.endpoint;
    return geckoDataPath();
  });

  const geckoSourceRegistered = createMemo(() => {
    void store.activePlugins?.source;
    void store.source;
    return !!getSource(GECKO_SOURCE_ID);
  });

  const eventCount = createMemo(() => onchainManagerState.events.length);

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let poolSearchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer);
    if (poolSearchTimer) clearTimeout(poolSearchTimer);
  });

  const onSearchInput = (value: string) => {
    setQuery(value);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void searchProtocols(value);
    }, 280);
  };

  const onAttach = async (hit: DefiLlamaProtocolHit) => {
    setAttachError('');
    setActionMsg('');
    setAttachingSlug(hit.slug);
    try {
      await attachDefiLlamaTvl(hit);
      setOnchainLastProtocol(hit.slug, hit.name);
    } catch (err: unknown) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttachingSlug(null);
    }
  };

  const onAttachPopularSlug = async (slug: string, name: string) => {
    setAttachError('');
    setActionMsg('');
    setAttachingSlug(slug);
    try {
      await attachDefiLlamaTvl({ slug, name });
      setOnchainLastProtocol(slug, name);
    } catch (err: unknown) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttachingSlug(null);
    }
  };

  const onAttachTop5 = async () => {
    setAttachError('');
    setActionMsg('');
    setPopularBusy(true);
    try {
      const result = await attachPopularTvl(5);
      const n = result.ok.length;
      if (n > 0) {
        setActionMsg(
          `Attached ${n} popular protocol${n === 1 ? '' : 's'}${
            result.failed.length ? ` · ${result.failed.length} failed` : ''
          }.`,
        );
      } else if (result.failed.length) {
        setAttachError(
          result.failed[0]?.error || 'Failed to attach popular TVL presets.',
        );
      } else {
        setActionMsg('No popular protocols attached (cap or empty).');
      }
    } catch (err: unknown) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setPopularBusy(false);
    }
  };

  const onRefreshAll = async () => {
    setAttachError('');
    setActionMsg('');
    if (!onchainManagerState.series.length) {
      setActionMsg('No attached series to refresh.');
      return;
    }
    setRefreshBusy(true);
    try {
      await refreshAllAttachedTvl();
      setActionMsg('Refresh queued for all attached TVL series.');
    } catch (err: unknown) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshBusy(false);
    }
  };

  const onExportSeries = () => {
    setActionMsg('');
    exportSeriesCsv();
    setActionMsg(
      onchainManagerState.series.length
        ? 'Downloaded series CSV.'
        : 'Downloaded empty series CSV (header only).',
    );
  };

  const onExportEvents = () => {
    setActionMsg('');
    exportEventsCsv();
    setActionMsg(
      onchainManagerState.events.length
        ? 'Downloaded events CSV.'
        : 'Downloaded empty events CSV (header only).',
    );
  };

  const onPoolSearchInput = (value: string) => {
    setPoolQuery(value);
    if (poolSearchTimer) clearTimeout(poolSearchTimer);
    poolSearchTimer = setTimeout(() => {
      void runPoolSearch(value);
    }, 320);
  };

  const runPoolSearch = async (raw: string) => {
    const q = String(raw || '').trim();
    setPoolSearchError('');
    if (!q) {
      setPoolResults([]);
      return;
    }
    setPoolSearchLoading(true);
    try {
      const path = geckoDataPath();
      // Gecko API: single opts bag (query + optional network / baseUrl)
      const hits = await searchGeckoPools({
        query: q,
        network: dexNetwork(),
        limit: 12,
        baseUrl: path.base,
      });
      setPoolResults(Array.isArray(hits) ? hits : []);
    } catch (err: unknown) {
      setPoolResults([]);
      setPoolSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setPoolSearchLoading(false);
    }
  };

  const pickPool = (hit: GeckoPoolSearchHit) => {
    const net = String(hit.network || '').toLowerCase();
    if (net && DEX_NETWORK_PRESETS.some((n) => n.id === net || n.gecko === net)) {
      const preset = DEX_NETWORK_PRESETS.find(
        (n) => n.id === net || n.gecko === net,
      );
      if (preset) setDexNetwork(preset.id as DexNetworkId);
    }
    setPoolAddress(hit.address);
    setDexMsg(hit.name ? `Selected ${hit.name}` : `Selected ${hit.address.slice(0, 10)}…`);
    setDexError('');
  };

  const onLoadAsChart = async () => {
    setDexError('');
    setDexMsg('');
    const network = dexNetwork();
    const addr = normalizePoolAddress(poolAddress(), network);
    if (!addr) {
      setDexError('Enter a pool contract address.');
      return;
    }
    if (!getSource(GECKO_SOURCE_ID)) {
      setDexError(
        `Source “${GECKO_SOURCE_ID}” is not registered. Enable the GeckoTerminal OHLCV source, then retry.`,
      );
      return;
    }

    const symbol = buildPoolSymbol(network, addr);
    setDexLoading(true);
    try {
      // Match Topbar source switch + symbol load path
      setActivePlugin('source', GECKO_SOURCE_ID);
      const streamId = defaultStreamForSource(GECKO_SOURCE_ID);
      setActivePlugin('stream', streamId);
      setStore('symbol', symbol);
      const aid = store.chartLayout?.activeId;
      if (aid) updateChartSlot(aid, { symbol });
      persist();
      const ok = await loadSymbolData(symbol, store.interval, GECKO_SOURCE_ID);
      if (ok) {
        setDexMsg(`Loaded ${symbol} via ${GECKO_SOURCE_ID}`);
      } else {
        setDexError('Load failed — see status bar for details.');
      }
    } catch (err: unknown) {
      setDexError(err instanceof Error ? err.message : String(err));
    } finally {
      setDexLoading(false);
    }
  };

  const onShowSpikes = async (seriesId: string, label: string) => {
    setEventsMsg('');
    setSpikeBusyId(seriesId);
    try {
      await loadTvlSpikeEventsFromAttachment(seriesId);
      const n = onchainManagerState.events.length;
      const src = onchainManagerState.eventSourceLabel || label;
      if (n === 0) {
        setEventsMsg(`No TVL spikes ≥10% day-over-day for ${src}.`);
      } else {
        setEventsMsg(`Found ${n} spike${n === 1 ? '' : 's'} · ${src}`);
      }
    } catch (err: unknown) {
      setEventsMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSpikeBusyId(null);
    }
  };

  const onClearEvents = () => {
    clearOnchainEvents();
    setEventsMsg('Cleared spike events.');
  };

  const modeTab = (id: PanelMode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode() === id}
      class={`sc-chip ${mode() === id ? 'is-active' : ''}`}
      onClick={() => setMode(id)}
      data-testid={`axis-onchain-mode-${id}`}
    >
      {label}
    </button>
  );

  return (
    <Show when={isPanelOpen('onchain')}>
      <FloatableShell id="onchain" testId="axis-onchain">
        <div class="flex-1 overflow-y-auto min-h-0 p-2 flex flex-col gap-3 text-[0.82rem]">
          <p class="text-muted m-0 leading-snug">
            On-chain data plane: <strong>TVL</strong> overlays, <strong>DEX</strong> pool
            OHLCV on the main chart, and <strong>Events</strong> from attached series.
            Protocol TVL is <strong>not</strong> CEX price.
          </p>

          <div
            class="sc-chip-row"
            role="tablist"
            aria-label="On-chain modes"
            data-testid="axis-onchain-modes"
          >
            {modeTab('tvl', 'TVL')}
            {modeTab('dex', 'DEX')}
            {modeTab('events', 'Events')}
          </div>

          {/* ═══════════════ TVL ═══════════════ */}
          <Show when={mode() === 'tvl'}>
            <div
              role="tabpanel"
              aria-label="Protocol TVL"
              class="flex flex-col gap-3"
              data-testid="axis-onchain-panel-tvl"
            >
              <p
                class="text-muted m-0 text-[0.72rem] leading-snug break-all"
                data-testid="axis-onchain-datapath"
                title={llamaPath().base}
              >
                Data path:{' '}
                <Show
                  when={llamaPath().via === 'worker'}
                  fallback={<span>direct llama.fi (CORS may fail in browser)</span>}
                >
                  <span>Worker proxy</span>
                </Show>
                {' · '}
                <code class="text-[0.7rem] opacity-80">{llamaPath().base}</code>
              </p>

              <div class="flex flex-col gap-1.5" data-testid="axis-onchain-popular">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-muted text-[0.72rem] uppercase tracking-wide">
                    Popular
                  </span>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost sc-btn-sm"
                    disabled={popularBusy() || !!attachingSlug()}
                    onClick={() => void onAttachTop5()}
                    data-testid="axis-onchain-attach-top5"
                    title="Attach the first 5 popular DefiLlama TVL presets"
                  >
                    <Show when={popularBusy()} fallback={<Icons.layers />}>
                      <Icons.loader class="animate-spin" />
                    </Show>
                    <span>{popularBusy() ? 'Attaching…' : 'Attach top 5'}</span>
                  </button>
                </div>
                <div
                  class="sc-chip-row flex flex-wrap gap-1"
                  role="group"
                  aria-label="Popular protocols"
                  data-testid="axis-onchain-popular-chips"
                >
                  <For each={POPULAR_TVL_PROTOCOLS}>
                    {(p) => {
                      const attached = () =>
                        onchainManagerState.series.some(
                          (s) => s.provider === 'defillama' && s.key === p.slug,
                        );
                      return (
                        <button
                          type="button"
                          class={`sc-chip ${attached() ? 'is-active' : ''}`}
                          disabled={attached() || attachingSlug() === p.slug || popularBusy()}
                          onClick={() => void onAttachPopularSlug(p.slug, p.name)}
                          data-testid={`axis-onchain-popular-${p.slug}`}
                          title={
                            attached()
                              ? `${p.name} already attached`
                              : `Attach ${p.name} TVL`
                          }
                        >
                          {attachingSlug() === p.slug ? '…' : p.name}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>

              <label class="flex flex-col gap-0.5" data-testid="axis-onchain-search">
                <span class="text-muted text-[0.72rem] uppercase tracking-wide">
                  Search protocols
                </span>
                <input
                  type="search"
                  class="sc-input"
                  placeholder="e.g. aave, uniswap, lido…"
                  value={query()}
                  onInput={(e) => onSearchInput(e.currentTarget.value)}
                  autocomplete="off"
                  spellcheck={false}
                  data-testid="axis-onchain-search-input"
                />
              </label>

              <Show when={onchainManagerState.searchLoading}>
                <div class="text-muted text-[0.78rem] flex items-center gap-1.5" role="status">
                  <Icons.loader class="animate-spin" />
                  <span>Searching DefiLlama…</span>
                </div>
              </Show>

              <Show when={onchainManagerState.searchError}>
                <div class="text-red text-[0.78rem]" role="alert">
                  {onchainManagerState.searchError}
                </div>
              </Show>

              <Show when={attachError() || onchainManagerState.error}>
                <div class="text-red text-[0.78rem]" role="alert">
                  {attachError() || onchainManagerState.error}
                </div>
              </Show>

              <Show when={actionMsg()}>
                <div
                  class="text-muted text-[0.78rem]"
                  role="status"
                  data-testid="axis-onchain-action-msg"
                >
                  {actionMsg()}
                </div>
              </Show>

              <Show
                when={onchainManagerState.searchResults.length}
                fallback={
                  <Show when={query().trim() && !onchainManagerState.searchLoading}>
                    <div class="text-muted text-[0.78rem] py-1">No protocols match.</div>
                  </Show>
                }
              >
                <div class="flex flex-col gap-1" data-testid="axis-onchain-results">
                  <div class="text-muted text-[0.72rem] uppercase tracking-wide">Results</div>
                  <For each={onchainManagerState.searchResults}>
                    {(hit) => {
                      const attached = () =>
                        onchainManagerState.series.some(
                          (s) => s.provider === 'defillama' && s.key === hit.slug,
                        );
                      return (
                        <button
                          type="button"
                          class="sc-btn sc-btn-ghost w-full justify-start text-left border border-[var(--border)] rounded px-2 py-1.5"
                          disabled={attached() || attachingSlug() === hit.slug}
                          onClick={() => void onAttach(hit)}
                          data-testid={`axis-onchain-result-${hit.slug}`}
                          title={attached() ? 'Already attached' : `Attach ${hit.name} TVL`}
                        >
                          <div class="flex items-start justify-between gap-2 w-full min-w-0">
                            <div class="min-w-0">
                              <div class="font-medium truncate">{hit.name}</div>
                              <div class="text-muted text-[0.72rem] truncate">{hit.slug}</div>
                            </div>
                            <span class="text-[0.72rem] text-muted shrink-0 tabular-nums">
                              {attachingSlug() === hit.slug
                                ? '…'
                                : attached()
                                  ? 'On'
                                  : fmtUsd(hit.tvl)}
                            </span>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>

              <div class="flex flex-col gap-2" data-testid="axis-onchain-series">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="text-muted text-[0.72rem] uppercase tracking-wide">
                    Attached series
                  </div>
                  <div class="flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost sc-btn-sm"
                      disabled={
                        refreshBusy() || !onchainManagerState.series.length
                      }
                      onClick={() => void onRefreshAll()}
                      data-testid="axis-onchain-refresh-all"
                      title="Re-fetch all attached DefiLlama TVL series"
                    >
                      <Show when={refreshBusy()} fallback={<Icons.refresh />}>
                        <Icons.loader class="animate-spin" />
                      </Show>
                      <span>{refreshBusy() ? 'Refreshing…' : 'Refresh all'}</span>
                    </button>
                    <Show when={onchainManagerState.series.length}>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost sc-btn-sm"
                        onClick={() => clearAllOnchainSeries()}
                        data-testid="axis-onchain-clear-all"
                        title="Remove all on-chain series"
                      >
                        <Icons.trash />
                        <span>Clear</span>
                      </button>
                    </Show>
                  </div>
                </div>

                <Show
                  when={onchainManagerState.series.length}
                  fallback={
                    <div
                      class="text-muted text-[0.78rem] py-2 leading-snug border border-dashed border-[var(--border)] rounded p-2"
                      data-testid="axis-onchain-empty"
                    >
                      No series yet. Search a DefiLlama protocol and click a result to attach
                      its <strong>TVL</strong> curve. Values are USD liquidity, plotted on the
                      left scale — not exchange price candles.
                    </div>
                  }
                >
                  <For each={onchainManagerState.series}>
                    {(s) => (
                      <div
                        class="border border-[var(--border)] rounded p-2 flex flex-col gap-1.5"
                        data-testid={`axis-onchain-series-${s.id}`}
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="font-medium truncate">{s.label}</div>
                            <div class="text-muted text-[0.72rem] truncate">
                              {s.provider}
                              {s.lastTvl != null ? ` · ${fmtUsd(s.lastTvl)}` : ''}
                              {s.loading ? ' · loading…' : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            class="sc-btn sc-btn-ghost sc-btn-sm shrink-0"
                            onClick={() => detachOnchainSeries(s.id)}
                            title="Remove series"
                            data-testid={`axis-onchain-detach-${s.id}`}
                          >
                            <Icons.x />
                          </button>
                        </div>

                        <label class="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={s.visible}
                            onChange={(e) =>
                              setOnchainSeriesVisible(s.id, e.currentTarget.checked)
                            }
                            data-testid={`axis-onchain-visible-${s.id}`}
                          />
                          <span>Visible</span>
                        </label>

                        <div class="text-[0.68rem] text-muted leading-snug">
                          <div>
                            {s.provenance?.provider
                              ? `${s.provenance.provider}${
                                  s.provenance.queryId
                                    ? ` · ${s.provenance.queryId}`
                                    : ''
                                }`
                              : ''}
                          </div>
                          <div>{s.finality}</div>
                        </div>

                        <Show when={s.error}>
                          <div class="text-red text-[0.72rem]">{s.error}</div>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </div>

              {/* TVL footer: export + jobs */}
              <div
                class="border-t border-[var(--border)] pt-2 flex flex-col gap-2"
                data-testid="axis-onchain-tvl-footer"
              >
                <div class="flex flex-wrap gap-1" data-testid="axis-onchain-export">
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost sc-btn-sm"
                    onClick={onExportSeries}
                    data-testid="axis-onchain-export-series"
                    title="Download attached series as long CSV (series,time,value)"
                  >
                    <Icons.fileCsv />
                    <span>Export series CSV</span>
                  </button>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost sc-btn-sm"
                    onClick={onExportEvents}
                    data-testid="axis-onchain-export-events"
                    title="Download spike events as CSV"
                  >
                    <Icons.download />
                    <span>Export events CSV</span>
                  </button>
                </div>

                <Show when={onchainJobsState.jobs.length}>
                  <div class="flex flex-col gap-1.5" data-testid="axis-onchain-jobs">
                    <div class="text-muted text-[0.72rem] uppercase tracking-wide">
                      Jobs
                    </div>
                    <For each={onchainJobsState.jobs}>
                      {(job) => {
                        const pct = () =>
                          Math.round(
                            Math.max(0, Math.min(1, Number(job.progress) || 0)) * 100,
                          );
                        return (
                          <div
                            class="border border-[var(--border)] rounded px-2 py-1.5 flex flex-col gap-1"
                            data-testid={`axis-onchain-job-${job.id}`}
                            data-status={job.status}
                          >
                            <div class="flex items-start justify-between gap-2 min-w-0">
                              <div class="min-w-0">
                                <div class="font-medium truncate text-[0.78rem]">
                                  {job.label}
                                </div>
                                <div class="text-muted text-[0.68rem] truncate">
                                  {jobStatusLabel(job)}
                                  {job.kind ? ` · ${job.kind}` : ''}
                                </div>
                              </div>
                              <div class="flex items-center gap-1 shrink-0">
                                <span class="text-[0.68rem] text-muted tabular-nums">
                                  {pct()}%
                                </span>
                                <button
                                  type="button"
                                  class="sc-btn sc-btn-ghost sc-btn-sm"
                                  onClick={() => dismissOnchainJob(job.id)}
                                  data-testid={`axis-onchain-job-dismiss-${job.id}`}
                                  title="Dismiss job"
                                >
                                  <Icons.x />
                                </button>
                              </div>
                            </div>
                            <div
                              class="h-1 rounded bg-[var(--border)] overflow-hidden"
                              role="progressbar"
                              aria-valuenow={pct()}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <div
                                class="h-full bg-[var(--accent,var(--indigo,#6366f1))] transition-[width] duration-200"
                                style={{ width: `${pct()}%` }}
                              />
                            </div>
                            <Show when={job.error}>
                              <div class="text-red text-[0.68rem]">{job.error}</div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* ═══════════════ DEX ═══════════════ */}
          <Show when={mode() === 'dex'}>
            <div
              role="tabpanel"
              aria-label="DEX pool OHLCV"
              class="flex flex-col gap-3"
              data-testid="axis-onchain-panel-dex"
            >
              <p class="text-muted m-0 leading-snug">
                Load a DEX pool’s OHLCV onto the <strong>main chart</strong> via{' '}
                <code class="text-[0.75rem]">{GECKO_SOURCE_ID}</code>. Symbol format:{' '}
                <code class="text-[0.75rem]">network:0x…</code>
              </p>

              <p
                class="text-muted m-0 text-[0.72rem] leading-snug break-all"
                data-testid="axis-onchain-datapath-gecko"
                title={geckoPath().base}
              >
                Data path:{' '}
                <Show
                  when={geckoPath().via === 'worker'}
                  fallback={
                    <span>direct geckoterminal.com (CORS may fail in browser)</span>
                  }
                >
                  <span>Worker proxy</span>
                </Show>
                {' · '}
                <code class="text-[0.7rem] opacity-80">{geckoPath().base}</code>
              </p>

              <Show when={!geckoSourceRegistered()}>
                <div
                  class="text-muted text-[0.78rem] leading-snug border border-dashed border-[var(--border)] rounded p-2"
                  data-testid="axis-onchain-dex-source-missing"
                  role="status"
                >
                  Source <strong>{GECKO_SOURCE_ID}</strong> is not registered yet. Register
                  the GeckoTerminal OHLCV source (plugin / catalog) before loading pools.
                </div>
              </Show>

              <label class="flex flex-col gap-0.5" data-testid="axis-onchain-dex-network">
                <span class="text-muted text-[0.72rem] uppercase tracking-wide">Network</span>
                <select
                  class="sc-input"
                  value={dexNetwork()}
                  onChange={(e) => setDexNetwork(e.currentTarget.value as DexNetworkId)}
                  data-testid="axis-onchain-dex-network-select"
                >
                  <For each={DEX_NETWORKS}>
                    {(n) => <option value={n.id}>{n.label}</option>}
                  </For>
                </select>
              </label>

              <label class="flex flex-col gap-0.5" data-testid="axis-onchain-dex-pool">
                <span class="text-muted text-[0.72rem] uppercase tracking-wide">
                  Pool address
                </span>
                <input
                  type="text"
                  class="sc-input font-mono text-[0.78rem]"
                  placeholder={
                    dexNetwork() === 'solana' ? 'Base58 pool address…' : '0x… pool address'
                  }
                  value={poolAddress()}
                  onInput={(e) => setPoolAddress(e.currentTarget.value)}
                  autocomplete="off"
                  spellcheck={false}
                  data-testid="axis-onchain-dex-pool-input"
                />
              </label>

              <button
                type="button"
                class="sc-btn sc-btn-primary w-full"
                disabled={dexLoading() || !poolAddress().trim()}
                onClick={() => void onLoadAsChart()}
                data-testid="axis-onchain-dex-load"
                title="Set symbol + GeckoTerminal source and load OHLCV"
              >
                <Show when={dexLoading()} fallback={<Icons.trend />}>
                  <Icons.loader class="animate-spin" />
                </Show>
                <span>{dexLoading() ? 'Loading…' : 'Load as chart'}</span>
              </button>

              <Show when={dexError()}>
                <div
                  class="text-red text-[0.78rem]"
                  role="alert"
                  data-testid="axis-onchain-dex-error"
                >
                  {dexError()}
                </div>
              </Show>
              <Show when={dexMsg()}>
                <div
                  class="text-muted text-[0.78rem]"
                  role="status"
                  data-testid="axis-onchain-dex-msg"
                >
                  {dexMsg()}
                </div>
              </Show>

              <div class="border-t border-[var(--border)] pt-2 flex flex-col gap-2">
                <label class="flex flex-col gap-0.5" data-testid="axis-onchain-dex-search">
                  <span class="text-muted text-[0.72rem] uppercase tracking-wide">
                    Search pools
                  </span>
                  <input
                    type="search"
                    class="sc-input"
                    placeholder="Token / pool name…"
                    value={poolQuery()}
                    onInput={(e) => onPoolSearchInput(e.currentTarget.value)}
                    autocomplete="off"
                    spellcheck={false}
                    data-testid="axis-onchain-dex-search-input"
                  />
                </label>

                <Show when={poolSearchLoading()}>
                  <div class="text-muted text-[0.78rem] flex items-center gap-1.5" role="status">
                    <Icons.loader class="animate-spin" />
                    <span>Searching pools…</span>
                  </div>
                </Show>

                <Show when={poolSearchError()}>
                  <div
                    class="text-red text-[0.78rem]"
                    role="alert"
                    data-testid="axis-onchain-dex-search-error"
                  >
                    {poolSearchError()}
                  </div>
                </Show>

                <Show
                  when={poolResults().length}
                  fallback={
                    <Show
                      when={
                        poolQuery().trim() && !poolSearchLoading() && !poolSearchError()
                      }
                    >
                      <div class="text-muted text-[0.78rem] py-1">No pools match.</div>
                    </Show>
                  }
                >
                  <div class="flex flex-col gap-1" data-testid="axis-onchain-dex-results">
                    <div class="text-muted text-[0.72rem] uppercase tracking-wide">
                      Pool results
                    </div>
                    <For each={poolResults()}>
                      {(hit) => (
                        <button
                          type="button"
                          class="sc-btn sc-btn-ghost w-full justify-start text-left border border-[var(--border)] rounded px-2 py-1.5"
                          onClick={() => pickPool(hit)}
                          data-testid={`axis-onchain-dex-result-${hit.address}`}
                          title={`Use pool ${hit.address}`}
                        >
                          <div class="flex items-start justify-between gap-2 w-full min-w-0">
                            <div class="min-w-0">
                              <div class="font-medium truncate">
                                {hit.name || hit.symbol || hit.address.slice(0, 12) + '…'}
                              </div>
                              <div class="text-muted text-[0.72rem] truncate font-mono">
                                {hit.network + ' · ' + hit.address}
                              </div>
                            </div>
                            <span class="text-[0.72rem] text-muted shrink-0 tabular-nums">
                              {hit.priceUsd != null && Number.isFinite(hit.priceUsd)
                                ? `$${hit.priceUsd < 1 ? hit.priceUsd.toPrecision(3) : hit.priceUsd.toFixed(2)}`
                                : ''}
                            </span>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* ═══════════════ Events ═══════════════ */}
          <Show when={mode() === 'events'}>
            <div
              role="tabpanel"
              aria-label="On-chain events"
              class="flex flex-col gap-3"
              data-testid="axis-onchain-panel-events"
            >
              <p class="text-muted m-0 leading-snug">
                Detect large day-over-day <strong>TVL</strong> moves on attached DefiLlama
                series (≥10%). Chart markers update when the events plane is wired.
              </p>

              <div class="flex items-center justify-between gap-2">
                <div
                  class="text-muted text-[0.78rem]"
                  data-testid="axis-onchain-event-count"
                >
                  Events: <strong class="text-text">{eventCount()}</strong>
                  <Show when={onchainManagerState.eventSourceLabel}>
                    {' · '}
                    <span class="opacity-80">{onchainManagerState.eventSourceLabel}</span>
                  </Show>
                </div>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost sc-btn-sm"
                  disabled={!eventCount()}
                  onClick={onClearEvents}
                  data-testid="axis-onchain-clear-events"
                  title="Clear spike event list"
                >
                  <Icons.trash />
                  <span>Clear events</span>
                </button>
              </div>

              <Show when={onchainManagerState.eventsLoading}>
                <div class="text-muted text-[0.78rem] flex items-center gap-1.5" role="status">
                  <Icons.loader class="animate-spin" />
                  <span>Scanning TVL spikes…</span>
                </div>
              </Show>

              <Show when={onchainManagerState.eventsError}>
                <div
                  class="text-red text-[0.78rem]"
                  role="alert"
                  data-testid="axis-onchain-events-error"
                >
                  {onchainManagerState.eventsError}
                </div>
              </Show>

              <Show when={eventsMsg()}>
                <div
                  class="text-muted text-[0.78rem]"
                  role="status"
                  data-testid="axis-onchain-events-msg"
                >
                  {eventsMsg()}
                </div>
              </Show>

              <div class="flex flex-col gap-2" data-testid="axis-onchain-events-series">
                <div class="text-muted text-[0.72rem] uppercase tracking-wide">
                  Attached TVL series
                </div>
                <Show
                  when={onchainManagerState.series.length}
                  fallback={
                    <div
                      class="text-muted text-[0.78rem] py-2 leading-snug border border-dashed border-[var(--border)] rounded p-2"
                      data-testid="axis-onchain-events-empty-series"
                    >
                      No attached series. Switch to <strong>TVL</strong>, attach a protocol,
                      then return here to scan for spikes.
                    </div>
                  }
                >
                  <For each={onchainManagerState.series}>
                    {(s) => (
                      <div
                        class="border border-[var(--border)] rounded p-2 flex flex-col gap-1.5"
                        data-testid={`axis-onchain-events-series-${s.id}`}
                      >
                        <div class="flex items-start justify-between gap-2 min-w-0">
                          <div class="min-w-0">
                            <div class="font-medium truncate">{s.label}</div>
                            <div class="text-muted text-[0.72rem]">
                              {s.points?.length
                                ? `${s.points.length} points`
                                : 'no points yet'}
                              {s.lastTvl != null ? ` · ${fmtUsd(s.lastTvl)}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            class="sc-btn sc-btn-ghost sc-btn-sm shrink-0"
                            disabled={
                              !!s.loading ||
                              spikeBusyId() === s.id ||
                              onchainManagerState.eventsLoading ||
                              !s.points?.length
                            }
                            onClick={() => void onShowSpikes(s.id, s.label)}
                            data-testid={`axis-onchain-show-spikes-${s.id}`}
                            title="Detect ≥10% day-over-day TVL spikes"
                          >
                            <Show
                              when={spikeBusyId() === s.id}
                              fallback={<Icons.activity />}
                            >
                              <Icons.loader class="animate-spin" />
                            </Show>
                            <span>Show TVL spikes</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>

              <div class="flex flex-col gap-1" data-testid="axis-onchain-events-list">
                <div class="text-muted text-[0.72rem] uppercase tracking-wide">
                  Event list
                </div>
                <Show
                  when={onchainManagerState.events.length}
                  fallback={
                    <div
                      class="text-muted text-[0.78rem] py-2 leading-snug border border-dashed border-[var(--border)] rounded p-2"
                      data-testid="axis-onchain-events-empty"
                    >
                      No spike events yet. Click <strong>Show TVL spikes</strong> on a series
                      above.
                    </div>
                  }
                >
                  <For each={onchainManagerState.events}>
                    {(ev) => {
                      const pct = () => fmtEventPct(ev);
                      const isDrop = () =>
                        String(ev.type || '').includes('drop') ||
                        (typeof ev.payload?.pctChange === 'number' &&
                          (ev.payload.pctChange as number) < 0);
                      return (
                        <div
                          class="border border-[var(--border)] rounded px-2 py-1.5 flex flex-col gap-0.5"
                          data-testid={`axis-onchain-event-${ev.time}-${ev.type}`}
                        >
                          <div class="flex items-center justify-between gap-2">
                            <span class="font-medium truncate">
                              {ev.title || ev.type}
                            </span>
                            <Show when={pct()}>
                              <span
                                class={`text-[0.72rem] tabular-nums shrink-0 ${
                                  isDrop() ? 'text-red' : 'text-green'
                                }`}
                              >
                                {pct()}
                              </span>
                            </Show>
                          </div>
                          <div class="text-muted text-[0.72rem] truncate">
                            {fmtEventTime(ev.time)}
                            {ev.severity ? ` · ${ev.severity}` : ''}
                            {ev.price != null && Number.isFinite(ev.price)
                              ? ` · ${fmtUsd(ev.price)}`
                              : ''}
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
