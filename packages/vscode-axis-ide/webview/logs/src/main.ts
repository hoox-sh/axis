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
 * AXIS Logs webview. Filter chips stay in the view; reveal posts `logs.reveal`.
 */

import './style.css';
import { filterLogs, type LogFilter, type LogRow } from '../../../src/views/logs-messages';
import { decodeLogsSet, encodeLogsReady, encodeLogsReveal } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type ChipFilter = Exclude<LogFilter, 'debug'>;

let disposed = false;
let rows: LogRow[] = [];
let runId: string | null = null;
let status: string | null = null;
let filter: ChipFilter = 'all';

function post(api: VsCodeApi | null, message: unknown): void {
  if (disposed || !api) return;
  try {
    api.postMessage(message);
  } catch {
    // host may be gone
  }
}

function chipFilter(value: string | null): ChipFilter | null {
  if (value === 'all' || value === 'error' || value === 'warning' || value === 'info') return value;
  return null;
}

function render(): void {
  if (disposed) return;
  const runEl = document.getElementById('logs-run');
  const statusEl = document.getElementById('logs-status');
  const countEl = document.getElementById('logs-count');
  const emptyEl = document.getElementById('logs-empty');
  const list = document.getElementById('logs-list');
  if (runEl) runEl.textContent = runId ?? 'No run';
  if (statusEl) statusEl.textContent = status ?? '';
  const visible = filterLogs(rows, filter);
  if (countEl) countEl.textContent = String(visible.length);
  if (emptyEl) emptyEl.hidden = visible.length > 0;
  if (!list) return;
  list.replaceChildren();
  for (const row of visible) {
    const item = document.createElement('li');
    item.className = `logs-row logs-row--${row.level}`;
    const level = document.createElement('span');
    level.className = 'logs-level';
    level.textContent = row.level;
    const message = document.createElement('p');
    message.className = 'logs-msg';
    message.textContent = row.message;
    item.append(level, message);
    if (row.line != null) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'logs-line';
      button.dataset.line = String(row.line);
      button.textContent = `Line ${row.line}`;
      button.title = `Reveal line ${row.line}`;
      item.append(button);
    }
    if (row.time) {
      const time = document.createElement('time');
      time.className = 'logs-time';
      time.dateTime = row.time;
      time.textContent = row.time;
      item.append(time);
    }
    list.append(item);
  }
  const chips = document.querySelectorAll<HTMLButtonElement>('button[data-level]');
  chips.forEach((chip) => {
    chip.setAttribute('aria-pressed', chip.getAttribute('data-level') === filter ? 'true' : 'false');
  });
}

function main(): void {
  let api: VsCodeApi | null = null;
  try {
    api = acquireVsCodeApi();
  } catch {
    api = null;
  }
  const filters = document.querySelector('.logs-filters');
  filters?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const chip = target.closest('button[data-level]');
    const next = chipFilter(chip?.getAttribute('data-level') ?? null);
    if (!next) return;
    filter = next;
    render();
  });
  const list = document.getElementById('logs-list');
  list?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button[data-line]');
    if (!button) return;
    const line = Number(button.getAttribute('data-line'));
    if (!Number.isInteger(line) || line < 1) return;
    post(api, encodeLogsReveal(line));
  });
  window.addEventListener('message', (event: MessageEvent) => {
    if (disposed) return;
    const decoded = decodeLogsSet(event.data);
    if (!decoded) return;
    rows = decoded.rows;
    runId = decoded.runId;
    status = decoded.status;
    render();
  });
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
    },
    { once: true },
  );
  render();
  post(api, encodeLogsReady());
}

main();
