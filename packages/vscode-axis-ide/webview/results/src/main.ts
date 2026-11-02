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
 * AXIS Results / Strategy webview: results.ready → results.set card render.
 */

import './style.css';
import { decodeHostMessage, PROTOCOL_VERSION } from './protocol';
import { paintResults, queryResultsDom } from './render';
import { buildResultsView, type ResultsKind } from './state';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let dom: ReturnType<typeof queryResultsDom> | null = null;

function panelKind(): ResultsKind {
  const raw = document.body?.getAttribute('data-axis-results-kind');
  return raw === 'strategy' ? 'strategy' : 'results';
}

function postReady(api: VsCodeApi): void {
  if (disposed) return;
  api.postMessage({
    v: PROTOCOL_VERSION,
    type: 'results.ready',
    payload: {},
    ts: Date.now(),
  });
}

function applyResultsSet(payload: Record<string, unknown>): void {
  if (disposed) return;
  const view = buildResultsView(panelKind(), payload);
  if (!dom) dom = queryResultsDom(document);
  paintResults(dom, view);
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  if (decoded.type === 'results.set') {
    applyResultsSet(decoded.payload);
  }
}

function main(): void {
  const api = acquireVsCodeApi();
  dom = queryResultsDom(document);
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
