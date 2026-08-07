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
 * Lightweight on-chain series + events attach state (Solid store).
 *
 * Holds chart attachments, protocol search UI state, and the events plane.
 * Does **not** touch ChartHost — chart agent consumes
 * {@link onchainManagerState}.
 *
 * Field naming: primary shape uses `attachments` / `loadingSearch` / `lastError`
 * (Phase 1 spec). Parallel UI/chart also read `series` / `searchLoading` /
 * `error` aliases kept in lockstep. Events: `events` / `eventsLoading` /
 * `eventsError` / `eventSourceLabel`.
 *
 * @module onchain/manager
 */

import { createStore, produce } from 'solid-js/store';
import { datasetToScalarPoints, normalizeProtocolSlug } from './adapters';
import { putCachedDataset } from './cache';
import {
  DEFILLAMA_DATASET_ID,
  DEFILLAMA_PROVIDER_ID,
  ensureOnchainDatasetsRegistered,
  getDatasetPlugin,
} from './catalog';
import { searchDefiLlamaProtocols } from './defillama';
import {
  buildTvlSpikeEvents,
  normalizeEventPoints,
  tvlSpikeEventSourceLabel,
} from './events';
import { resolveDefiLlamaBaseUrl } from './proxy';
import { instrumentCacheKey } from './keys';
import type {
  EventPoint,
  OnchainInstrument,
  OnchainSeriesAttachment,
  TimePoint,
} from './types';

/** Max simultaneous on-chain series on the chart. */
export const MAX_ONCHAIN_SERIES = 8;

/** Void-theme series palette (matches PLOT_PALETTE spirit). */
const ONCHAIN_PALETTE = [
  '#939fff',
  '#8ef5a8',
  '#e8a03a',
  '#6ec8d4',
  '#a7b4ff',
  '#5ecf8a',
  '#e85d4c',
  '#8b8e9c',
];

/** Protocol search hit (DefiLlama). */
export interface ProtocolSearchHit {
  slug: string;
  name: string;
  tvl?: number;
}

/** Alias used by OnChainPanel. */
export type DefiLlamaProtocolHit = ProtocolSearchHit;

/**
 * Attachment row with convenience fields for panel / chart consumers.
 * Extends {@link OnchainSeriesAttachment}.
 */
export interface OnchainSeriesRow extends OnchainSeriesAttachment {
  /** Same as `providerId` (panel uses `provider`). */
  provider: string;
  /** Protocol / instrument key (e.g. DefiLlama slug). */
  key: string;
  /** Latest scalar value (e.g. last TVL USD). */
  lastTvl?: number | null;
}

export interface OnchainManagerState {
  /** Attached chart series (Phase 1 name). */
  attachments: OnchainSeriesRow[];
  /**
   * Alias of {@link attachments} — ChartHost / OnChainPanel read `series`.
   * Always kept equal to `attachments`.
   */
  series: OnchainSeriesRow[];
  protocolQuery: string;
  loadingSearch: boolean;
  /** Alias of {@link loadingSearch}. */
  searchLoading: boolean;
  searchResults: ProtocolSearchHit[];
  lastError: string | null;
  /** Alias of {@link lastError} for attach/search failures. */
  error: string | null;
  /** Search-specific error (panel reads this separately). */
  searchError: string | null;
  /** Currently displayed on-chain events (markers / list). */
  events: EventPoint[];
  eventsLoading: boolean;
  eventsError: string | null;
  /** e.g. `"aave TVL spikes"`. */
  eventSourceLabel: string | null;
}

const [state, setState] = createStore<OnchainManagerState>({
  attachments: [],
  series: [],
  protocolQuery: '',
  loadingSearch: false,
  searchLoading: false,
  searchResults: [],
  lastError: null,
  error: null,
  searchError: null,
  events: [],
  eventsLoading: false,
  eventsError: null,
  eventSourceLabel: null,
});

/** Reactive Solid store for on-chain manager UI / chart consumers. */
export { state as onchainManagerState };

