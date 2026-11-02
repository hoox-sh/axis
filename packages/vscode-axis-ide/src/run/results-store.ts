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
 * In-memory Results focus store (§7.1).
 *
 * - `focus:true` → write cache + newestRunId; publish lastRun + resultsFocusId
 * - `focus:false` → write cache + newestRunId; do not steal focus if already focused
 * - first run ever (`resultsFocusId == null`) → publish regardless of focus
 * - `focusResults(runId)` retargets focus + lastRun from cache
 */

import type { ResultsSetPayload } from '../protocol';

export interface RunResultRecord {
  id: string;
  status: 'success' | 'error';
  focus: boolean;
  seriesKey: string;
  engineId: string;
  error?: string;
  plots?: unknown;
  series?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /** Optional strategy summary (also readable from meta.strategyReport). */
  strategyReport?: unknown;
  createdAt: number;
}

export type ResultsFocusChangeReason = 'publish' | 'focus' | 'ready';

/** Snapshot posted as `results.set` (plus newestRunId for host/MCP). */
export interface ResultsFocusSnapshot extends ResultsSetPayload {
  newestRunId: string | null;
  /** True when lastRun / resultsFocusId changed for this event. */
  focusChanged: boolean;
}

export type ResultsFocusListener = (
  snapshot: ResultsFocusSnapshot,
  reason: ResultsFocusChangeReason,
) => void;

export type PublishInput = Omit<RunResultRecord, 'id' | 'createdAt' | 'focus'> & {
  focus: boolean;
};

/** Pull strategyReport from the record or its meta bag. */
export function pickStrategyReport(record: RunResultRecord | null | undefined): unknown {
  if (!record) return null;
  if (record.strategyReport !== undefined) return record.strategyReport;
  const meta = record.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    if ('strategyReport' in meta) return meta.strategyReport ?? null;
    if ('strategy' in meta) return meta.strategy ?? null;
  }
  return null;
}

/** Shallow copy so later map mutations cannot rewrite a published lastRun view. */
export function copyRunRecord(record: RunResultRecord): RunResultRecord {
  return {
    ...record,
    series: record.series ? { ...record.series } : record.series,
    meta: record.meta ? { ...record.meta } : record.meta,
  };
}

export class ResultsFocusStore {
  private readonly runResults = new Map<string, RunResultRecord>();
  private newestRunId: string | null = null;
  private lastRunId: string | null = null;
  /** Published lastRun snapshot (separate from cache entry — §7.1 / setLastRun). */
  private lastRun: RunResultRecord | null = null;
  private resultsFocusId: string | null = null;
  private seq = 0;
  private readonly listeners = new Set<ResultsFocusListener>();

  /** Subscribe to focus / publish events. Returns unsubscribe. */
  subscribe(listener: ResultsFocusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Publish a run.
   * `focus:true` or first-ever focus → update lastRun + resultsFocusId and notify.
   * `focus:false` with an existing focus → cache/newest only (no steal).
   */
  publish(partial: PublishInput): string {
    this.seq += 1;
    const id = `run-${this.seq}`;
    const record: RunResultRecord = {
      ...partial,
      id,
      createdAt: Date.now(),
    };
    this.runResults.set(id, record);
    this.newestRunId = id;

    const firstEver = this.resultsFocusId == null;
    const shouldPublish = partial.focus || firstEver;
    if (shouldPublish) {
      this.lastRunId = id;
      this.resultsFocusId = id;
      this.lastRun = copyRunRecord(record);
      this.emit('publish', true);
    }
    // Silent path: cache + newestRunId only — do not rewrite open Results.
    return id;
  }

  /**
   * Retarget Results / Strategy to a cached run id (§7.1 `axis.focusResults`).
   * Updates focus even when the id is not yet cached (later publish fills panel).
   */
  focusResults(runId: string): boolean {
    const key = typeof runId === 'string' ? runId.trim() : '';
    if (!key) return false;
    this.resultsFocusId = key;
    const cached = this.runResults.get(key);
    if (cached) {
      this.lastRunId = key;
      this.lastRun = copyRunRecord(cached);
    } else {
      this.lastRunId = key;
      this.lastRun = null;
    }
    this.emit('focus', true);
    return true;
  }

  /** Current `results.set` payload (+ newestRunId). */
  getSnapshot(focusChanged = false): ResultsFocusSnapshot {
    return {
      lastRun: this.lastRun,
      strategyReport: pickStrategyReport(this.lastRun),
      focusId: this.resultsFocusId,
      newestRunId: this.newestRunId,
      focusChanged,
    };
  }

  /** Host posts this on focus changes and on `results.ready`. */
  getResultsSetPayload(): ResultsSetPayload {
    const snap = this.getSnapshot();
    return {
      lastRun: snap.lastRun,
      strategyReport: snap.strategyReport,
      focusId: snap.focusId,
    };
  }

  /** Notify listeners with the current snapshot (e.g. after `results.ready`). */
  notifyReady(): void {
    this.emit('ready', false);
  }

  getNewestRunId(): string | null {
    return this.newestRunId;
  }

  getLastRunId(): string | null {
    return this.lastRunId;
  }

  getLastRun(): RunResultRecord | null {
    return this.lastRun;
  }

  getResultsFocusId(): string | null {
    return this.resultsFocusId;
  }

  get(id: string): RunResultRecord | undefined {
    return this.runResults.get(id);
  }

  /** Test helper. */
  clear(): void {
    this.runResults.clear();
    this.newestRunId = null;
    this.lastRunId = null;
    this.lastRun = null;
    this.resultsFocusId = null;
    this.seq = 0;
  }

  private emit(reason: ResultsFocusChangeReason, focusChanged: boolean): void {
    const snapshot = this.getSnapshot(focusChanged);
    for (const listener of this.listeners) {
      try {
        listener(snapshot, reason);
      } catch {
        // never break publish/focus on hostile listeners
      }
    }
  }
}
