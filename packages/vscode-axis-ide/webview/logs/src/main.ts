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
 * AXIS Logs webview. Filter/search stay in the view; reveal/copy post to host.
 */

import './style.css';
import {
  countLogLevels,
  filterLogs,
  logsEmptyMessage,
  type LogFilter,
  type LogRow,
} from '../../../src/views/logs-messages';
import { decodeLogsSet, encodeLogsCopy, encodeLogsReady, encodeLogsReveal } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const FILTERS: readonly LogFilter[] = ['all', 'error', 'warning', 'info', 'debug'];

let disposed = false;
let rows: LogRow[] = [];
let runId: string | null = null;
let status: string | null = null;
let filter: LogFilter = 'all';
let query = '';
let selectedIndex = -1;
let stickToBottom = true;
let lastAnnounce = '';

function post(api: VsCodeApi | null, message: unknown): void {
  if (disposed || !api) return;
  try {
    api.postMessage(message);
  } catch {
    // host may be gone
  }
}

function chipFilter(value: string | null): LogFilter | null {
  if (
    value === 'all' ||
    value === 'error' ||
    value === 'warning' ||
    value === 'info' ||
    value === 'debug'
  ) {
    return value;
  }
  return null;
}

function visibleRows(): LogRow[] {
  return filterLogs(rows, filter, query);
}

function announce(text: string): void {
  const live = document.getElementById('logs-live');
  if (!live) return;
  if (text === lastAnnounce) {
    live.textContent = '';
    window.setTimeout(() => {
      if (!disposed && live.isConnected) {
        live.textContent = text;
        lastAnnounce = text;
      }
    }, 30);
    return;
  }
  live.textContent = text;
  lastAnnounce = text;
}

function copyText(api: VsCodeApi | null, text: string): void {
  if (!text) return;
  post(api, encodeLogsCopy(text));
  try {
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      void clip.writeText(text).catch(() => {
        // host copy is the fallback
      });
    }
  } catch {
    // clipboard optional
  }
  announce('Copied');
}

function revealRow(api: VsCodeApi | null, row: LogRow | undefined): void {
  if (!row || row.line == null) return;
  post(api, encodeLogsReveal(row.line));
}

function isNearBottom(list: HTMLElement): boolean {
  const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
  return remaining <= 24;
}

function updateSelection(list: HTMLElement, visible: LogRow[]): void {
  const items = list.querySelectorAll<HTMLElement>('.logs-row');
  if (visible.length === 0) {
    selectedIndex = -1;
    list.setAttribute('aria-activedescendant', '');
    items.forEach((item) => {
      item.classList.remove('is-selected');
      item.setAttribute('aria-selected', 'false');
    });
    return;
  }
  if (selectedIndex < 0) selectedIndex = 0;
  if (selectedIndex >= visible.length) selectedIndex = visible.length - 1;
  items.forEach((item, index) => {
    const on = index === selectedIndex;
    item.classList.toggle('is-selected', on);
    item.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) {
      const id = item.id || `logs-row-${index}`;
      item.id = id;
      list.setAttribute('aria-activedescendant', id);
      try {
        item.scrollIntoView({ block: 'nearest' });
      } catch {
        // scrollIntoView optional
      }
    }
  });
}

