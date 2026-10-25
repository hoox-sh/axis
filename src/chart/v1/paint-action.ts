/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live paint action (concept §5.2 / §11).
 *
 * Maps a store append verdict plus the window length to the Lightweight
 * Charts write. `series.update` is the hot path. `setData` is the first bar
 * (`update` throws on an empty series), a window slide, and snapshot/resync
 * outside this helper. Pan/zoom never writes.
 *
 * | Situation | API |
 * | --- | --- |
 * | `ignored` | none |
 * | `updated` (forming tick, same bar) | update |
 * | `appended` and length === 1 (empty series) | setData |
 * | `appended` otherwise (window not full) | update |
 * | `slid` (cap reached) | setData |
 *
 * @module chart/v1/paint-action
 */

import type { BarAppendResult } from '../../store';

export type PaintAction = 'none' | 'update' | 'setData';

/** Chart write for one live-append verdict. Snapshot/resync is not a verdict. */
export function paintAction(verdict: BarAppendResult, windowLength: number): PaintAction {
  if (verdict === 'ignored') return 'none';
  if (verdict === 'updated') return 'update';
  if (verdict === 'slid') return 'setData';
  // `appended`: the first bar has no last point for `update` to attach to.
  if (verdict === 'appended') return windowLength <= 1 ? 'setData' : 'update';
  return 'none';
}
