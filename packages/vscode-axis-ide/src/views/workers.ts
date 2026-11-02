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

/**
 * Workers TreeView + `axis.workers.probeAll` (offline-safe, never throws).
 * Catalog ids/endpoints mirrored from AXIS `src/workers/catalog.ts` (minimal).
 */

import * as vscode from 'vscode';

export const WORKERS_VIEW_ID = 'axis.workers';
export const PROBE_ALL_COMMAND = 'axis.workers.probeAll';

/** Stable catalog id (subset used by the IDE host). */
export type WorkerId =
  | 'pyne-pro'
  | 'axis-worker'
  | 'axis-worker-local'
  | 'pyodide'
  | 'pyne-agent'
  | 'service-worker'
  | 'pyne-worker'
  | 'hp-ingest';

export type WorkerHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'down'
  | 'unknown'
  | 'idle'
  | 'skipped';

export type WorkerProbeStrategy = 'http-health' | 'pyodide' | 'service-worker' | 'none';

export type WorkerCatalogEntry = {
  id: WorkerId;
  name: string;
  summary: string;
  defaultEndpoint: string;
  probe: WorkerProbeStrategy;
  healthPaths?: readonly string[];
};

/** Minimal host catalog — display + probe targets. */
export const WORKER_CATALOG: readonly WorkerCatalogEntry[] = [
  {
    id: 'pyne-pro',
    name: 'pyne Pro API',
    summary: 'CPython ± Numba calculation backend',
    defaultEndpoint: 'http://127.0.0.1:5002',
    probe: 'http-health',
    healthPaths: ['/health', '/'],
  },
  {
    id: 'axis-worker',
    name: 'AXIS Worker',
    summary: 'Cloudflare edge data plane',
    defaultEndpoint: 'https://worker.axis.hoox.sh',
    probe: 'http-health',
    healthPaths: ['/health', '/'],
  },
  {
    id: 'axis-worker-local',
    name: 'AXIS Worker (local)',
    summary: 'wrangler dev on :8787',
    defaultEndpoint: 'http://127.0.0.1:8787',
    probe: 'http-health',
    healthPaths: ['/health', '/'],
  },
  {
    id: 'pyne-worker',
    name: 'pyne-worker (edge eval)',
    summary: 'HOOX edge Pine evaluator',
    defaultEndpoint: 'https://pyne-worker.cryptolinx.workers.dev',
    probe: 'http-health',
    healthPaths: ['/health', '/'],
  },
  {
    id: 'pyne-agent',
    name: 'PYNE Agent Worker',
    summary: 'Optional NL → Pine assist',
    defaultEndpoint: 'https://pyne-agent-worker.cryptolinx.workers.dev',
    probe: 'http-health',
    healthPaths: ['/health', '/'],
  },
  {
    id: 'pyodide',
    name: 'Pyodide (browser)',
    summary: 'Wasm calculator — skipped in host probe',
    defaultEndpoint: '',
    probe: 'pyodide',
  },
  {
    id: 'service-worker',
    name: 'Service Worker (PWA)',
    summary: 'PWA shell cache — N/A in VS Code host',
    defaultEndpoint: '',
    probe: 'service-worker',
  },
  {
    id: 'hp-ingest',
    name: 'Live ingest (browser)',
    summary: 'Tab-local transport — probe none',
    defaultEndpoint: '',
    probe: 'none',
  },
];

export type WorkerProbeResult = {
  id: WorkerId;
  status: WorkerHealthStatus;
  latencyMs: number | null;
  detail: string;
  endpoint: string;
  checkedAt: number;
  error: string | null;
};

export type WorkersOverviewSnapshot = {
  results: WorkerProbeResult[];
  healthy: number;
  degraded: number;
  down: number;
  unknown: number;
  checkedAt: number;
};

export type ProbeFetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type ProbeWorkerOpts = {
  endpoint?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: ProbeFetchLike;
};

