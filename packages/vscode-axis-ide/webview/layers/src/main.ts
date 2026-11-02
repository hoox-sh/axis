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
 * AXIS Layers webview: layers.ready → layers.set.
 * Open chart posts `{ type: 'layers.openChart' }`.
 */

import './style.css';
import { paintLayers, queryLayersDom } from './render';
import { initialLayersView, viewFromHostMessage } from './state';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;

function post(api: VsCodeApi, message: { type: string }): void {
  if (disposed) return;
  try {
    api.postMessage(message);
  } catch {
    // host may be gone
  }
}

function main(): void {
  let api: VsCodeApi | null = null;
  try {
    api = acquireVsCodeApi();
  } catch {
    api = null;
  }
  const dom = queryLayersDom(document);
  paintLayers(dom, initialLayersView(), false);
  dom.open?.addEventListener('click', () => {
    if (!api) return;
    post(api, { type: 'layers.openChart' });
  });
  window.addEventListener('message', (event: MessageEvent) => {
    if (disposed) return;
    const next = viewFromHostMessage(event.data);
    if (!next) return;
    paintLayers(dom, next, true);
  });
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
    },
    { once: true },
  );
  if (api) post(api, { type: 'layers.ready' });
}

main();
