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
 * Posts local profiler.reveal / profiler.copy (not axis.webview.v1).
 */

import './style.css';
import {
  barWidthPct,
  decodeHostMessage,
  encodeProfilerCopy,
  encodeProfilerReady,
  encodeProfilerReveal,
  formatPctChip,
  snapshotFromPayload,
  type ProfilerHotLineView,
  type ProfilerPhaseView,
  type ProfilerViewSnapshot,
} from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let currentRunId = '';

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHidden(id: string, hidden: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = hidden;
}

function announce(text: string): void {
  const live = document.getElementById('profiler-live');
  if (live) live.textContent = text;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '0';
  if (Number.isInteger(ms) || Math.abs(ms) >= 100) return String(Math.round(ms));
  return (Math.round(ms * 10) / 10).toFixed(1);
}

function phaseItem(phase: ProfilerPhaseView): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'profiler-phases__item';
  const name = document.createElement('span');
  name.className = 'profiler-phases__name';
  name.textContent = phase.name;
  const ms = document.createElement('span');
  ms.className = 'profiler-phases__ms';
  ms.textContent = `${formatMs(phase.ms)} ms`;
  li.append(name, ms);
  return li;
}

function hotLineItem(row: ProfilerHotLineView): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'profiler-hot__item';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'profiler-hot__line';
  btn.dataset.line = String(row.line);
  btn.title = `Reveal line ${row.line}`;
  btn.setAttribute('aria-label', `Reveal line ${row.line}`);
  btn.textContent = `L${row.line}`;

  const ms = document.createElement('span');
  ms.className = 'profiler-hot__ms';
  ms.textContent = `${formatMs(row.ms)} ms`;

  const pct = document.createElement('span');
  pct.className = 'profiler-hot__pct';
  pct.textContent = formatPctChip(row.pct);

  const execs = document.createElement('span');
  execs.className = 'profiler-hot__execs';
  execs.textContent = `${row.execs}×`;

  li.append(btn, ms, pct, execs);
  return li;
}

function renderPhases(phases: ProfilerPhaseView[] | undefined): void {
  const section = document.getElementById('profiler-phases');
  const list = document.getElementById('profiler-phases-list');
  if (!(list instanceof HTMLUListElement) || !section) return;
  list.replaceChildren();
  if (!phases || phases.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const phase of phases) list.append(phaseItem(phase));
}

function renderHotLines(rows: ProfilerHotLineView[]): void {
  const section = document.getElementById('profiler-hot');
  const list = document.getElementById('profiler-hot-list');
  if (!(list instanceof HTMLUListElement) || !section) return;
  list.replaceChildren();
  if (rows.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const row of rows) list.append(hotLineItem(row));
}

function applySnapshot(snap: ProfilerViewSnapshot | null): void {
  if (disposed) return;
  const empty = snap == null;
  setHidden('profiler-empty', !empty);
  setHidden('profiler-status', empty);
  setHidden('profiler-bar', empty);
  setHidden('profiler-dl', empty);
  setHidden('profiler-copy', empty);
  const bar = document.getElementById('profiler-bar');
  if (bar) bar.setAttribute('aria-hidden', empty ? 'true' : 'false');

  if (empty) {
    currentRunId = '';
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
    renderPhases(undefined);
    renderHotLines([]);
    announce('No profiler run');
    return;
  }

  currentRunId = snap.runId;
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
  renderPhases(snap.phases);
  renderHotLines(snap.topLines);
  announce(
    snap.topLines.length > 0
      ? `Run ${snap.runId} · ${Math.round(snap.ms)} ms · ${snap.topLines.length} hot lines`
      : `Run ${snap.runId} · ${Math.round(snap.ms)} ms`,
  );
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  if (decoded.type === 'profiler.set' || decoded.type === 'results.set') {
    applySnapshot(snapshotFromPayload(decoded.payload));
  }
}

function onRootClick(event: MouseEvent, api: VsCodeApi): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof Element)) return;

  const copy = target.closest('#profiler-copy');
  if (copy instanceof HTMLButtonElement) {
    if (!currentRunId) return;
    try {
      api.postMessage(encodeProfilerCopy(currentRunId));
      announce(`Copied ${currentRunId}`);
    } catch {
      // host may be gone
    }
    return;
  }

  const lineBtn = target.closest('button.profiler-hot__line');
  if (!(lineBtn instanceof HTMLButtonElement)) return;
  const line = Number(lineBtn.dataset.line);
  if (!Number.isInteger(line) || line < 1) return;
  try {
    api.postMessage(encodeProfilerReveal(line));
  } catch {
    // host may be gone
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
  const root = document.getElementById('profiler-root');
  if (root) {
    root.addEventListener('click', (event) => {
      onRootClick(event, api);
    });
  }
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
