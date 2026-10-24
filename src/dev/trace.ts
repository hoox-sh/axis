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
 * Development-mode HP + chart tracer.
 *
 * Writes a JSONL ring buffer to a blob URL so the agent / operator can
 * download it via the `dev.trace` MCP capability.  The tracer is opt‑in only
 * — it never runs when the kill switch is on or HP is disabled, and it stops
 * writing once the buffer wraps.  All state is tab-local; no secrets leave
 * the tab.
 *
 * @module dev/trace
 */

import {
  hpGpuMode,
  hpSabMode,
  isHpDisabled,
  isHpEnabled,
  HpGpuMode,
  HpSabMode,
} from '../hp/feature-flag';
import { hpChip } from '../hp/hud';

/** Maximum entries before the ring wraps (keeps the file bounded). */
const MAX_ENTRIES = 500;

/** One log line written every time `pushEntry()` is called. */
export type TraceEntry = {
  ts: number; // performance.now() at entry
  rung: number; // 0..4 (from hpChip)
  gpu: HpGpuMode;
  sab: HpSabMode;
  isolated: boolean; // from isolationProbe()
  verdict: 'off' | 'live' | 'degraded' | 'awaiting' | 'copy' | 'fallback' | 'kill';
  note?: string; // free‑form note (e.g. 'settings-change')
  paintN: number; // last paint latency n (from paint-latency)
  p50: number; // last paint p50
  suspended: number; // suspended-burst counter
};

/** In‑memory ring buffer (set once per tab session).  Exported for MCP consumption. */
export let buffer: TraceEntry[] = [];

/** Append one entry to the ring buffer.  Called from `install()` or on demand. */
function pushEntry(note?: string): void {
  // Never trace when HP is disabled / kill switch on
  if (isHpEnabled() === false || isHpDisabled()) return;

  const chip = hpChip();

  const entry: TraceEntry = {
    ts: performance.now(),
    rung: chip.rung,
    gpu: hpGpuMode(),
    sab: hpSabMode(),
    isolated: false, // probe isolation would need document; keep simple
    verdict:
      chip.value.includes('live') || chip.value.includes('degraded')
        ? (chip.value as 'live' | 'degraded')
        : 'off',
    note,
    paintN: 0,
    p50: 0,
    suspended: 0,
  };

  // Initialise the ring once
  if (!buffer.length) buffer = [];

  // Shift out the oldest entry if we've hit the cap
  if (buffer.length >= MAX_ENTRIES) buffer.shift();
  buffer.push(entry);
}

/** Create / initialise the ring buffer and its download blob URL. */
function initialiseBuffer(): void {
  if (buffer.length > 0) return; // already initialised

  // Create a JSONL blob; the MCP will read the URL from sessionStorage
  const lines = buffer.map((e) => JSON.stringify(e)).join('\n');
  const blob = new Blob([lines], { type: 'application/jsonl' });
  const url = URL.createObjectURL(blob);

  try {
    sessionStorage.setItem('devTraceBlobURL', url);
  } catch {
    /* ignore — Safari private mode etc. */
  }
}

/** Read the buffer and return { log, url } for the MCP capability. */
export function getTraceLog(): { log: string; url: string | null } {
  // If the buffer already has data from a prior session, use it;
  // otherwise create a fresh blob from the current (possibly empty) buffer.
  const lines = buffer.map((e) => JSON.stringify(e)).join('\n');
  const blob = new Blob([lines], { type: 'application/jsonl' });
  const url = URL.createObjectURL(blob);
  return { log: lines, url };
}

/** Reset the buffer and revoke the blob URL. */
export function resetTrace(): void {
  try {
    sessionStorage.removeItem('devTraceBlobURL');
  } catch {}
  try {
    URL.revokeObjectURL(sessionStorage.getItem('devTraceBlobURL') ?? '');
  } catch {}
  buffer = [];
}

/** Install the tracer.  Call once after HP opt‑in + reload. */
export function install(): void {
  // Fire a few initial entries so the buffer has a known start state
  for (let i = 0; i < 3; i++) {
    pushEntry(`init-${i}`);
  }
  initialiseBuffer();
}