export function listWorkerCatalog(): readonly WorkerCatalogEntry[] {
  return WORKER_CATALOG;
}

export function getWorkerCatalogEntry(
  id: WorkerId,
): WorkerCatalogEntry | undefined {
  return WORKER_CATALOG.find((e) => e.id === id);
}

function probeTimeoutSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const ms =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.max(50, Math.floor(timeoutMs))
      : 6000;
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  }, ms);
  const onParent = () => {
    clearTimeout(timer);
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  };
  if (parent) {
    if (parent.aborted) onParent();
    else parent.addEventListener('abort', onParent, { once: true });
  }
  ctrl.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  return {
    signal: ctrl.signal,
    clear: () => {
      clearTimeout(timer);
      if (parent) parent.removeEventListener('abort', onParent);
    },
  };
}

function skippedResult(
  entry: WorkerCatalogEntry,
  detail: string,
): WorkerProbeResult {
  return {
    id: entry.id,
    status: 'skipped',
    latencyMs: null,
    detail,
    endpoint: entry.defaultEndpoint || '',
    checkedAt: Date.now(),
    error: null,
  };
}

function downResult(
  entry: WorkerCatalogEntry,
  endpoint: string,
  error: string,
  started: number,
): WorkerProbeResult {
  const latency = Math.max(0, Date.now() - started);
  return {
    id: entry.id,
    status: 'down',
    latencyMs: latency,
    detail: error,
    endpoint,
    checkedAt: Date.now(),
    error,
  };
}

/**
 * Probe one catalog worker. Never throws — offline / refused → `down`.
 */
export async function probeWorker(
  id: WorkerId,
  opts?: ProbeWorkerOpts,
): Promise<WorkerProbeResult> {
  const started = Date.now();
  try {
    const entry = getWorkerCatalogEntry(id);
    if (!entry) {
      return {
        id,
        status: 'unknown',
        latencyMs: null,
        detail: `Unknown worker id: ${id}`,
        endpoint: '',
        checkedAt: Date.now(),
        error: `Unknown worker id: ${id}`,
      };
    }

    if (entry.probe === 'none') {
      return skippedResult(entry, 'No probe for this worker');
    }
    if (entry.probe === 'pyodide') {
      return skippedResult(entry, 'Pyodide probe is webview-only');
    }
    if (entry.probe === 'service-worker') {
      return skippedResult(entry, 'Service Worker not used in VS Code host');
    }

    const endpoint = String(opts?.endpoint ?? entry.defaultEndpoint ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (!endpoint) {
      return downResult(entry, '', 'Missing endpoint', started);
    }

    const paths =
      entry.healthPaths && entry.healthPaths.length > 0
        ? entry.healthPaths
        : ['/health'];
    const timeoutMs = opts?.timeoutMs ?? 6000;
    const { signal, clear } = probeTimeoutSignal(timeoutMs, opts?.signal);
    const fetchImpl =
      opts?.fetchImpl ??
      ((globalThis.fetch as ProbeFetchLike | undefined) as ProbeFetchLike);

    try {
      if (typeof fetchImpl !== 'function') {
        return downResult(entry, endpoint, 'fetch unavailable', started);
      }

      let lastError = 'No health response';
      for (const path of paths) {
        const url = `${endpoint}${path.startsWith('/') ? path : `/${path}`}`;
        try {
          const res = await fetchImpl(url, { method: 'GET', signal });
          const latencyMs = Math.max(0, Date.now() - started);
          if (res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
              const text = await res.text();
              if (text && text.length < 200) detail = text.trim() || detail;
            } catch {
              /* body optional */
            }
            return {
              id: entry.id,
              status: 'healthy',
              latencyMs,
              detail,
              endpoint,
              checkedAt: Date.now(),
              error: null,
            };
          }
          lastError = `HTTP ${res.status}`;
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : String(err ?? 'probe failed');
          lastError = msg;
          if (signal.aborted) break;
        }
      }
      return downResult(entry, endpoint, lastError, started);
    } finally {
      clear();
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? 'probe failed');
    const entry = getWorkerCatalogEntry(id);
    return {
      id,
      status: 'down',
      latencyMs: Math.max(0, Date.now() - started),
      detail: msg,
      endpoint: entry?.defaultEndpoint ?? '',
      checkedAt: Date.now(),
      error: msg,
    };
  }
}

