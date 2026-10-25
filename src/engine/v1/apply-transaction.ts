/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * One batch, one commit (concept §6.1).
 *
 * Steps run synchronously. `commit` runs only after seq, generation, and
 * the structural checks pass, and only if every step returned. A throw
 * skips the rest of the steps and skips `commit`.
 *
 * @module engine/v1/apply-transaction
 */

import { classifySeqGap } from '../frames';

export type ApplyAbortReason =
  | 'gap'
  | 'rewind'
  | 'generation'
  | 'pane-skew'
  | 'plot-length'
  | 'aborted';

export type ApplyResult =
  | { ok: true; action: 'commit' | 'replay' }
  | { ok: false; reason: ApplyAbortReason };

/** Structural checks. Omitted fields are not tested. */
export type ApplyCheck = {
  /** Last bar time of the price series. */
  priceTime?: number;
  /** Last bar time of each other pane. Must equal `priceTime` when both are set. */
  paneTimes?: readonly number[];
  /** Full axis. Compared to `plotLengths` only when both are present. */
  barTimes?: readonly number[];
  plotLengths?: readonly number[];
};

export type ApplyTransaction = {
  /** Incoming seq. `null` skips the seq gate (frames that do not carry one). */
  seq?: number | null;
  /** Last seq this subscription painted. */
  lastSeq: number;
  /** Snapshot token captured when the batch started. */
  generation?: number;
  /** Token the wire believes is current. Mismatch aborts before commit. */
  currentGeneration?: number;
  check?: ApplyCheck;
  /** Pure work before the paint. A throw aborts the batch. */
  steps?: ReadonlyArray<() => void>;
  /** The single paint. Not called on abort. */
  commit: () => void;
  onStale?: (reason: ApplyAbortReason) => void;
};

function structuralReason(check: ApplyCheck | undefined): ApplyAbortReason | null {
  if (!check) return null;
  if (check.priceTime != null && check.paneTimes) {
    for (const time of check.paneTimes) {
      if (time !== check.priceTime) return 'pane-skew';
    }
  }
  if (check.barTimes && check.plotLengths) {
    const n = check.barTimes.length;
    for (const len of check.plotLengths) {
      if (len !== n) return 'plot-length';
    }
  }
  return null;
}

/**
 * Validate, run steps, commit once.
 * A duplicate seq is a replay: `commit` still runs so the caller can refresh
 * status, and the result says `replay` so it can skip a second paint.
 */
export function runApplyTransaction(input: ApplyTransaction): ApplyResult {
  const stale = (reason: ApplyAbortReason): ApplyResult => {
    try {
      input.onStale?.(reason);
    } catch {
      /* stale reporting must not mask the abort */
    }
    return { ok: false, reason };
  };

  if (
    input.generation != null &&
    input.currentGeneration != null &&
    input.generation !== input.currentGeneration
  ) {
    return stale('generation');
  }

  let action: 'commit' | 'replay' = 'commit';
  if (typeof input.seq === 'number' && Number.isFinite(input.seq)) {
    const gap = classifySeqGap(input.lastSeq, input.seq);
    if (gap.kind === 'gap') return stale('gap');
    if (gap.kind === 'rewind') return stale('rewind');
    if (gap.kind === 'duplicate') action = 'replay';
  }

  const shape = structuralReason(input.check);
  if (shape) return stale(shape);

  try {
    for (const step of input.steps ?? []) step();
  } catch {
    return stale('aborted');
  }

  if (
    input.generation != null &&
    input.currentGeneration != null &&
    input.generation !== input.currentGeneration
  ) {
    return stale('generation');
  }

  try {
    input.commit();
  } catch {
    return stale('aborted');
  }
  return { ok: true, action };
}
