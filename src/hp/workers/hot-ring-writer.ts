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
 * Hot-ring routing for the ingest worker (HP-2 wiring, §3 ownership).
 *
 * The ingest worker is the **single writer** of the hot SAB ring. This
 * module decides which decoded frames feed the ring and which still need
 * their bar payload on the main thread:
 *
 * - the **first series subscription** that delivers a snapshot binds the
 *   ring; a snapshot for another id rebinds it (§11.6 epoch bump — a
 *   symbol switch never reuses ticks from the previous series),
 * - a bound series `full` seeds the ring with its tail and **keeps** its
 *   payload (main paints the snapshot window through `onSeriesFull`),
 * - a bound series `delta` with bars is written into the ring and
 *   **stripped** from the posted frame: `seq`, `closed_upto` and the
 *   positional block still cross `postMessage`, but main samples the bars
 *   through the rAF copy-out (`startHotRingPaint`) instead of paying a
 *   structured clone per tick,
 * - script deltas (`plots` / `series` columns), other series
 *   subscriptions, and any frame the ring cannot absorb pass through
 *   untouched — the frame path is always a correct fallback.
 *
 * Stale bars (older than the ring tail) never touch the ring: a delta of
 * only stale bars stays on the frame path untouched (the store's
 * `appendBar` verdicts would `ignore` them anyway, and a genuine repair of
 * older history arrives as a re-baselined `full`).
 *
 * @module hp/workers/hot-ring-writer
 */

import type { Redesign2Frame } from '../../engine/frames';
import { sanitizeStreamBar } from '../../data/parse-bars';
import type { Bar } from '../../store/types';
import {
  BAR_FLAG_FORMING,
  barToTicks,
  type HotBuffer,
  type HotBarTicks,
} from '../memory/hot-buffer';

/** Meta carried from the frame that produced a ring write. */
type RingMeta = { seq?: number; closedUpto?: number; priceScale?: number };

export class HotRingWriter {
  readonly buffer: HotBuffer;
  /** Series subscription the ring serves (`null` until a snapshot binds it). */
  private boundId: string | null = null;
  /** Absolute bar count of the series (newest absolute index is `seriesLen - 1`). */
  private seriesLen = 0;
  /** Absolute index of ring slot 0. The ring holds `[hotFrom, seriesLen)`. */
  private hotFrom = 0;
  private hotCount = 0;
  private lastTime = 0;
  /** Window mirror (oldest → newest): slot indices are window-relative, so a
   * sliding append rewrites the retained bars at their shifted indices. */
  private mirror: HotBarTicks[] = [];

  constructor(buffer: HotBuffer) {
    this.buffer = buffer;
  }

  get boundSeries(): string | null {
    return this.boundId;
  }

  /**
   * Route one decoded frame: absorb bar payloads into the ring and return
   * the frame that should still be posted to the host (the original, or a
   * copy with `payload.bars` stripped).
   *
   * `priceScale` comes from the AXB1 cursor (the wire carries ticks, not
   * floats); JSON frames leave it `undefined` and keep the ring's scale.
   */
  absorb(frame: Redesign2Frame, priceScale?: number): Redesign2Frame {
    if (frame.type === 'full' && frame.id) {
      const raw = frame.payload?.bars;
      if (Array.isArray(raw)) {
        const bars = sanitizeBars(raw, undefined);
        if (bars.length) {
          this.seed(frame.id, bars, {
            seq: frame.seq,
            closedUpto: frame.payload.closed_upto,
            priceScale,
          });
        }
      }
      return frame; // snapshots always keep their payload (initial paint)
    }
    if (frame.type === 'delta' && frame.id && frame.id === this.boundId) {
      const raw = frame.payload?.bars;
      if (Array.isArray(raw) && raw.length) {
        const forming = frame.payload.forming === true;
        const bars = sanitizeBars(raw, !forming);
        if (bars.length) {
          const touched = this.applyDelta(
            bars,
            {
              seq: frame.seq,
              closedUpto: frame.payload.closed_upto,
              priceScale,
            },
            forming,
          );
          if (touched) {
            const { bars: _drop, ...rest } = frame.payload;
            return { ...frame, payload: rest } as Redesign2Frame;
          }
        }
      }
    }
    return frame;
  }

  /** Seed (or re-seed) the ring from a series snapshot tail. */
  private seed(id: string, bars: Bar[], meta: RingMeta): void {
    if (id !== this.boundId) {
      this.buffer.bumpEpoch();
      this.boundId = id;
    }
    if (meta.priceScale !== undefined && meta.priceScale !== this.buffer.priceScale) {
      this.buffer.priceScale = meta.priceScale;
    }
    // Any (re-)seed can move the window's absolute base (a snapshot with a
    // different depth shifts `hotFrom`), so a cold page from the previous
    // window must not linger — the pager re-requests it on the next frame.
    this.buffer.clearPage();
    const cap = this.buffer.layout.cap;
    const total = bars.length;
    const n = Math.min(total, cap);
    const start = total - n;
    const scale = this.buffer.priceScale;
    const ticks: HotBarTicks[] = [];
    for (let i = 0; i < n; i++) {
      const bar = bars[start + i];
      if (bar) ticks.push(barToTicks(bar, scale));
    }
    this.mirror = ticks;
    this.hotFrom = start;
    this.hotCount = n;
    this.seriesLen = total;
    this.lastTime = n > 0 && bars[total - 1] ? (bars[total - 1].time as number) : 0;
    this.buffer.publish(ticks, {
      hotFromIndex: start,
      ...(meta.seq !== undefined ? { seq: meta.seq } : {}),
      ...(meta.closedUpto !== undefined ? { closedUpto: meta.closedUpto } : {}),
    });
    this.publishTipIfForming(meta.seq);
  }