/** Snapshot accessor (same reactive object as {@link onchainManagerState}). */
export function getOnchainManagerState(): OnchainManagerState {
  return state;
}

let colorCursor = 0;

function nextColor(): string {
  const c = ONCHAIN_PALETTE[colorCursor % ONCHAIN_PALETTE.length]!;
  colorCursor += 1;
  return c;
}

function attachmentId(): string {
  return `ocs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Unknown error';
}

function sameProtocolMetric(
  a: OnchainInstrument,
  protocolId: string,
  metric: string,
): boolean {
  return (
    normalizeProtocolSlug(a.protocolId || '') === protocolId &&
    (a.metric || '') === metric
  );
}

/** Write both `attachments` and `series` to the same row list. */
function setSeriesRows(rows: OnchainSeriesRow[]): void {
  setState('attachments', rows);
  setState('series', rows);
}

function patchSeriesRow(id: string, patch: Partial<OnchainSeriesRow>): void {
  setState(
    produce((s) => {
      const idx = s.attachments.findIndex((a) => a.id === id);
      if (idx < 0) return;
      const next = { ...s.attachments[idx]!, ...patch } as OnchainSeriesRow;
      s.attachments[idx] = next;
      s.series[idx] = next;
    }),
  );
}

function setLoadingSearch(v: boolean): void {
  setState('loadingSearch', v);
  setState('searchLoading', v);
}

function setLastError(msg: string | null): void {
  setState('lastError', msg);
  setState('error', msg);
}

function lastTvlFromPoints(points: TimePoint[]): number | null {
  if (!points.length) return null;
  const v = points[points.length - 1]!.value;
  return Number.isFinite(v) ? v : null;
}

function toRow(
  base: OnchainSeriesAttachment,
  extras?: Partial<OnchainSeriesRow>,
): OnchainSeriesRow {
  const key =
    extras?.key ||
    normalizeProtocolSlug(base.instrument.protocolId || '') ||
    base.id;
  return {
    ...base,
    provider: extras?.provider ?? base.providerId,
    key,
    lastTvl:
      extras?.lastTvl !== undefined
        ? extras.lastTvl
        : lastTvlFromPoints(base.points),
  };
}

export type AttachDefiLlamaArg =
  | string
  | { slug: string; name?: string; tvl?: number };

/**
 * Fetch DefiLlama TVL for a protocol and attach (or refresh) a chart series.
 *
 * Accepts `slug` + optional `name`, or a search hit `{ slug, name }`.
 * Caps at {@link MAX_ONCHAIN_SERIES}; refreshes existing same protocol+metric.
 */
export async function attachDefiLlamaTvl(
  slugOrHit: AttachDefiLlamaArg,
  name?: string,
): Promise<OnchainSeriesAttachment> {
  ensureOnchainDatasetsRegistered();

  let slug: string;
  let displayName: string | undefined;
  if (typeof slugOrHit === 'string') {
    slug = slugOrHit;
    displayName = name;
  } else if (slugOrHit && typeof slugOrHit === 'object') {
    slug = slugOrHit.slug;
    displayName = slugOrHit.name ?? name;
  } else {
    slug = '';
  }

  const protocolId = normalizeProtocolSlug(slug);
  if (!protocolId) {
    const msg = 'Protocol slug is required';
    setLastError(msg);
    throw new Error(msg);
  }

  const plugin = getDatasetPlugin(DEFILLAMA_DATASET_ID);
  if (!plugin) {
    const msg = 'DefiLlama TVL dataset plugin not registered';
    setLastError(msg);
    throw new Error(msg);
  }

  const labelBase = (displayName && displayName.trim()) || protocolId;
  const instrument: OnchainInstrument = {
    chainId: 'all',
    protocolId,
    metric: 'tvl',
    symbol: `${labelBase} TVL`,
  };

  const existingIdx = state.attachments.findIndex((a) =>
    sameProtocolMetric(a.instrument, protocolId, 'tvl'),
  );

  if (existingIdx < 0 && state.attachments.length >= MAX_ONCHAIN_SERIES) {
    const msg = `Max on-chain series reached (${MAX_ONCHAIN_SERIES})`;
    setLastError(msg);
    throw new Error(msg);
  }

  const pendingId =
    existingIdx >= 0 ? state.attachments[existingIdx]!.id : attachmentId();
  const color =
    existingIdx >= 0 ? state.attachments[existingIdx]!.color : nextColor();

  if (existingIdx >= 0) {
    patchSeriesRow(pendingId, {
      loading: true,
      error: null,
      label: instrument.symbol,
      instrument,
      key: protocolId,
      provider: DEFILLAMA_PROVIDER_ID,
    });
  } else {
    const placeholder = toRow(
      {
        id: pendingId,
        datasetId: DEFILLAMA_DATASET_ID,
        providerId: DEFILLAMA_PROVIDER_ID,
        instrument,
        label: instrument.symbol,
        color,
        visible: true,
        scale: 'left',
        points: [],
        provenance: { provider: DEFILLAMA_PROVIDER_ID },
        finality: 'unknown',
        loading: true,
        error: null,
      },
      { key: protocolId, lastTvl: null },
    );
    const next = state.attachments.concat([placeholder]);
    setSeriesRows(next);
  }

  setLastError(null);

  try {
    const ds = await plugin.fetchDataset({ instrument, resolution: '1d' });
    const points: TimePoint[] = datasetToScalarPoints(ds);
    if (!points.length) {
      throw new Error(`No TVL points for protocol "${protocolId}"`);
    }

    const cacheKey = instrumentCacheKey(
      DEFILLAMA_PROVIDER_ID,
      ds.instrument,
      ds.resolution || '1d',
    );
    try {
      await putCachedDataset(cacheKey, ds);
    } catch {
      /* cache optional */
    }

    const prevVisible =
      existingIdx >= 0 ? state.attachments[existingIdx]!.visible : true;

    const attachment = toRow(
      {
        id: pendingId,
        datasetId: DEFILLAMA_DATASET_ID,
        providerId: DEFILLAMA_PROVIDER_ID,
        instrument: ds.instrument,
        label: ds.instrument.symbol || instrument.symbol,
        color,
        visible: prevVisible,
        scale: 'left',
        points,
        provenance: ds.provenance,
        finality: ds.finality,
        loading: false,
        error: null,
      },
      {
        key: normalizeProtocolSlug(ds.instrument.protocolId || protocolId),
        lastTvl: lastTvlFromPoints(points),
      },
    );

    setState(
      produce((s) => {
        const idx = s.attachments.findIndex((a) => a.id === pendingId);
        if (idx >= 0) {
          s.attachments[idx] = attachment;
          s.series[idx] = attachment;
        } else {
          s.attachments.push(attachment);
          s.series.push(attachment);
        }
        s.lastError = null;
        s.error = null;
      }),
    );

    return attachment;
  } catch (err) {
    const msg = errMessage(err);
    patchSeriesRow(pendingId, { loading: false, error: msg });
    setLastError(msg);
    throw err instanceof Error ? err : new Error(msg);
  }
}

/** Remove one attached series by id. */
export function detachOnchainSeries(id: string): void {
  const sid = String(id || '');
  setState(
    produce((s) => {
      s.attachments = s.attachments.filter((a) => a.id !== sid);
      s.series = s.series.filter((a) => a.id !== sid);
    }),
  );
}

/** Toggle / set visibility of an attached series. */
export function setOnchainSeriesVisible(id: string, vis: boolean): void {
  patchSeriesRow(String(id || ''), { visible: !!vis });
}

/** Detach every on-chain series. */
export function clearAllOnchainSeries(): void {
  setSeriesRows([]);
  setLastError(null);
  setState('searchError', null);
}

/**
 * Replace the displayed on-chain events plane (normalized + sorted).
 * Does not touch series attachments.
 */
export function setOnchainEvents(
  events: EventPoint[],
  label?: string,
): void {
  const normalized = normalizeEventPoints(events);
  setState(
    produce((s) => {
      s.events = normalized;
      s.eventsLoading = false;
      s.eventsError = null;
      s.eventSourceLabel =
        label != null && String(label).trim() ? String(label).trim() : null;
    }),
  );
}

/** Clear on-chain events plane state. */
export function clearOnchainEvents(): void {
  setState(
    produce((s) => {
      s.events = [];
      s.eventsLoading = false;
      s.eventsError = null;
      s.eventSourceLabel = null;
    }),
  );
}

/**
 * Derive TVL spike/drop events from an already-attached series and load them
 * into the events plane.
 *
 * @param attachmentId row id from {@link onchainManagerState.attachments}
 * @param thresholdPct min |day-over-day %| (default 10)
 */
export async function loadTvlSpikeEventsFromAttachment(
  attachmentId: string,
  thresholdPct?: number,
): Promise<void> {
  const id = String(attachmentId || '');
  const row = state.attachments.find((a) => a.id === id);

  setState(
    produce((s) => {
      s.eventsLoading = true;
      s.eventsError = null;
    }),
  );

  // Yield so Solid consumers can paint loading; pure compute stays sync.
  await Promise.resolve();

  try {
    if (!row) {
      throw new Error(`On-chain attachment not found: ${id || '(empty)'}`);
    }
    const points = Array.isArray(row.points) ? row.points : [];
    if (points.length < 2) {
      throw new Error(
        `Attachment "${row.label || id}" has insufficient TVL points for spikes`,
      );
    }

    const protocolLabel =
      row.instrument?.symbol ||
      row.label ||
      row.key ||
      row.instrument?.protocolId ||
      '';

    const events = buildTvlSpikeEvents(points, {
      thresholdPct,
      protocolLabel,
    });
    const sourceLabel = tvlSpikeEventSourceLabel(
      row.key || row.instrument?.protocolId || protocolLabel,
    );

    setState(
      produce((s) => {
        s.events = events;
        s.eventsLoading = false;
        s.eventsError = null;
        s.eventSourceLabel = sourceLabel;
      }),
    );
  } catch (err) {
    const msg = errMessage(err);
    setState(
      produce((s) => {
        s.events = [];
        s.eventsLoading = false;
        s.eventsError = msg;
        s.eventSourceLabel = null;
      }),
    );
    throw err instanceof Error ? err : new Error(msg);
  }
}

/**
 * Search DefiLlama protocols; updates `searchResults` / `protocolQuery` /
 * `loadingSearch` on the manager store.
 */
export async function searchProtocols(q: string): Promise<ProtocolSearchHit[]> {
  const query = String(q || '');
  setState('protocolQuery', query);
  setLoadingSearch(true);
  setState('searchError', null);

  try {
    const baseUrl = resolveDefiLlamaBaseUrl();
    const hits = await searchDefiLlamaProtocols(query, 20, { baseUrl });
    const results: ProtocolSearchHit[] = hits.map((h) => ({
      slug: h.slug,
      name: h.name,
      tvl: h.tvl,
    }));
    setState('searchResults', results);
    setLoadingSearch(false);
    return results;
  } catch (err) {
    const msg = errMessage(err);
    setState('searchResults', []);
    setLoadingSearch(false);
    setState('searchError', msg);
    setLastError(msg);
    throw err instanceof Error ? err : new Error(msg);
  }
}

/** @internal test helper */
export function _resetOnchainManagerState(): void {
  colorCursor = 0;
  setState({
    attachments: [],
    series: [],
    protocolQuery: '',
    loadingSearch: false,
    searchLoading: false,
    searchResults: [],
    lastError: null,
    error: null,
    searchError: null,
    events: [],
    eventsLoading: false,
    eventsError: null,
    eventSourceLabel: null,
  });
}