function render(api: VsCodeApi | null): void {
  if (disposed) return;
  const runEl = document.getElementById('logs-run');
  const runCopy = document.getElementById('logs-run-copy');
  const statusEl = document.getElementById('logs-status');
  const countEl = document.getElementById('logs-count');
  const emptyEl = document.getElementById('logs-empty');
  const list = document.getElementById('logs-list');
  const search = document.getElementById('logs-search');

  if (runEl) runEl.textContent = runId ?? 'No run';
  if (runCopy instanceof HTMLButtonElement) {
    runCopy.hidden = !runId;
  }

  if (statusEl) {
    if (status) {
      statusEl.hidden = false;
      statusEl.textContent = status;
      statusEl.setAttribute('data-status', status.toLowerCase());
    } else {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.setAttribute('data-status', '');
    }
  }

  if (search instanceof HTMLInputElement && document.activeElement !== search && search.value !== query) {
    search.value = query;
  }

  const counts = countLogLevels(rows);
  for (const level of FILTERS) {
    const el = document.querySelector(`[data-count-for="${level}"]`);
    if (el) el.textContent = String(counts[level]);
  }

  const visible = visibleRows();
  if (countEl) countEl.textContent = `${visible.length} / ${rows.length}`;

  const emptyCopy = logsEmptyMessage(rows.length, visible.length);
  if (emptyEl) {
    emptyEl.hidden = !emptyCopy;
    emptyEl.textContent = emptyCopy;
  }

  if (!list) return;

  const prevStick = stickToBottom;
  list.replaceChildren();
  visible.forEach((row, index) => {
    const item = document.createElement('li');
    item.className = `logs-row logs-row--${row.level}`;
    item.id = `logs-row-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.index = String(index);
    if (row.line != null) item.dataset.line = String(row.line);
    item.dataset.message = row.message;

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
      button.textContent = `L${row.line}`;
      button.title = `Reveal line ${row.line}`;
      button.setAttribute('aria-label', `Reveal line ${row.line}`);
      item.append(button);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'logs-line';
      spacer.setAttribute('aria-hidden', 'true');
      item.append(spacer);
    }

    if (row.time) {
      const time = document.createElement('time');
      time.className = 'logs-time';
      time.dateTime = row.time;
      time.textContent = row.time;
      item.append(time);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'logs-time';
      spacer.setAttribute('aria-hidden', 'true');
      item.append(spacer);
    }

    list.append(item);
  });

  const chips = document.querySelectorAll<HTMLButtonElement>('button[data-level]');
  chips.forEach((chip) => {
    chip.setAttribute('aria-pressed', chip.getAttribute('data-level') === filter ? 'true' : 'false');
  });

  updateSelection(list, visible);

  if (prevStick && visible.length > 0) {
    try {
      list.scrollTop = list.scrollHeight;
      stickToBottom = true;
    } catch {
      // scroll optional
    }
  }

  void api;
}

function moveSelection(delta: number, list: HTMLElement): void {
  const visible = visibleRows();
  if (visible.length === 0) return;
  if (selectedIndex < 0) selectedIndex = delta > 0 ? 0 : visible.length - 1;
  else selectedIndex = Math.max(0, Math.min(visible.length - 1, selectedIndex + delta));
  updateSelection(list, visible);
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
    if (!next || next === filter) return;
    filter = next;
    selectedIndex = 0;
    stickToBottom = true;
    render(api);
    const visible = visibleRows();
    announce(
      logsEmptyMessage(rows.length, visible.length) ||
        `${visible.length} ${next === 'all' ? 'log' : next} line${visible.length === 1 ? '' : 's'}`,
    );
  });

  const search = document.getElementById('logs-search');
  search?.addEventListener('input', () => {
    if (!(search instanceof HTMLInputElement)) return;
    query = search.value;
    selectedIndex = 0;
    stickToBottom = true;
    render(api);
    const visible = visibleRows();
    announce(
      logsEmptyMessage(rows.length, visible.length) ||
        `${visible.length} matching line${visible.length === 1 ? '' : 's'}`,
    );
  });

  const runCopy = document.getElementById('logs-run-copy');
  runCopy?.addEventListener('click', () => {
    if (!runId) return;
    copyText(api, runId);
  });

  const list = document.getElementById('logs-list');
  list?.addEventListener('scroll', () => {
    if (!(list instanceof HTMLElement)) return;
    stickToBottom = isNearBottom(list);
  });

  list?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const rowEl = target.closest('.logs-row');
    if (!(rowEl instanceof HTMLElement)) return;
    const index = Number(rowEl.dataset.index);
    if (Number.isInteger(index) && index >= 0) selectedIndex = index;
    const visible = visibleRows();
    updateSelection(list as HTMLElement, visible);

    const lineBtn = target.closest('button[data-line]');
    if (lineBtn) {
      const line = Number(lineBtn.getAttribute('data-line'));
      if (Number.isInteger(line) && line >= 1) post(api, encodeLogsReveal(line));
      return;
    }
    revealRow(api, visible[selectedIndex]);
  });

  list?.addEventListener('dblclick', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button[data-line]')) return;
    const rowEl = target.closest('.logs-row');
    if (!(rowEl instanceof HTMLElement)) return;
    const message = rowEl.dataset.message ?? '';
    copyText(api, message);
  });

  list?.addEventListener('keydown', (event) => {
    if (!(list instanceof HTMLElement)) return;
    const key = event.key;
    if (key === 'ArrowDown' || key === 'j') {
      event.preventDefault();
      moveSelection(1, list);
      return;
    }
    if (key === 'ArrowUp' || key === 'k') {
      event.preventDefault();
      moveSelection(-1, list);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      revealRow(api, visibleRows()[selectedIndex]);
      return;
    }
    if (key === 'c' && (event.metaKey || event.ctrlKey)) {
      const row = visibleRows()[selectedIndex];
      if (!row) return;
      event.preventDefault();
      copyText(api, row.message);
    }
  });

  window.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    if (!(list instanceof HTMLElement)) return;
    if (document.activeElement !== list && !list.contains(document.activeElement)) {
      // allow j/k when focus is elsewhere in the panel except the search box
      if (event.key !== 'j' && event.key !== 'k' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
        return;
      }
      list.focus();
    }
  });

  window.addEventListener('message', (event: MessageEvent) => {
    if (disposed) return;
    const decoded = decodeLogsSet(event.data);
    if (!decoded) return;
    rows = decoded.rows;
    runId = decoded.runId;
    status = decoded.status;
    if (selectedIndex >= visibleRows().length) selectedIndex = rows.length > 0 ? 0 : -1;
    render(api);
  });

  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
    },
    { once: true },
  );

  render(api);
  post(api, encodeLogsReady());
}

main();
