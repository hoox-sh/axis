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
 * AXIS chart webview shell (PR-04).
 * Posts webview.ready; decodes chart.init stub. LWC paint lands in Task 07.
 */

import './style.css';
import { decodeHostMessage, pickChartInitFields, PROTOCOL_VERSION } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;

function postReady(api: VsCodeApi): void {
  if (disposed) return;
  api.postMessage({
    v: PROTOCOL_VERSION,
    type: 'webview.ready',
    payload: {
      view: 'chart',
      capabilities: ['chart-shell'],
    },
    ts: Date.now(),
  });
}

function applyChartInit(payload: Record<string, unknown>): void {
  const fields = pickChartInitFields(payload);
  const host = document.getElementById('chart-host');
  if (!host) return;
  host.setAttribute('data-axis-init', '1');
  if (typeof fields.theme === 'string' && fields.theme.length > 0) {
    host.setAttribute('data-axis-theme', fields.theme);
  }
  if (fields.seriesKey) {
    host.setAttribute('data-axis-series', fields.seriesKey);
  }
  // cssVars / panes reserved for Task 07 LWC theme + pane layout.
  void fields.cssVars;
  void fields.panes;
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) {
    // Drop unexpected / malformed host traffic (wrong direction, bad envelope).
    return;
  }
  if (decoded.type === 'chart.init') {
    applyChartInit(decoded.payload);
  }
}

function main(): void {
  const api = acquireVsCodeApi();
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
