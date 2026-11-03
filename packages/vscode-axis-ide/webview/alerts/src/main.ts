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
 * AXIS Alerts studio: alerts.ready → alerts.set.
 * Add / toggle / remove post back to the host. Empty titles never post.
 */

import './style.css';
import { buildAlertsSnapshot, type AlertsStudioEntry } from '../../../src/views/alerts-studio-model';
import {
  ALERTS_REMOVED,
  ALERTS_TITLE_REQUIRED,
  decodeHostMessage,
  encodeAlertsAdd,
  encodeAlertsReady,
  encodeAlertsRemove,
  encodeAlertsToggle,
  type AlertsSnapshot,
} from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const SVG_NS = 'http://www.w3.org/2000/svg';
const BELL_D =
  'M8 1.75a.75.75 0 0 1 .75.75v.41A4.5 4.5 0 0 1 12.5 7.25v2.1l.9 1.35a.75.75 0 0 1-.62 1.15H3.22a.75.75 0 0 1-.62-1.15l.9-1.35v-2.1A4.5 4.5 0 0 1 7.25 2.91V2.5A.75.75 0 0 1 8 1.75zM6.5 12.75a1.5 1.5 0 0 0 3 0h-3z';

let disposed = false;
let apiRef: VsCodeApi | null = null;
let snapshot: AlertsSnapshot = buildAlertsSnapshot(undefined);
let flashTimer: ReturnType<typeof setTimeout> | undefined;

function bellGraphic(slashed: boolean): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'alerts-bell');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', BELL_D);
  svg.append(path);
  if (slashed) {
    const slash = document.createElementNS(SVG_NS, 'path');
    slash.setAttribute('d', 'M2.2 13.4 13.4 2.2');
    slash.setAttribute('fill', 'none');
    slash.setAttribute('stroke', 'currentColor');
    slash.setAttribute('stroke-width', '1.4');
    slash.setAttribute('stroke-linecap', 'round');
    svg.append(slash);
  }
  return svg;
}

function renderRow(entry: AlertsStudioEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'alerts-row';
  li.setAttribute('data-alert-id', entry.id);

  const mark = document.createElement('span');
  mark.className = entry.enabled
    ? 'alerts-mark alerts-mark--on'
    : 'alerts-mark alerts-mark--off';
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', entry.enabled ? 'Enabled' : 'Disabled');
  mark.append(bellGraphic(!entry.enabled));

  const main = document.createElement('div');
  main.className = 'alerts-row__main';

  const title = document.createElement('div');
  title.className = 'alerts-row__title';
  title.textContent = entry.title;

  const condition = document.createElement('div');
  condition.className = entry.condition
    ? 'alerts-row__condition'
    : 'alerts-row__condition alerts-row__condition--empty';
  condition.textContent = entry.condition ? entry.condition : 'No condition';

  const idEl = document.createElement('div');
  idEl.className = 'alerts-row__id';
  idEl.textContent = entry.id;

  main.append(title, condition, idEl);

  const actions = document.createElement('div');
  actions.className = 'alerts-row__actions';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'alerts-btn';
  toggle.dataset.action = 'toggle';
  toggle.textContent = entry.enabled ? 'Disable' : 'Enable';
  toggle.setAttribute('aria-pressed', entry.enabled ? 'true' : 'false');
  toggle.setAttribute(
    'aria-label',
    entry.enabled ? `Disable ${entry.title}` : `Enable ${entry.title}`,
  );

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'alerts-btn';
  remove.dataset.action = 'remove';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove ${entry.title}`);

  actions.append(toggle, remove);
  li.append(mark, main, actions);
  return li;
}

function paint(): void {
  if (disposed) return;
  const summary = document.getElementById('alerts-summary');
  if (summary) summary.textContent = snapshot.summary;
  const empty = document.getElementById('alerts-empty');
  const list = document.getElementById('alerts-list');
  const has = snapshot.entries.length > 0;
  if (empty) empty.hidden = has;
  if (list) {
    list.hidden = !has;
    list.replaceChildren(...snapshot.entries.map(renderRow));
  }
}

function flash(text: string, kind: 'error' | 'info'): void {
  const el = document.getElementById('alerts-live');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('alerts-live--error', kind === 'error');
  if (flashTimer !== undefined) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = undefined;
    if (disposed) return;
    const live = document.getElementById('alerts-live');
    if (!live) return;
    live.textContent = '';
    live.classList.remove('alerts-live--error');
  }, 2400);
}

function post(message: unknown): void {
  if (disposed || !apiRef) return;
  try {
    apiRef.postMessage(message);
  } catch {
    // host may be gone
  }
}

function onAdd(): void {
  const titleEl = document.getElementById('alerts-title');
  const condEl = document.getElementById('alerts-condition');
  if (!(titleEl instanceof HTMLInputElement)) return;
  const title = titleEl.value.trim();
  const condition = condEl instanceof HTMLInputElement ? condEl.value.trim() : '';
  if (!title) {
    flash(ALERTS_TITLE_REQUIRED, 'error');
    titleEl.setAttribute('aria-invalid', 'true');
    titleEl.focus();
    return;
  }
  titleEl.removeAttribute('aria-invalid');
  post(encodeAlertsAdd(title, condition || undefined));
  titleEl.value = '';
  if (condEl instanceof HTMLInputElement) condEl.value = '';
}

function onToggle(id: string): void {
  snapshot = buildAlertsSnapshot(
    snapshot.entries.map((entry) =>
      entry.id === id ? { ...entry, enabled: !entry.enabled } : entry,
    ),
  );
  paint();
  post(encodeAlertsToggle(id));
}

function onRemove(id: string): void {
  snapshot = buildAlertsSnapshot(snapshot.entries.filter((entry) => entry.id !== id));
  paint();
  flash(ALERTS_REMOVED, 'info');
  post(encodeAlertsRemove(id));
}

function onClick(event: Event): void {
  if (disposed) return;
  const origin =
    event.target instanceof Element
      ? event.target
      : event.target instanceof Node
        ? event.target.parentElement
        : null;
  if (!origin) return;
  const button = origin.closest('button');
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.action ?? '';
  if (action === 'add') {
    onAdd();
    return;
  }
  const row = button.closest('[data-alert-id]');
  const id = row?.getAttribute('data-alert-id') ?? '';
  if (!id) return;
  if (action === 'toggle') onToggle(id);
  else if (action === 'remove') onRemove(id);
}

function onKeyDown(event: KeyboardEvent): void {
  if (disposed || event.key !== 'Enter') return;
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.id !== 'alerts-title' && event.target.id !== 'alerts-condition') return;
  event.preventDefault();
  onAdd();
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  if (decoded.type === 'alerts.set') {
    snapshot = decoded.snapshot;
    paint();
    return;
  }
  if (!decoded.text) return;
  flash(decoded.text, decoded.text === ALERTS_TITLE_REQUIRED ? 'error' : 'info');
}

function main(): void {
  const api = acquireVsCodeApi();
  apiRef = api;
  const root = document.getElementById('alerts-root');
  window.addEventListener('message', onHostMessage);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
    },
    { once: true },
  );
  root?.addEventListener('click', onClick);
  root?.addEventListener('keydown', onKeyDown);
  paint();
  post(encodeAlertsReady());
}

main();