/**
 * Probe all catalog workers. Uses allSettled + top-level try/catch so offline
 * / hostile failures never throw to the command host.
 */
export async function probeAllWorkers(opts?: {
  timeoutMs?: number;
  signal?: AbortSignal;
  endpoints?: Partial<Record<WorkerId, string>>;
  fetchImpl?: ProbeFetchLike;
}): Promise<WorkersOverviewSnapshot> {
  const checkedAt = Date.now();
  try {
    const entries = listWorkerCatalog();
    const timeoutMs = opts?.timeoutMs ?? 6000;
    const settled = await Promise.allSettled(
      entries.map((e) =>
        probeWorker(e.id, {
          timeoutMs,
          signal: opts?.signal,
          endpoint: opts?.endpoints?.[e.id],
          fetchImpl: opts?.fetchImpl,
        }),
      ),
    );

    const results: WorkerProbeResult[] = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      const entry = entries[i];
      const msg =
        s.reason instanceof Error
          ? s.reason.message
          : String(s.reason ?? 'probe failed');
      return {
        id: entry ? entry.id : ('pyne-pro' as WorkerId),
        status: 'down' as const,
        latencyMs: null,
        detail: msg,
        endpoint: entry?.defaultEndpoint ?? '',
        checkedAt: Date.now(),
        error: msg,
      };
    });

    return summarizeResults(results, checkedAt);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? 'probeAll failed');
    const results = listWorkerCatalog().map((e) => ({
      id: e.id,
      status: 'down' as const,
      latencyMs: null,
      detail: msg,
      endpoint: e.defaultEndpoint,
      checkedAt: Date.now(),
      error: msg,
    }));
    return summarizeResults(results, checkedAt);
  }
}

function summarizeResults(
  results: WorkerProbeResult[],
  checkedAt: number,
): WorkersOverviewSnapshot {
  const healthy = results.filter((r) => r.status === 'healthy').length;
  const degraded = results.filter((r) => r.status === 'degraded').length;
  const down = results.filter((r) => r.status === 'down').length;
  const unknown = results.filter(
    (r) =>
      r.status === 'unknown' ||
      r.status === 'idle' ||
      r.status === 'skipped',
  ).length;
  return { results, healthy, degraded, down, unknown, checkedAt };
}

export type WorkerTreeNode = {
  id: string;
  label: string;
  collapsible?: boolean;
  description?: string;
  workerId?: WorkerId;
};

/** Last probe snapshot shown in the tree (updated by probeAll command). */
let lastSnapshot: WorkersOverviewSnapshot | null = null;

export function getLastWorkersSnapshot(): WorkersOverviewSnapshot | null {
  return lastSnapshot;
}

/** @internal */
export function _setLastWorkersSnapshotForTests(
  snap: WorkersOverviewSnapshot | null,
): void {
  lastSnapshot = snap;
}

/** Compact probe badge: `ok 12ms` / `down` / status. */
export function formatWorkerProbeDescription(
  result: WorkerProbeResult | undefined,
): string | undefined {
  if (!result) return undefined;
  if (result.status === 'healthy') {
    return result.latencyMs == null ? 'ok' : `ok ${result.latencyMs}ms`;
  }
  if (result.status === 'down') return 'down';
  return result.status;
}

function workerCodicon(entry: WorkerCatalogEntry | undefined): string {
  if (!entry) return 'server-environment';
  return entry.probe === 'http-health' ? 'server-environment' : 'vm';
}

