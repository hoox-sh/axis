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
 * AXIS Workers webview: workers.ready → workers.init / workers.state.
 */

import './style.css';
import {
  decodeHostMessage,
  encodeWorkersProbe,
  encodeWorkersProbeAll,
  encodeWorkersReady,
  type WorkerStudioCard,
  type WorkersStudioCounts,
} from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const SVG_NS = 'http://www.w3.org/2000/svg';

let disposed = false;
let apiRef: VsCodeApi | null = null;
let awaitingAll = false;

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setLive(text: string): void {
  setText('workers-live', text);
}

function post(message: unknown): void {
  if (disposed || !apiRef || !message) return;
  try {
    apiRef.postMessage(message);
  } catch {
    // host may be gone
  }
}

function statusDot(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '8');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('workers-pill__dot');
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '4');
  circle.setAttribute('cy', '4');
  circle.setAttribute('r', '3');
  circle.setAttribute('fill', 'currentColor');
  svg.append(circle);
  return svg;
}

function addLine(parent: HTMLElement, className: string, text: string): void {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  parent.append(p);
}

function renderCard(card: WorkerStudioCard): HTMLElement {
  const article = document.createElement('article');
  article.className = 'workers-card';
  article.dataset.id = card.id;

  const name = document.createElement('h2');
  name.className = 'workers-card__name';
  name.textContent = card.name;
  article.append(name);

  addLine(article, 'workers-card__id', card.id);
  if (card.summary) addLine(article, 'workers-card__summary', card.summary);
  addLine(article, 'workers-card__meta', `probe ${card.probe || '—'}`);
  addLine(article, 'workers-card__meta workers-card__endpoint', card.endpoint || '—');

  const row = document.createElement('div');
  row.className = 'workers-card__row';

  const pill = document.createElement('span');
  pill.className = `workers-pill workers-pill--${card.status}`;
  pill.append(statusDot());
  pill.append(document.createTextNode(card.status));
  row.append(pill);

  if (card.latencyMs != null) {
    const latency = document.createElement('span');
    latency.className = 'workers-card__meta';
    latency.textContent = `${Math.round(card.latencyMs)} ms`;
    row.append(latency);
  }

  if (card.detail) {
    const detail = document.createElement('span');
    detail.className = 'workers-card__meta';
    detail.textContent = card.detail;
    row.append(detail);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'workers-btn';
  button.textContent = 'Probe';
  button.setAttribute('aria-label', `Probe ${card.name}`);
  button.addEventListener('click', () => {
    post(encodeWorkersProbe(card.id));
  });
  row.append(button);
  article.append(row);
  return article;
}

function renderCounts(counts: WorkersStudioCounts): void {
  setText(
    'workers-counts',
    `${counts.healthy} healthy · ${counts.degraded} degraded · ${counts.down} down · ${counts.unknown} unknown`,
  );
}

function renderCards(cards: readonly WorkerStudioCard[], probed: boolean): void {
  const host = document.getElementById('workers-cards');
  if (!host) return;
  host.replaceChildren();
  if (cards.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'workers-empty';
    empty.textContent = 'No workers in catalog.';
    host.append(empty);
    return;
  }
  for (const card of cards) host.append(renderCard(card));
  if (!probed) {
    const note = document.createElement('p');
    note.className = 'workers-empty';
    note.textContent = 'Idle — not probed';
    host.append(note);
  }
}

function applyView(
  cards: readonly WorkerStudioCard[],
  counts: WorkersStudioCounts,
  probed: boolean,
  type: 'workers.init' | 'workers.state',
): void {
  if (disposed) return;
  setText('workers-phase', probed ? 'Last probe' : 'Idle — not probed');
  renderCounts(counts);
  renderCards(cards, probed);
  if (awaitingAll && type === 'workers.state') {
    awaitingAll = false;
    setLive(`Probe finished — ${counts.healthy} healthy`);
  }
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  applyView(decoded.cards, decoded.counts, decoded.probed, decoded.type);
}

function bindProbeAll(): void {
  const button = document.getElementById('workers-probe-all');
  if (!(button instanceof HTMLButtonElement)) return;
  button.addEventListener('click', () => {
    if (disposed) return;
    awaitingAll = true;
    setLive('Probing…');
    post(encodeWorkersProbeAll());
  });
}

function main(): void {
  const api = acquireVsCodeApi();
  apiRef = api;
  bindProbeAll();
  window.addEventListener('message', onHostMessage);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
    },
    { once: true },
  );
  post(encodeWorkersReady());
}

main();
