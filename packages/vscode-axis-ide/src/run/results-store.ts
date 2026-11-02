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
 * In-memory Results focus stub (§7.1) — enough for RunOrchestrator until
 * the Results WebviewView lands (PR-07 / Task 12).
 */

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
  createdAt: number;
}

export class ResultsFocusStore {
  private readonly runResults = new Map<string, RunResultRecord>();
  private newestRunId: string | null = null;
  private lastRunId: string | null = null;
  private resultsFocusId: string | null = null;
  private seq = 0;

  /** Publish a run. `focus:true` updates lastRun + resultsFocusId (§7.1). */
  publish(
    partial: Omit<RunResultRecord, 'id' | 'createdAt' | 'focus'> & { focus: boolean },
  ): string {
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
    if (partial.focus || firstEver) {
      this.lastRunId = id;
      this.resultsFocusId = id;
    }
    return id;
  }

  getNewestRunId(): string | null {
    return this.newestRunId;
  }

  getLastRunId(): string | null {
    return this.lastRunId;
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
    this.resultsFocusId = null;
    this.seq = 0;
  }
}
