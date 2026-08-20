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
 * Background refresh jobs for attached on-chain TVL series.
 *
 * Low concurrency (1–2) so DefiLlama is not hammered. Jobs are ephemeral UI
 * state — not persisted.
 *
 * @module onchain/jobs
 */

import { createStore, produce } from 'solid-js/store';
import { normalizeProtocolSlug } from './adapters';
import { kickOnchainHealthProbe } from './health';
import {
  attachDefiLlamaTvl as attachDefiLlamaTvlImpl,
  getOnchainManagerState,
  type OnchainSeriesRow,
} from './manager';

/** Swap attach implementation in tests (avoids ESM live-binding mock issues). */
type AttachTvlFn = typeof attachDefiLlamaTvlImpl;
let attachTvl: AttachTvlFn = attachDefiLlamaTvlImpl;

export type OnchainJobStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface OnchainJob {
  id: string;
  kind: 'refresh_tvl' | 'batch_attach';
  label: string;
  status: OnchainJobStatus;
  /** 0–1 */
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

interface InternalJob extends OnchainJob {
  /** Attachment row id (refresh_tvl). */
  attachmentId?: string;
  protocolId?: string;
  protocolName?: string;
  /** Resolvers for callers awaiting the job. */
  waiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }>;
}

interface JobsState {
  jobs: OnchainJob[];
}

/** Soft concurrency so DefiLlama is not hammered. */
const MAX_CONCURRENT = 2;
/** Cap retained terminal jobs. */
const MAX_RETAINED_JOBS = 20;

const [jobsState, setJobsState] = createStore<JobsState>({ jobs: [] });

/** Reactive Solid store for job list UI. */
export { jobsState as onchainJobsState };

const internals = new Map<string, InternalJob>();
let activeCount = 0;
const waitQueue: string[] = [];

