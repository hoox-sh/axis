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
 * AXIS Profiler webview: profiler.ready → profiler.set (or results.set) render.
 */

import './style.css';
import {
  barWidthPct,
  decodeHostMessage,
  encodeProfilerReady,
  snapshotFromPayload,
  type ProfilerViewSnapshot,
} from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHidden(id: string, hidden: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = hidden;
}

function applySnapshot(snap: ProfilerViewSnapshot | null): void {
  if (disposed) return;
  const empty = snap == null;
  setHidden('profiler-empty', !empty);
  setHidden('profiler-status', empty);
  setHidden('profiler-bar', empty);
  setHidden('profiler-dl', empty);

  if (empty) {
    setText('profiler-focus', 'No run yet');
    const msEl = document.getElementById('profiler-ms');
    if (msEl) {
      msEl.replaceChildren();
      msEl.append('—');
      const unit = document.createElement('span');
      unit.className = 'profiler-ms__unit';
      unit.textContent = 'ms';
      msEl.append(unit);
    }
    const fill = document.getElementById('profiler-bar-fill');
    if (fill) fill.style.width = '0%';
    return;
  }

  setText('profiler-focus', snap.error ? `id=${snap.runId} · ${snap.error}` : `id=${snap.runId}`);
  const msEl = document.getElementById('profiler-ms');
  if (msEl) {
    msEl.replaceChildren();
    msEl.append(String(Math.round(snap.ms)));
    const unit = document.createElement('span');
    unit.className = 'profiler-ms__unit';
    unit.textContent = 'ms';
    msEl.append(unit);
  }

  const chip = document.getElementById('profiler-status');
  if (chip) {
    chip.textContent = snap.status;
    chip.classList.remove('profiler-chip--success', 'profiler-chip--error');
    if (snap.status === 'success') chip.classList.add('profiler-chip--success');
    if (snap.status === 'error') chip.classList.add('profiler-chip--error');
  }

  const fill = document.getElementById('profiler-bar-fill');
  if (fill) fill.style.width = `${barWidthPct(snap.ms)}%`;

  setText('profiler-engine', snap.engineId || '—');
  setText('profiler-series-key', snap.seriesKey || '—');
  setText('profiler-plots', String(snap.plotCount));
  setText('profiler-series', String(snap.seriesCount));
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  if (decoded.type === 'profiler.set' || decoded.type === 'results.set') {
    applySnapshot(snapshotFromPayload(decoded.payload));
  }
}

function postReady(api: VsCodeApi): void {
  if (disposed) return;
  try {
    api.postMessage(encodeProfilerReady());
  } catch {
    // host may be gone
  }
}

function main(): void {
  const api = acquireVsCodeApi();
  window.addEventListener('message', onHostMessage);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
    },
    { once: true },
  );
  postReady(api);
}

main();
