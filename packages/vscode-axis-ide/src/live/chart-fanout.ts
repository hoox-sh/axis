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
 * Live onFrame → chart-bus fan-out (`chart.full` / `chart.delta`) + seq-gap resume.
 * Wire as `LiveSessionBridge` `onFrame` / handle webview `chart.requestReload`.
 */

import { notifyChart, type ChartNotifyMessage } from '../run/chart-bus';
import type { LiveFrameHandler, LiveOutput } from './bridge';
import {
  normalizeLiveFrame,
  toChartDeltaPayload,
  toChartFullPayload,
} from './frames';
import { createLiveResumeStub, type LiveResumeStub, type LiveResumeStubDeps } from './resume';

export type LiveChartNotify = (message: ChartNotifyMessage) => void;

export type LiveChartFanoutDeps = {
  /** Canonical series key for chart-bus filtering. */
  seriesKey: string;
  /** Override notify (defaults to chart-bus `notifyChart`). */
  notify?: LiveChartNotify;
  output?: LiveOutput;
  /** Injected resume stub; created from resumeDeps when omitted. */
  resume?: LiveResumeStub;
  resumeDeps?: LiveResumeStubDeps;
  /**
   * When true (default), frames whose extracted seriesKey differs from
   * `seriesKey` are ignored. Status frames always pass.
   */
  filterSeriesKey?: boolean;
};

export type LiveChartFanout = {
  /** Pass to `LiveSessionBridge` `onFrame`. */
  onFrame: LiveFrameHandler;
  /** Host handler for webview `chart.requestReload`. */
  handleRequestReload: () => void;
  /** Last applied seq (0 before first full). */
  lastSeq: () => number;
  /** Last known bar count (for close→delta baseIndex). */
  barCount: () => number;
  /** Reset seq/bar cursors (after remint / new snapshot). */
  reset: () => void;
  resume: LiveResumeStub;
};

function classifyHostSeq(
  lastSeq: number,
  seq: number,
): 'continuous' | 'duplicate' | 'gap' | 'snapshot' {
  if (!(typeof seq === 'number' && Number.isFinite(seq))) return 'gap';
  if (lastSeq <= 0) return 'snapshot';
  if (seq === lastSeq + 1) return 'continuous';
  if (seq === lastSeq) return 'duplicate';
  // Full may restart or jump forward after resume — treat as snapshot accept.
  return 'gap';
}

/**
 * Build the live→chart fan-out used as bridge `onFrame`.
 */
export function createLiveChartFanout(deps: LiveChartFanoutDeps): LiveChartFanout {
  const notify = deps.notify ?? notifyChart;
  const resume =
    deps.resume ??
    createLiveResumeStub({
      output: deps.output,
      ...deps.resumeDeps,
    });
  const filter = deps.filterSeriesKey !== false;
  let lastSeq = 0;
  let barCount = 0;

  function resolveKey(frameKey: string | undefined): string | null {
    const configured = String(deps.seriesKey ?? '');
    if (!configured) return null;
    if (!frameKey) return configured;
    if (!filter) return frameKey;
    return frameKey === configured ? configured : null;
  }

  function onFrame(raw: unknown): void {
    const frame = normalizeLiveFrame(raw);
    if (frame.kind === 'unknown' || frame.kind === 'status') return;

    const key = resolveKey(frame.seriesKey);
    if (!key) return;

    if (frame.kind === 'full') {
      const seqKind = classifyHostSeq(lastSeq, frame.seq);
      // Accept first snapshot, continuous, or any full after gap (repair paint).
      if (seqKind === 'duplicate') return;
      if (seqKind === 'gap' && lastSeq > 0 && frame.seq < lastSeq) {
        // Stale snapshot behind applied cursor — drop.
        return;
      }
      lastSeq = frame.seq;
      const bars = Array.isArray(frame.bars) ? frame.bars : [];
      barCount = bars.length;
      try {
        notify({
          type: 'chart.full',
          payload: toChartFullPayload(frame),
          seriesKey: key,
        });
      } catch {
        // notify must not tear down the socket
      }
      return;
    }

    if (frame.kind === 'delta') {
      const seqKind = classifyHostSeq(lastSeq, frame.seq);
      if (seqKind === 'duplicate') return;
      if (seqKind === 'gap' || seqKind === 'snapshot') {
        void resume.resume(
          'seq-gap',
          `delta seq=${frame.seq} lastSeq=${lastSeq} series=${key}`,
        );
        return;
      }
      if (frame.baseIndex < 0 || frame.baseIndex > barCount) {
        void resume.resume(
          'unsafe-delta',
          `baseIndex=${frame.baseIndex} barCount=${barCount}`,
        );
        return;
      }
      lastSeq = frame.seq;
      const tail = Array.isArray(frame.tail) ? frame.tail : [];
      barCount = frame.baseIndex + tail.length;
      try {
        notify({
          type: 'chart.delta',
          payload: toChartDeltaPayload(frame),
          seriesKey: key,
        });
      } catch {
        // ignore
      }
      return;
    }

    if (frame.kind === 'close') {
      if (!frame.bar) return;
      if (lastSeq <= 0) {
        void resume.resume('close-gap', 'close before full');
        return;
      }
      const nextSeq = frame.seq != null && frame.seq === lastSeq + 1 ? frame.seq : lastSeq + 1;
      if (frame.seq != null && frame.seq !== lastSeq && frame.seq !== lastSeq + 1) {
        void resume.resume(
          'seq-gap',
          `close seq=${frame.seq} lastSeq=${lastSeq}`,
        );
        return;
      }
      const baseIndex = Math.max(0, barCount - 1);
      lastSeq = nextSeq;
      barCount = baseIndex + 1;
      try {
        notify({
          type: 'chart.delta',
          payload: {
            baseIndex,
            tail: [frame.bar],
            seq: nextSeq,
          },
          seriesKey: key,
        });
      } catch {
        // ignore
      }
    }
  }

  return {
    onFrame,
    handleRequestReload() {
      void resume.resume('request-reload', `series=${deps.seriesKey}`);
    },
    lastSeq: () => lastSeq,
    barCount: () => barCount,
    reset() {
      lastSeq = 0;
      barCount = 0;
    },
    resume,
  };
}
