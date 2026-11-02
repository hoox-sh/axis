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
 * MVP seq-gap resume stub — log, mark degraded, optionally remint/reconnect.
 * Full snapshot repair lands with later live polish; this unblocks Task 16.
 */

import { scrubSecrets } from '../run/scrub';
import type { LiveOutput } from './bridge';

export type LiveResumeReason =
  | 'seq-gap'
  | 'request-reload'
  | 'unsafe-delta'
  | 'close-gap'
  | string;

export type LiveResumeResult = {
  ok: true;
  reminted: boolean;
  reason: string;
};

export type LiveResumeStubDeps = {
  output?: LiveOutput;
  /** Mark HUD degraded (bridge.markDegraded). */
  markDegraded?: (reason: string) => void;
  /**
   * Optional remint/reconnect — typically `() => bridge.start()`.
   * Failures are logged; stub still returns ok with reminted=false.
   */
  remint?: () => void | Promise<unknown>;
  /** When false, skip remint (log + degrade only). Default true when remint set. */
  remintOnResume?: boolean;
};

export type LiveResumeStub = {
  /** Trigger resume for a gap / chart.requestReload. Never throws. */
  resume(reason: LiveResumeReason, detail?: string): Promise<LiveResumeResult>;
  /** True while a remint is in flight (dedupe overlapping resumes). */
  isResuming(): boolean;
};

/**
 * Create the MVP resume stub used by live chart fan-out and webview reload.
 */
export function createLiveResumeStub(deps: LiveResumeStubDeps = {}): LiveResumeStub {
  let inflight: Promise<LiveResumeResult> | null = null;

  function log(line: string): void {
    try {
      deps.output?.appendLine(scrubSecrets(line));
    } catch {
      // ignore
    }
  }

  async function runResume(reason: LiveResumeReason, detail?: string): Promise<LiveResumeResult> {
    const why = scrubSecrets(String(reason || 'seq-gap'));
    const extra = detail ? ` ${scrubSecrets(detail)}` : '';
    log(`live resume stub: ${why}${extra}`);
    try {
      deps.markDegraded?.(why);
    } catch {
      // degrade must not throw out of stub
    }

    const shouldRemint = deps.remintOnResume !== false && typeof deps.remint === 'function';
    if (!shouldRemint) {
      return { ok: true, reminted: false, reason: why };
    }

    try {
      await deps.remint!();
      log(`live resume stub: remint ok (${why})`);
      return { ok: true, reminted: true, reason: why };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`live resume stub: remint failed: ${scrubSecrets(message)}`);
      return { ok: true, reminted: false, reason: why };
    }
  }

  return {
    isResuming() {
      return inflight != null;
    },
    async resume(reason, detail) {
      if (inflight) return inflight;
      const pending = runResume(reason, detail);
      inflight = pending;
      try {
        return await pending;
      } finally {
        if (inflight === pending) inflight = null;
      }
    },
  };
}