function jobId(): string {
  return `ocj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Unknown error';
}

function isTerminalStatus(status: OnchainJobStatus): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled';
}

function publicJob(j: InternalJob): OnchainJob {
  return {
    id: j.id,
    kind: j.kind,
    label: j.label,
    status: j.status,
    progress: j.progress,
    error: j.error,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

/** Drop oldest terminal jobs beyond {@link MAX_RETAINED_JOBS}. */
function pruneJobList(): void {
  const list = jobsState.jobs;
  if (list.length <= MAX_RETAINED_JOBS) return;
  const terminal = list.filter((j) => isTerminalStatus(j.status));
  const active = list.filter((j) => !isTerminalStatus(j.status));
  const keepTerminal = terminal
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, Math.max(0, MAX_RETAINED_JOBS - active.length));
  const keepIds = new Set([...active, ...keepTerminal].map((j) => j.id));
  for (const j of list) {
    if (!keepIds.has(j.id) && isTerminalStatus(j.status)) {
      internals.delete(j.id);
    }
  }
  setJobsState(
    'jobs',
    list.filter((j) => keepIds.has(j.id)),
  );
}

function syncJob(j: InternalJob): void {
  const pub = publicJob(j);
  setJobsState(
    'jobs',
    produce((list) => {
      const i = list.findIndex((x) => x.id === j.id);
      if (i >= 0) list[i] = pub;
      else list.unshift(pub);
    }),
  );
  if (isTerminalStatus(j.status)) pruneJobList();
}

function setJobFields(
  j: InternalJob,
  patch: Partial<
    Pick<OnchainJob, 'status' | 'progress' | 'error' | 'label'>
  >,
): void {
  if (patch.status !== undefined) j.status = patch.status;
  if (patch.progress !== undefined) j.progress = patch.progress;
  if (patch.error !== undefined) j.error = patch.error;
  if (patch.label !== undefined) j.label = patch.label;
  j.updatedAt = Date.now();
  syncJob(j);
}

function settleJob(j: InternalJob, err?: Error): void {
  const waiters = j.waiters.splice(0, j.waiters.length);
  for (const w of waiters) {
    if (err) w.reject(err);
    else w.resolve();
  }
}

function waitForJob(j: InternalJob): Promise<void> {
  if (isTerminalStatus(j.status)) {
    if (j.status === 'error') {
      return Promise.reject(new Error(j.error || 'Job failed'));
    }
    if (j.status === 'cancelled') {
      return Promise.reject(new Error('Job cancelled'));
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    j.waiters.push({ resolve, reject });
  });
}

/** Display name for re-attach (strip trailing " TVL" from chart label). */
function displayNameFromRow(row: OnchainSeriesRow): string {
  const raw =
    (row.instrument?.symbol && String(row.instrument.symbol).trim()) ||
    (row.label && String(row.label).trim()) ||
    '';
  const stripped = raw.replace(/\s*TVL\s*$/i, '').trim();
  if (stripped) return stripped;
  return (
    normalizeProtocolSlug(row.instrument?.protocolId || row.key || '') ||
    row.id
  );
}

function protocolIdFromRow(row: OnchainSeriesRow): string {
  return normalizeProtocolSlug(
    row.instrument?.protocolId || row.key || '',
  );
}

function enqueueInternal(j: InternalJob): void {
  internals.set(j.id, j);
  syncJob(j);
  waitQueue.push(j.id);
  pumpQueue();
}

function pumpQueue(): void {
  while (activeCount < MAX_CONCURRENT && waitQueue.length) {
    const id = waitQueue.shift()!;
    const j = internals.get(id);
    if (!j) continue;
    if (isTerminalStatus(j.status)) continue;
    activeCount += 1;
    void runJob(j).finally(() => {
      activeCount = Math.max(0, activeCount - 1);
      pumpQueue();
    });
  }
}

async function runJob(j: InternalJob): Promise<void> {
  if (j.status === 'cancelled') {
    settleJob(j, new Error('Job cancelled'));
    return;
  }

  setJobFields(j, { status: 'running', progress: 0, error: null });

  try {
    if (j.kind === 'refresh_tvl') {
      await runRefreshTvl(j);
    } else if (j.kind === 'batch_attach') {
      await runBatchRefresh(j);
    } else {
      throw new Error(`Unknown on-chain job kind: ${(j as OnchainJob).kind}`);
    }

    if ((j.status as OnchainJobStatus) === 'cancelled') {
      settleJob(j, new Error('Job cancelled'));
      return;
    }

    setJobFields(j, { status: 'complete', progress: 1, error: null });
    settleJob(j);
  } catch (err) {
    if ((j.status as OnchainJobStatus) === 'cancelled') {
      settleJob(j, new Error('Job cancelled'));
      return;
    }
    const msg = errMessage(err);
    setJobFields(j, { status: 'error', error: msg });
    settleJob(j, err instanceof Error ? err : new Error(msg));
  }
}

async function runRefreshTvl(j: InternalJob): Promise<void> {
  const protocolId = j.protocolId || '';
  if (!protocolId) {
    throw new Error('Protocol id is required for TVL refresh');
  }
  if ((j.status as OnchainJobStatus) === 'cancelled') return;

  setJobFields(j, { progress: 0.15 });
  await attachTvl(protocolId, j.protocolName);

  if ((j.status as OnchainJobStatus) === 'cancelled') return;
  setJobFields(j, { progress: 1 });
}

/**
 * Refresh every attached series under one batch job (progress = done/total).
 * Used when a `batch_attach` job is enqueued (e.g. future multi-attach UI).
 */
async function runBatchRefresh(j: InternalJob): Promise<void> {
  const rows = getOnchainManagerState().attachments.slice();
  if (!rows.length) {
    setJobFields(j, { progress: 1 });
    return;
  }

  let done = 0;
  const total = rows.length;
  const errors: string[] = [];

  for (const row of rows) {
    if (j.status === 'cancelled') return;

    const protocolId = protocolIdFromRow(row);
    if (!protocolId) {
      done += 1;
      setJobFields(j, { progress: done / total });
      continue;
    }

    try {
      await attachTvl(protocolId, displayNameFromRow(row));
    } catch (err) {
      if ((j.status as OnchainJobStatus) === 'cancelled') return;
      errors.push(`${protocolId}: ${errMessage(err)}`);
    }

    done += 1;
    setJobFields(j, { progress: done / total });
  }

  if (j.status === 'cancelled') return;

  if (errors.length === total) {
    throw new Error(errors[0] || 'All TVL refreshes failed');
  }
  if (errors.length) {
    // Partial success — surface a note; status still completes unless all failed.
    j.error = `${errors.length}/${total} failed: ${errors[0]}`;
    j.updatedAt = Date.now();
    syncJob(j);
  }
}

function createRefreshTvlJob(row: OnchainSeriesRow): InternalJob {
  const protocolId = protocolIdFromRow(row);
  const name = displayNameFromRow(row);
  const now = Date.now();
  return {
    id: jobId(),
    kind: 'refresh_tvl',
    label: `Refresh ${row.label || name || protocolId || row.id}`,
    status: 'pending',
    progress: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    attachmentId: row.id,
    protocolId,
    protocolName: name,
    waiters: [],
  };
}

/** Snapshot of current jobs (reactive store reference). */
export function listOnchainJobs(): OnchainJob[] {
  return jobsState.jobs;
}

/**
 * Re-fetch DefiLlama TVL for one attached series (same protocol + metric).
 * Queues a `refresh_tvl` job and resolves when it finishes.
 */
export async function refreshAttachment(id: string): Promise<void> {
  kickOnchainHealthProbe();
  const sid = String(id || '');
  const row = getOnchainManagerState().attachments.find((a) => a.id === sid);
  if (!row) {
    throw new Error(`On-chain attachment not found: ${sid || '(empty)'}`);
  }

  const protocolId = protocolIdFromRow(row);
  if (!protocolId) {
    throw new Error(`Attachment "${sid}" has no protocol id`);
  }

  const j = createRefreshTvlJob(row);
  j.protocolId = protocolId;
  enqueueInternal(j);
  await waitForJob(j);
}

/**
 * Queue a `refresh_tvl` job for every currently attached series and wait
 * until all settle. Concurrency is capped at {@link MAX_CONCURRENT}.
 *
 * Individual child failures reject the corresponding job; this helper
 * resolves when the queue drains and throws only if **every** refresh failed
 * (partial success is allowed).
 */
export async function refreshAllAttachedTvl(): Promise<void> {
  kickOnchainHealthProbe();
  const rows = getOnchainManagerState().attachments.slice();
  if (!rows.length) return;

  const jobs: InternalJob[] = [];
  for (const row of rows) {
    const protocolId = protocolIdFromRow(row);
    if (!protocolId) continue;
    const j = createRefreshTvlJob(row);
    j.protocolId = protocolId;
    enqueueInternal(j);
    jobs.push(j);
  }

  if (!jobs.length) return;

  const results = await Promise.allSettled(jobs.map((j) => waitForJob(j)));
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length === results.length) {
    const first = failures[0] as PromiseRejectedResult;
    const msg = errMessage(first.reason);
    throw new Error(msg || 'All TVL refreshes failed');
  }
}

/** Cancel a pending/running job. In-flight network may finish; status becomes cancelled. */
export function cancelOnchainJob(id: string): void {
  const jid = String(id || '');
  const j = internals.get(jid);
  if (!j) return;
  if (isTerminalStatus(j.status)) return;

  const qi = waitQueue.indexOf(jid);
  if (qi >= 0) waitQueue.splice(qi, 1);

  setJobFields(j, { status: 'cancelled', error: null });
  settleJob(j, new Error('Job cancelled'));
}

/** Drop a job from the list (cancels if still active). */
export function dismissOnchainJob(id: string): void {
  const jid = String(id || '');
  const j = internals.get(jid);
  if (j && !isTerminalStatus(j.status)) {
    cancelOnchainJob(jid);
  }
  internals.delete(jid);
  setJobsState(
    'jobs',
    produce((list) => {
      const i = list.findIndex((x) => x.id === jid);
      if (i >= 0) list.splice(i, 1);
    }),
  );
}

/** @internal test helper */
export function _resetOnchainJobsForTests(): void {
  for (const j of internals.values()) {
    j.status = 'cancelled';
    settleJob(j, new Error('Job cancelled'));
  }
  internals.clear();
  waitQueue.length = 0;
  activeCount = 0;
  attachTvl = attachDefiLlamaTvlImpl;
  setJobsState('jobs', []);
}

/** @internal test helper — inject attach implementation (null restores default). */
export function _setAttachTvlForTests(fn: AttachTvlFn | null): void {
  attachTvl = fn || attachDefiLlamaTvlImpl;
}