  /**
   * Append / update the ring from one delta's bars (oldest → newest).
   *
   * One generation flip per frame, but **not** one full rewrite (HP-P01):
   *
   * - a forming tip overwrites the newest entry in place and is published as
   *   a single 64-byte tip record (no hot flip at all),
   * - an append below capacity copies the published prefix and writes only
   *   the new bars (`publishTail`),
   * - an append into a **full** window slides it one step and republishes the
   *   whole window (the one unavoidable full rewrite per closed candle).
   *
   * Returns true when anything applied.
   */
  private applyDelta(bars: Bar[], meta: RingMeta, forming: boolean): boolean {
    if (!this.boundId || this.seriesLen === 0) return false;

    // Pre-check: the generation only moves when at least one bar applies,
    // so a delta of stale bars never opens a write readers would wait on.
    let applies = false;
    for (const bar of bars) {
      if (bar.time >= this.lastTime) {
        applies = true;
        break;
      }
    }
    if (!applies) return false;

    const cap = this.buffer.layout.cap;
    const scale = meta.priceScale ?? this.buffer.priceScale;
    if (scale !== this.buffer.priceScale) this.buffer.priceScale = scale;
    let appended = false;
    let slid = false;
    let firstDirty = this.mirror.length;
    for (const bar of bars) {
      const ticks = barToTicks(bar, scale);
      if (bar.time === this.lastTime) {
        // Same bucket: overwrite the newest window entry in place.
        const last = this.mirror.length - 1;
        if (last >= 0) {
          this.mirror[last] = ticks;
          if (last < firstDirty) firstDirty = last;
        }
        continue;
      }
      if (bar.time > this.lastTime) {
        appended = true;
        if (this.hotCount < cap) {
          firstDirty = Math.min(firstDirty, this.mirror.length);
          this.mirror.push(ticks);
          this.hotCount += 1;
        } else {
          // Full window: slide one step — every retained bar shifts one index.
          this.mirror.copyWithin(0, 1);
          this.mirror[cap - 1] = ticks;
          this.hotFrom = this.seriesLen - (cap - 1);
          slid = true;
          firstDirty = 0;
        }
        this.seriesLen += 1;
        this.lastTime = bar.time;
      }
      // Stale (older than the tail): skipped — the store would `ignore`
      // it, and older-history repair is a `full` re-seed.
    }

    // The common tick path: only the forming bar moved. The published hot
    // window is still correct, so publish just the tip record.
    if (forming && !appended) {
      this.publishTipIfForming(meta.seq);
      return true;
    }

    if (slid) {
      this.buffer.publish(this.mirror, {
        hotFromIndex: this.hotFrom,
        ...(meta.seq !== undefined ? { seq: meta.seq } : {}),
        ...(meta.closedUpto !== undefined ? { closedUpto: meta.closedUpto } : {}),
      });
    } else {
      this.buffer.publishTail(
        this.mirror,
        {
          hotFromIndex: this.hotFrom,
          ...(meta.seq !== undefined ? { seq: meta.seq } : {}),
          ...(meta.closedUpto !== undefined ? { closedUpto: meta.closedUpto } : {}),
        },
        firstDirty,
      );
    }
    this.publishTipIfForming(meta.seq);
    return true;
  }

  /** Publish the newest bar as the tip when it is still forming, else retire. */
  private publishTipIfForming(seq?: number): void {
    const newest = this.mirror[this.mirror.length - 1];
    if (newest && (newest.flags & BAR_FLAG_FORMING) !== 0) {
      this.buffer.writeTip(newest, this.hotFrom + this.hotCount - 1, seq ?? 0);
    } else {
      this.buffer.clearTip();
    }
  }
}

function sanitizeBars(
  raw: ReadonlyArray<Record<string, unknown> | unknown>,
  closed: boolean | undefined,
): Bar[] {
  const out: Bar[] = [];
  for (const row of raw) {
    const bar = sanitizeStreamBar(row, closed);
    if (bar) out.push(bar);
  }
  return out;
}

/** Map decoded frames through the ring; returned frames are the ones to post. */
export function routeThroughRing(
  frames: Redesign2Frame[],
  ring: HotRingWriter,
  priceScaleFor?: (id: string) => number | undefined,
): Redesign2Frame[] {
  const out: Redesign2Frame[] = [];
  for (const frame of frames) {
    out.push(ring.absorb(frame, frame.id ? priceScaleFor?.(frame.id) : undefined));
  }
  return out;
}
