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
 * AXIS chart webview (PR-05): ready handshake → chart.init + chart.full paint.
 */

import './style.css';
import { createChartPainter, type ChartPainter } from './paint';
import { decodeHostMessage, PROTOCOL_VERSION } from './protocol';
import { initialChartState, reduceChartMessage, type ChartViewState } from './state';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let state: ChartViewState = initialChartState();
let painter: ChartPainter | null = null;

function postReady(api: VsCodeApi): void {
  if (disposed) return;
  api.postMessage({
    v: PROTOCOL_VERSION,
    type: 'webview.ready',
    payload: {
      view: 'chart',
      capabilities: ['chart-shell', 'chart-full'],
    },
    ts: Date.now(),
  });
}

function ensurePainter(): ChartPainter | null {
  if (disposed) return null;
  if (painter) return painter;
  const host = document.getElementById('chart-host');
  if (!host) return null;
  painter = createChartPainter(host);
  return painter;
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) {
    // Drop unexpected / malformed host traffic (wrong direction, bad envelope).
    return;
  }
  state = reduceChartMessage(state, decoded.type, decoded.payload);
  if (disposed) return;
  const p = ensurePainter();
  if (disposed) return;
  p?.apply(state);
}

function main(): void {
  const api = acquireVsCodeApi();
  // Listener before ready — host may reply synchronously after postMessage.
  window.addEventListener('message', onHostMessage);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      try {
        painter?.dispose();
      } catch {
        // ignore
      }
      painter = null;
    },
    { once: true },
  );
  ensurePainter();
  postReady(api);
}

main();
