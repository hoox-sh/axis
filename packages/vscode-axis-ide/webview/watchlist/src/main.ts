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
 * AXIS Watchlist studio: watchlist.ready → watchlist.snapshot.
 * Prices are whatever the host formatted. A "placeholder" badge means the
 * mock feed — this view never invents a live tick.
 */

import './style.css';
import {
  decodeHostMessage,
  encodeWatchlistAdd,
  encodeWatchlistReady,
  encodeWatchlistRemove,
  encodeWatchlistSelect,
  normalizeWatchlistSymbol,
  type WatchlistViewSnapshot,
} from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let apiRef: VsCodeApi | null = null;

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHidden(id: string, hidden: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = hidden;
}

function liveEl(): HTMLElement | null {
  const el = document.getElementById('watchlist-live');
  return el instanceof HTMLElement ? el : null;
}

function flash(text: string): void {
  const el = liveEl();
  if (!el) return;
  el.textContent = '';
  window.setTimeout(() => {
    if (!disposed && liveEl() === el) el.textContent = text;
  }, 0);
}

function countLabel(count: number): string {
  if (count === 1) return '1 symbol';
  return `${count} symbols`;
}

function selectedLabel(snap: WatchlistViewSnapshot): string {
  if (snap.selected) return `Selected ${snap.selected}`;
  if (snap.focusSymbol) return `Status bar follows ${snap.focusSymbol}`;
  return 'No symbol selected';
}

function checkSvg(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'watchlist-check');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M6.2 11.2 3 8l1.1-1.1 2.1 2.1 5.7-5.7L13 4.4z');
  svg.append(path);
  return svg;
}

function emptyCheck(): HTMLElement {
  const slot = document.createElement('span');
  slot.className = 'watchlist-check';
  slot.setAttribute('aria-hidden', 'true');
  return slot;
}

function actionButton(action: 'select' | 'remove', symbol: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'watchlist-btn';
  button.dataset.action = action;
  button.dataset.symbol = symbol;
  button.textContent = label;
  button.setAttribute('aria-label', `${label} ${symbol}`);
  return button;
}

function renderRow(row: WatchlistViewSnapshot['rows'][number]): HTMLLIElement {
  const li = document.createElement('li');
  li.className = row.selected ? 'watchlist-row watchlist-row--selected' : 'watchlist-row';
  if (row.selected) li.setAttribute('aria-current', 'true');
  li.append(row.selected ? checkSvg() : emptyCheck());

  const symbol = document.createElement('span');
  symbol.className = 'watchlist-symbol';
  symbol.textContent = row.symbol;
  li.append(symbol);

  const price = document.createElement('span');
  price.className = 'watchlist-row__price';
  price.textContent = row.priceText;
  li.append(price);

  const actions = document.createElement('div');
  actions.className = 'watchlist-row__actions';
  actions.append(actionButton('select', row.symbol, 'Select'));
  actions.append(actionButton('remove', row.symbol, 'Remove'));
  li.append(actions);
  return li;
}

function applySnapshot(snap: WatchlistViewSnapshot): void {
  if (disposed) return;
  setText('watchlist-count', countLabel(snap.count));
  setText('watchlist-selected', selectedLabel(snap));
  setText('watchlist-price', snap.focusPriceText || '—');
  const badge = document.getElementById('watchlist-badge');
  if (badge) {
    badge.hidden = snap.placeholder !== true;
    badge.textContent = 'placeholder';
  }
  setHidden('watchlist-empty', snap.rows.length > 0);
  const list = document.getElementById('watchlist-rows');
  if (!list) return;
  list.replaceChildren();
  for (const row of snap.rows) list.append(renderRow(row));
}

function post(message: unknown): void {
  if (disposed || !apiRef) return;
  try {
    apiRef.postMessage(message);
  } catch {
    // host may be gone
  }
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  applySnapshot(decoded.snapshot);
}

function onSubmit(event: Event): void {
  if (disposed) return;
  event.preventDefault();
  const input = document.getElementById('watchlist-symbol-input');
  if (!(input instanceof HTMLInputElement)) return;
  const symbol = normalizeWatchlistSymbol(input.value);
  if (!symbol) {
    flash('Could not add');
    return;
  }
  post(encodeWatchlistAdd(symbol));
  input.value = '';
}

function onClick(event: Event): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('button[data-action]');
  if (!(button instanceof HTMLButtonElement)) return;
  const symbol = normalizeWatchlistSymbol(button.dataset.symbol);
  if (!symbol) return;
  const action = button.dataset.action;
  if (action === 'select') {
    flash(`Selected ${symbol}`);
    post(encodeWatchlistSelect(symbol));
    return;
  }
  if (action === 'remove') {
    flash(`Removed ${symbol}`);
    post(encodeWatchlistRemove(symbol));
  }
}

function main(): void {
  let api: VsCodeApi;
  try {
    api = acquireVsCodeApi();
  } catch {
    return;
  }
  apiRef = api;
  window.addEventListener('message', onHostMessage);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
    },
    { once: true },
  );
  const form = document.getElementById('watchlist-add-form');
  if (form) form.addEventListener('submit', onSubmit);
  const root = document.getElementById('watchlist-root');
  if (root) root.addEventListener('click', onClick);
  post(encodeWatchlistReady());
}

main();
