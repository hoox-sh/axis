/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Workers inventory — behaviour, not source text.
 *
 * The studio Workers page is a read-only inventory: mount probes the selected
 * worker once, Refresh probes the selected card (never the catalog), optional
 * workers stay hidden until the toggle, and the agent card navigates to
 * Plugins instead of installing or editing anything. This suite drives the
 * same `createWorkersInventory` controller the page renders from, so the
 * contract is executed rather than grepped out of `WorkersPage.tsx`.
 *
 * Bun resolves `solid-js` to its server build by default, where `createEffect`
 * is inert. This file pins the client dev build first so the controller's
 * selection effect and memos actually run (same reason as
 * `tests/helpers/mock-solid.ts`).
 */

import './setup';
import { describe, expect, it, mock } from 'bun:test';
import type { WorkersInventory, WorkersInventoryOptions } from '../src/ui/workers/inventory';
import type { WorkerId, WorkerProbeResult } from '../src/workers';
import type { StudioPageId } from '../src/ui/studio/types';

const solid = await import('solid-js/dist/dev.js');
mock.module('solid-js', () => solid);

const { createRoot } = await import('solid-js');
const { createWorkersInventory, visibleWorkers } = await import('../src/ui/workers/inventory');
const { listWorkerCatalog } = await import('../src/workers');
const { getInstalledPlugins } = await import('../src/plugins/loader');
const { store } = await import('../src/store');

/** Catalog entries that are optional (hidden until Show optional). */
const OPTIONAL: WorkerId[] = ['hp-ingest', 'pyne-agent', 'pyne-worker'];

function probeResult(
  id: WorkerId,
  status: WorkerProbeResult['status'] = 'healthy',
): WorkerProbeResult {
  return {
    id,
    status,
    latencyMs: 7,
    detail: `${id} ${status}`,
    endpoint: `http://${id}.test`,
    features: { healthy: true },
    service: null,
    checkedAt: Date.now(),
    error: null,
    isActiveBackend: false,
    isActiveEngine: false,
  };
}

/** Mount the controller in a real Solid root so its selection effect runs. */
function mount(opts: WorkersInventoryOptions = {}): {
  inv: WorkersInventory;
  dispose: () => void;
} {
  let inv!: WorkersInventory;
  const rootDispose = createRoot((d) => {
    inv = createWorkersInventory(opts);
    return d;
  });
  return {
    inv,
    dispose: () => {
      inv.dispose();
      rootDispose();
    },
  };
}

/** Observable state the forbidden writers mutate. */
function runtimeSnapshot(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      engine: store.engine,
      activePlugins: store.activePlugins,
      source: store.source,
      endpoint: store.endpoint,
      pluginsConfig: store.pluginsConfig,
      status: store.status,
    }),
  );
}

describe('optional worker filter', () => {
  it('hides every optional catalog entry until Show optional', () => {
    const all = listWorkerCatalog();
    const optionalIds = all.filter((w) => w.optional).map((w) => w.id);
    expect(optionalIds.sort()).toEqual([...OPTIONAL].sort());

    const hidden = visibleWorkers(all, false).map((w) => w.id);
    expect(hidden).toEqual(all.filter((w) => !w.optional).map((w) => w.id));
    for (const id of OPTIONAL) expect(hidden).not.toContain(id);

    const shown = visibleWorkers(all, true).map((w) => w.id);
    expect(shown).toEqual(all.map((w) => w.id));
    for (const id of OPTIONAL) expect(shown).toContain(id);
  });

  it('is the list the controller renders from', () => {
    const { inv, dispose } = mount();
    expect(inv.visible().map((w) => w.id)).toEqual(
      visibleWorkers(listWorkerCatalog(), false).map((w) => w.id),
    );
    inv.setShowOptional(true);
    expect(inv.visible().map((w) => w.id)).toEqual(listWorkerCatalog().map((w) => w.id));
    dispose();
  });
});

