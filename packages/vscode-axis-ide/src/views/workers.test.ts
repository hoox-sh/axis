// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    description?: string;
    contextValue?: string;
    constructor(label: string, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class EventEmitter {
    event = () => ({ dispose() {} });
    fire(_v?: unknown) {}
  }
  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter,
    window: {
      createTreeView: () => ({ dispose() {} }),
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
    },
  };
});

type WorkersMod = typeof import('./workers');

let workers: WorkersMod;

beforeAll(async () => {
  workers = await import('./workers');
});

describe('axis.workers.probeAll offline', () => {
  test('probeAllWorkers never throws when fetch fails (offline)', async () => {
    const fetchImpl: workers.ProbeFetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };

    let snap: workers.WorkersOverviewSnapshot | undefined;
    await expect(
      (async () => {
        snap = await workers.probeAllWorkers({
          timeoutMs: 100,
          fetchImpl,
        });
      })(),
    ).resolves.toBeUndefined();

    expect(snap).toBeDefined();
    if (!snap) throw new Error('expected snapshot');
    expect(snap.results.length).toBe(workers.listWorkerCatalog().length);
    const http = snap.results.filter((r) => {
      const e = workers.getWorkerCatalogEntry(r.id);
      return e?.probe === 'http-health';
    });
    expect(http.length).toBeGreaterThan(0);
    for (const r of http) {
      expect(r.status).toBe('down');
      expect(r.error).toBeTruthy();
    }
    const skipped = snap.results.filter((r) => r.status === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
  });

  test('runProbeAllCommand never throws even if probeAll were hostile', async () => {
    const fetchImpl: workers.ProbeFetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    // No TreeDataProvider — avoids vscode.EventEmitter; command path still safe.
    const snap = await workers.runProbeAllCommand(undefined, {
      timeoutMs: 80,
      fetchImpl,
    });
    expect(snap.results.length).toBeGreaterThan(0);
    expect(workers.getLastWorkersSnapshot()?.checkedAt).toBe(snap.checkedAt);
  });

  test('probeWorker healthy path and unknown id', async () => {
    const fetchImpl: workers.ProbeFetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => '{"status":"ok"}',
    });
    const ok = await workers.probeWorker('pyne-pro', {
      timeoutMs: 200,
      fetchImpl,
    });
    expect(ok.status).toBe('healthy');
    expect(ok.error).toBeNull();

    const unknown = await workers.probeWorker('nope' as workers.WorkerId, {
      fetchImpl,
    });
    expect(unknown.status).toBe('unknown');
  });

  test('workers tree lists catalog entries', () => {
    workers._setLastWorkersSnapshotForTests(null);
    const roots = workers.workersRootChildren();
    expect(roots.map((n) => n.workerId)).toEqual(
      workers.listWorkerCatalog().map((e) => e.id),
    );
    expect(workers.WORKERS_VIEW_ID).toBe('axis.workers');
    expect(workers.PROBE_ALL_COMMAND).toBe('axis.workers.probeAll');
  });
});
