/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Workers Manager catalog + matching helpers (no network).
 */

import { describe, expect, it } from 'bun:test';
import {
  WORKER_CATALOG,
  listWorkerCatalog,
  getWorkerCatalogEntry,
  normalizeWorkerBase,
  endpointsMatch,
  matchCatalogForEndpoint,
  DEFAULT_AXIS_WORKER_BASE,
  LOCAL_AXIS_WORKER_BASE,
  DEFAULT_PYNE_PRO_BASE,
} from '../src/workers/catalog';
import { workerHealthLabel } from '../src/workers/probe';

describe('workers catalog', () => {
  it('exposes stable core ids', () => {
    const ids = listWorkerCatalog().map((w) => w.id);
    expect(ids).toContain('pyne-pro');
    expect(ids).toContain('axis-worker');
    expect(ids).toContain('axis-worker-local');
    expect(ids).toContain('pyodide');
    expect(ids).toContain('service-worker');
    expect(ids).toContain('pyne-agent');
  });

  it('has install steps for every entry', () => {
    for (const w of WORKER_CATALOG) {
      expect(w.install.length).toBeGreaterThan(0);
      expect(w.name.length).toBeGreaterThan(0);
      expect(w.summary.length).toBeGreaterThan(0);
      expect(w.description.length).toBeGreaterThan(0);
    }
  });

  it('getWorkerCatalogEntry resolves known ids', () => {
    expect(getWorkerCatalogEntry('pyne-pro')?.defaultEndpoint).toBe(DEFAULT_PYNE_PRO_BASE);
    expect(getWorkerCatalogEntry('axis-worker')?.defaultEndpoint).toBe(
      DEFAULT_AXIS_WORKER_BASE,
    );
    expect(getWorkerCatalogEntry('axis-worker-local')?.defaultEndpoint).toBe(
      LOCAL_AXIS_WORKER_BASE,
    );
    expect(getWorkerCatalogEntry('missing' as never)).toBeUndefined();
  });

  it('normalizeWorkerBase strips trailing slash and /api/run', () => {
    expect(normalizeWorkerBase('https://x.example/api/run')).toBe('https://x.example');
    expect(normalizeWorkerBase('http://127.0.0.1:5002/')).toBe('http://127.0.0.1:5002');
    expect(normalizeWorkerBase('  ')).toBe('');
  });

  it('endpointsMatch compares origins', () => {
    expect(
      endpointsMatch('http://127.0.0.1:5002', 'http://127.0.0.1:5002/'),
    ).toBe(true);
    expect(
      endpointsMatch(
        'https://pynescript-axis.cryptolinx.workers.dev/api',
        DEFAULT_AXIS_WORKER_BASE,
      ),
    ).toBe(true);
    expect(endpointsMatch('http://127.0.0.1:5002', LOCAL_AXIS_WORKER_BASE)).toBe(
      false,
    );
  });

  it('matchCatalogForEndpoint classifies common hosts', () => {
    expect(matchCatalogForEndpoint('http://127.0.0.1:5002')).toBe('pyne-pro');
    expect(matchCatalogForEndpoint('http://localhost:8787')).toBe('axis-worker-local');
    expect(matchCatalogForEndpoint(DEFAULT_AXIS_WORKER_BASE)).toBe('axis-worker');
    expect(
      matchCatalogForEndpoint('https://pyne-agent-worker.cryptolinx.workers.dev'),
    ).toBe('pyne-agent');
    expect(matchCatalogForEndpoint('https://pyne-worker.example.workers.dev')).toBe(
      'pyne-worker',
    );
    expect(matchCatalogForEndpoint('')).toBeNull();
  });
});

describe('workerHealthLabel', () => {
  it('maps statuses', () => {
    expect(workerHealthLabel('healthy')).toBe('Healthy');
    expect(workerHealthLabel('down')).toBe('Down');
    expect(workerHealthLabel('skipped')).toBe('Skipped');
    expect(workerHealthLabel('unknown')).toBe('Unknown');
  });
});