describe('mount and refresh probe one worker only', () => {
  it('probes the selected worker once on start', async () => {
    const calls: WorkerId[] = [];
    const { inv, dispose } = mount({
      probe: async (id) => {
        calls.push(id);
        return probeResult(id);
      },
    });

    await inv.start();

    expect(calls).toEqual(['pyne-pro']);
    expect(inv.snap()?.results.map((r) => r.id)).toEqual(['pyne-pro']);
    expect(inv.footerStatus()).toContain('1 healthy');
    dispose();
  });

  it('refreshes the selected card, never the whole catalog', async () => {
    const calls: WorkerId[] = [];
    const { inv, dispose } = mount({
      probe: async (id) => {
        calls.push(id);
        return probeResult(id);
      },
    });

    await inv.start();
    inv.select('axis-worker');
    await inv.refresh();
    inv.select('pyodide');
    await inv.refresh();

    expect(calls).toEqual(['pyne-pro', 'axis-worker', 'pyodide']);
    expect(calls.length).toBeLessThan(listWorkerCatalog().length);
    // The snapshot accumulates only the probed workers, not the catalog.
    expect(inv.snap()?.results.map((r) => r.id)).toEqual(['pyne-pro', 'axis-worker', 'pyodide']);
    dispose();
  });

  it('re-probes one card without moving the selection', async () => {
    const calls: WorkerId[] = [];
    const { inv, dispose } = mount({
      probe: async (id) => {
        calls.push(id);
        return probeResult(id);
      },
    });

    await inv.start();
    inv.select('axis-worker');
    await inv.refreshOne('pyodide');

    expect(calls).toEqual(['pyne-pro', 'pyodide']);
    expect(inv.selectedId()).toBe('axis-worker');
    expect(inv.selected()?.id).toBe('axis-worker');
    // Re-probing another card does not seed the selected card's inspector.
    expect(inv.selectedResult()).toBeUndefined();
    dispose();
  });

  it('surfaces a probe failure without throwing or leaving the spinner on', async () => {
    const { inv, dispose } = mount({
      probe: async () => {
        throw new Error('probe refused');
      },
    });

    await inv.start();

    expect(inv.probeError()).toBe('probe refused');
    expect(inv.probing()).toBe(false);
    expect(inv.snap()).toBeNull();
    dispose();
  });

  it('drops a late probe result after the page is disposed', async () => {
    let release!: (r: WorkerProbeResult) => void;
    const gate = new Promise<WorkerProbeResult>((resolve) => {
      release = resolve;
    });
    const { inv, dispose } = mount({ probe: () => gate });

    const inFlight = inv.start();
    dispose();
    release(probeResult('pyne-pro'));
    await inFlight;

    expect(inv.snap()).toBeNull();
  });
});

describe('selection stays inside the visible list', () => {
  it('can inspect the agent only after Show optional, and falls back when hidden', () => {
    const { inv, dispose } = mount();

    expect(inv.visible().map((w) => w.id)).not.toContain('pyne-agent');
    inv.setShowOptional(true);
    inv.select('pyne-agent');
    expect(inv.selected()?.id).toBe('pyne-agent');

    inv.setShowOptional(false);
    expect(inv.selectedId()).toBe(inv.visible()[0]?.id);
    expect(inv.visible().map((w) => w.id)).not.toContain('pyne-agent');
    dispose();
  });
});

describe('the agent card links to Plugins and edits nothing', () => {
  it('navigates to plugins', () => {
    const nav: StudioPageId[] = [];
    const { inv, dispose } = mount({ onNavigate: (id) => nav.push(id) });

    inv.openPlugins();

    expect(nav).toEqual(['plugins']);
    dispose();
  });

  it('leaves the installed plugin list alone', () => {
    const before = JSON.stringify(getInstalledPlugins());
    const { inv, dispose } = mount({ onNavigate: () => {} });

    inv.openPlugins();

    expect(JSON.stringify(getInstalledPlugins())).toBe(before);
    dispose();
  });
});

describe('read-only across every interaction', () => {
  it('never moves the Runtime engine, endpoint, or active plugins', async () => {
    const before = runtimeSnapshot();
    const calls: WorkerId[] = [];
    const { inv, dispose } = mount({
      probe: async (id) => {
        calls.push(id);
        return probeResult(id);
      },
      onNavigate: () => {},
    });

    // Mount, Refresh, walk every card, toggle optional both ways, inspect the
    // agent, re-probe one card, and link out — the full page surface.
    await inv.start();
    await inv.refresh();
    for (const w of inv.visible()) inv.select(w.id);
    inv.setShowOptional(true);
    inv.select('pyne-agent');
    await inv.refresh();
    inv.setShowOptional(false);
    await inv.refreshOne('pyodide');
    inv.openPlugins();

    expect(calls.length).toBe(4);
    expect(runtimeSnapshot()).toEqual(before);
    dispose();
  });
});
