// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workers inventory state — headless, no JSX.
 *
 * The studio Workers page is a read-only inventory: it probes one selected
 * worker and links to Plugins for the PYNE agent. It never activates a Runtime
 * engine, warms the compiler, touches hosted jobs, or edits the agent. Keeping
 * the state machine here lets the read-only contract be executed in tests
 * (`tests/studio-workers-inventory.test.ts`) instead of grepped out of TSX.
 *
 * @module ui/workers/inventory
 */

import { createEffect, createMemo, createSignal } from 'solid-js';
import {
  getWorkerCatalogEntry,
  listWorkerCatalog,
  probeWorker,
  type WorkerCatalogEntry,
  type WorkerId,
  type WorkerProbeResult,
  type WorkersOverviewSnapshot,
} from '../../workers';
import { store } from '../../store';
import type { StudioHealth } from '../studio';
import type { StudioPageId } from '../studio/types';

/** Probe dependency — the real `probeWorker` unless a test injects one. */
export type WorkersProbe = (id: WorkerId) => Promise<WorkerProbeResult>;

/** Catalog dependencies, overridable for tests. */
export type WorkersInventoryOptions = {
  initialWorkerId?: WorkerId;
  probe?: WorkersProbe;
  catalog?: () => WorkerCatalogEntry[];
  entry?: (id: WorkerId) => WorkerCatalogEntry | undefined;
  /** Studio navigation sink — Workers only links out to Plugins. */
  onNavigate?: (id: StudioPageId) => void;
};

/** The optional workers hidden until the inventory toggle is on. */
export function visibleWorkers(
  all: readonly WorkerCatalogEntry[],
  showOptional: boolean,
): WorkerCatalogEntry[] {
  return showOptional ? [...all] : all.filter((w) => !w.optional);
}

/** Probe result for one worker in a snapshot. */
export function resultFor(
  snap: WorkersOverviewSnapshot | null,
  id: WorkerId,
): WorkerProbeResult | undefined {
  return snap?.results.find((r) => r.id === id);
}

/** Narrow a probe status to the studio health vocabulary. */
export function toStudioHealth(status: WorkerProbeResult['status'] | undefined): StudioHealth {
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

/** State and actions the Workers page binds to. */
export type WorkersInventory = {
  selectedId: () => WorkerId;
  select: (id: WorkerId) => void;
  showOptional: () => boolean;
  setShowOptional: (on: boolean) => void;
  visible: () => WorkerCatalogEntry[];
  selected: () => WorkerCatalogEntry | undefined;
  selectedResult: () => WorkerProbeResult | undefined;
  snap: () => WorkersOverviewSnapshot | null;
  probing: () => boolean;
  probeError: () => string;
  footerStatus: () => string;
  /** Probe the selected worker — what the page's mount and Refresh run. */
  refresh: () => Promise<void>;
  /** Probe one worker (Re-probe button). */
  refreshOne: (id: WorkerId) => Promise<void>;
  /** Mount action: probe the selected worker once. */
  start: () => Promise<void>;
  /** Link to the Plugins page (agent install/edit lives there). */
  openPlugins: () => void;
  /** Drop in-flight probe results (page cleanup). */
  dispose: () => void;
};

/**
 * Create the Workers inventory state machine.
 *
 * @param opts - Optional initial selection, probe/catalog overrides, navigation.
 * @returns Signals, selectors, and the probe/navigation actions.
 */
export function createWorkersInventory(opts: WorkersInventoryOptions = {}): WorkersInventory {
  const probe: WorkersProbe = opts.probe ?? ((id) => probeWorker(id, { timeoutMs: 5000 }));
  const catalogAll = opts.catalog ?? listWorkerCatalog;
  const entry = opts.entry ?? getWorkerCatalogEntry;

  const [selectedId, setSelectedId] = createSignal<WorkerId>(opts.initialWorkerId || 'pyne-pro');
  const [snap, setSnap] = createSignal<WorkersOverviewSnapshot | null>(null);
  const [probing, setProbing] = createSignal(false);
  const [probeError, setProbeError] = createSignal('');
  const [showOptional, setShowOptional] = createSignal(false);

  const visible = createMemo(() => visibleWorkers(catalogAll(), showOptional()));
  const selected = createMemo(() => entry(selectedId()));
  const selectedResult = createMemo(() => resultFor(snap(), selectedId()));

  let probeGen = 0;

  const refreshOne = async (id: WorkerId): Promise<void> => {
    const gen = ++probeGen;
    setProbing(true);
    try {
      const r = await probe(id);
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

  const refresh = (): Promise<void> => refreshOne(selectedId());
  const start = (): Promise<void> => refreshOne(selectedId());
  const select = (id: WorkerId): void => {
    setSelectedId(id);
  };
  const openPlugins = (): void => opts.onNavigate?.('plugins');
  const dispose = (): void => {
    probeGen += 1;
  };

  // Keep the selection inside the visible list (hiding optional workers must
  // not leave the inspector on a hidden card).
  createEffect(() => {
    const ids = visible().map((w) => w.id);
    if (ids.length && !ids.includes(selectedId())) {
      setSelectedId(ids[0]!);
    }
  });

  const footerStatus = createMemo(() => {
    const s = snap();
    const eng = store.engine || store.activePlugins?.engine || 'server';
    if (probing() && !s) return 'Probing…';
    if (!s) return 'No probe yet — Refresh';
    const updating = probing() ? ' · updating' : '';
    return `${s.healthy} healthy · ${s.degraded} degraded · ${s.down} down · engine ${eng}${updating}`;
  });

  return {
    selectedId,
    select,
    showOptional,
    setShowOptional,
    visible,
    selected,
    selectedResult,
    snap,
    probing,
    probeError,
    footerStatus,
    refresh,
    refreshOne,
    start,
    openPlugins,
    dispose,
  };
}