/** Defensive ThemeIcon — Bun vscode mocks may omit the constructor. */
function tryThemeIcon(id: string): vscode.ThemeIcon | undefined {
  try {
    const Ctor = (
      vscode as { ThemeIcon?: new (iconId: string) => vscode.ThemeIcon }
    ).ThemeIcon;
    if (typeof Ctor === 'function') return new Ctor(id);
  } catch {
    /* mock without ThemeIcon */
  }
  return undefined;
}

/** Untrusted markdown tooltip (no theme icons). */
function tryMarkdownTooltip(lines: readonly string[]): vscode.MarkdownString | string {
  const value = lines.filter((line) => line.length > 0).join('\n');
  try {
    const Ctor = (
      vscode as { MarkdownString?: new (value?: string) => vscode.MarkdownString }
    ).MarkdownString;
    if (typeof Ctor === 'function') {
      const md = new Ctor(value);
      try {
        md.supportThemeIcons = false;
      } catch {
        /* mock */
      }
      try {
        md.isTrusted = false;
      } catch {
        /* mock */
      }
      return md;
    }
  } catch {
    /* mock without MarkdownString */
  }
  return value;
}

export function workersRootChildren(
  snap: WorkersOverviewSnapshot | null = lastSnapshot,
): WorkerTreeNode[] {
  return listWorkerCatalog().map((e) => {
    const result = snap?.results.find((r) => r.id === e.id);
    const probe = formatWorkerProbeDescription(result);
    return {
      id: `worker:${e.id}`,
      label: e.name,
      description: probe ?? e.summary,
      workerId: e.id,
    };
  });
}

/** Workers Manager TreeDataProvider (`axis.workers`). */
export class WorkersTreeProvider
  implements vscode.TreeDataProvider<WorkerTreeNode>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<WorkerTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: WorkerTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = element.id;
    item.description = element.description;
    item.contextValue = 'axis.workers.entry';
    const entry = element.workerId
      ? getWorkerCatalogEntry(element.workerId)
      : undefined;
    const icon = tryThemeIcon(workerCodicon(entry));
    if (icon) item.iconPath = icon;
    const result = lastSnapshot?.results.find((r) => r.id === element.workerId);
    const endpoint = result?.endpoint || entry?.defaultEndpoint || '';
    item.tooltip = tryMarkdownTooltip([
      'kind: worker',
      `id: ${element.workerId ?? element.id}`,
      endpoint ? `endpoint: ${endpoint}` : '',
    ]);
    return item;
  }

  getChildren(element?: WorkerTreeNode): WorkerTreeNode[] {
    if (element) return [];
    return workersRootChildren(lastSnapshot);
  }
}

/**
 * Run probeAll, refresh tree, never throw (command host safety).
 * Returns the snapshot or a synthetic all-down snapshot.
 */
export async function runProbeAllCommand(
  provider?: WorkersTreeProvider,
  opts?: {
    timeoutMs?: number;
    fetchImpl?: ProbeFetchLike;
  },
): Promise<WorkersOverviewSnapshot> {
  try {
    const snap = await probeAllWorkers({
      timeoutMs: opts?.timeoutMs ?? 4000,
      fetchImpl: opts?.fetchImpl,
    });
    lastSnapshot = snap;
    provider?.refresh();
    return snap;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? 'probeAll failed');
    const snap = summarizeResults(
      listWorkerCatalog().map((e) => ({
        id: e.id,
        status: 'down' as const,
        latencyMs: null,
        detail: msg,
        endpoint: e.defaultEndpoint,
        checkedAt: Date.now(),
        error: msg,
      })),
      Date.now(),
    );
    lastSnapshot = snap;
    try {
      provider?.refresh();
    } catch {
      /* ignore refresh failures */
    }
    return snap;
  }
}

/** Register Workers TreeView (command registration is owned by index / wiring). */
export function registerWorkersTreeView(
  context: vscode.ExtensionContext,
): WorkersTreeProvider {
  const provider = new WorkersTreeProvider();
  const view = vscode.window.createTreeView(WORKERS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(view);
  return provider;
}
