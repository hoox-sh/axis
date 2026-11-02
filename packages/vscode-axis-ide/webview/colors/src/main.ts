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
 * AXIS Colors webview. Host posts colors.set; rows are buttons that post colors.reveal.
 */

import './style.css';
import {
  decodeColorsSet,
  encodeColorsReady,
  encodeColorsReveal,
  isSafeSwatch,
  type ColorRow,
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

function countLabel(count: number): string {
  if (count === 1) return '1 color';
  return `${count} colors`;
}

function rowButton(hit: ColorRow): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'colors-list__item';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'colors-row';
  button.dataset.line = String(hit.line);
  button.title = `Show line ${hit.line}, column ${hit.column}`;

  const swatch = document.createElement('span');
  swatch.className = 'colors-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  if (isSafeSwatch(hit.swatch)) {
    swatch.style.backgroundColor = hit.swatch;
  } else {
    swatch.classList.add('colors-swatch--raw');
  }

  const raw = document.createElement('span');
  raw.className = 'colors-raw';
  raw.textContent = hit.raw;

  const line = document.createElement('span');
  line.className = 'colors-line';
  line.textContent = `L${hit.line}`;

  const show = document.createElement('span');
  show.className = 'colors-show';
  show.textContent = 'Show line';

  button.append(swatch, raw, line, show);
  item.append(button);
  return item;
}

function applyState(colors: ColorRow[], sourceLabel: string): void {
  if (disposed) return;
  setText('colors-count', countLabel(colors.length));
  setText('colors-source', sourceLabel);
  const empty = document.getElementById('colors-empty');
  const list = document.getElementById('colors-list');
  if (empty) empty.hidden = colors.length > 0;
  if (!(list instanceof HTMLUListElement)) return;
  list.hidden = colors.length === 0;
  list.replaceChildren();
  for (const hit of colors) list.append(rowButton(hit));
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeColorsSet(event.data);
  if (!decoded) return;
  applyState(decoded.colors, decoded.sourceLabel);
}

function onListClick(event: MouseEvent, api: VsCodeApi): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('button[data-line]');
  if (!(button instanceof HTMLButtonElement)) return;
  const line = Number(button.dataset.line);
  if (!Number.isInteger(line) || line < 1) return;
  api.postMessage(encodeColorsReveal(line));
}

function main(): void {
  const api = acquireVsCodeApi();
  const list = document.getElementById('colors-list');
  if (list) {
    list.addEventListener('click', (event) => {
      onListClick(event, api);
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
  api.postMessage(encodeColorsReady());
}

main();
