// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client apply state for Redesign2.
 *
 * Tracks whether a useful session has applied its full result so that later
 * deltas can be applied incrementally.
 *
 * @module engine/client-apply
 */

import { resolveSessionPayload } from '../engines/session-delta';
import { classifySeqGap } from './frames';

export type ApplyState = 'idle' | 'requesting' | 'full-applied' | 'delta-only';

export class Redesign2ApplyStateManager {
  private state: ApplyState = 'idle';
  private fullAppliedCount = 0;

  get currentState(): ApplyState {
    return this.state;
  }

  requestFull(): void {
    this.state = 'requesting';
  }

  markFullApplied(): void {
    this.state = 'full-applied';
    this.fullAppliedCount += 1;
  }

  markDeltaApplied(): void {
    if (this.state !== 'full-applied' && this.state !== 'delta-only') {
      throw new Error('delta applied before full result');
    }
    this.state = 'delta-only';
  }

  shouldApplyFull(): boolean {
    return this.fullAppliedCount === 0;
  }

  reset(): void {
    this.state = 'idle';
    this.fullAppliedCount = 0;
  }
}

export interface DeltaApplierFull {
  plots?: Record<string, unknown[]>;
  series?: Record<string, unknown[]>;
  count: number;
  [key: string]: unknown;
}

export interface DeltaApplierDelta {
  seq: number;
  base_index: number;
  count: number;
  tail_len: number;
  plots?: Record<string, unknown[]>;
  series?: Record<string, unknown[]>;
  unchanged?: boolean;
  [key: string]: unknown;
}

export type DeltaApplyOutcome =
  | { ok: true; full: Record<string, unknown>; replayed: boolean }
  | { ok: false; reason: 'needs-full' | 'delta-before-full' };

/**
 * Per-subscription delta applier (F-06).
 *
 * Holds the cached full payload and merges `delta` frames through
 * `resolveSessionPayload` — the same positional splice the session clients
 * use (`cached[:base_index] + tail`, exact-length enforced). `seq` gaps and
 * unmergeable deltas report `needs-full` so the caller re-requests a full
 * snapshot instead of applying partial data; duplicate `seq` replays the
 * cache without touching state.
 */
export class Redesign2DeltaApplier {
  private readonly states = new Redesign2ApplyStateManager();
  private cache: Record<string, unknown> | null = null;
  private lastSeq = 0;

  applyFull(full: DeltaApplierFull & { seq?: number }): Record<string, unknown> {
    this.states.requestFull();
    const stored = { ...full };
    this.cache = stored;
    if (typeof full.seq === 'number') this.lastSeq = full.seq;
    this.states.markFullApplied();
    return stored;
  }

  applyDelta(delta: DeltaApplierDelta): DeltaApplyOutcome {
    if (!this.cache) return { ok: false, reason: 'delta-before-full' };
    const gap = classifySeqGap(this.lastSeq, delta.seq);
    if (gap.kind === 'duplicate') {
      return { ok: true, full: { ...this.cache }, replayed: true };
    }
    if (gap.kind !== 'continuous') return { ok: false, reason: 'needs-full' };
    const { seq: _seq, base_index, count, tail_len, ...rest } = delta;
    void _seq;
    const update = {
      ...rest,
      count,
      delta: { base_index, count, tail_len },
    };
    const merged = resolveSessionPayload(this.cache, update);
    if (!merged) return { ok: false, reason: 'needs-full' };
    this.cache = merged;
    this.lastSeq = delta.seq;
    this.states.markDeltaApplied();
    return { ok: true, full: { ...merged }, replayed: false };
  }

  get cached(): Record<string, unknown> | null {
    return this.cache ? { ...this.cache } : null;
  }

  get state(): ApplyState {
    return this.states.currentState;
  }

  reset(): void {
    this.states.reset();
    this.cache = null;
    this.lastSeq = 0;
  }
}