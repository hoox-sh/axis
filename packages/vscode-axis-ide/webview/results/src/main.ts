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
 * AXIS Results / Strategy webview: results.ready → results.set render.
 */

import './style.css';
import { decodeHostMessage, PROTOCOL_VERSION } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;

function panelKind(): 'results' | 'strategy' {
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
}

function summarizeLastRun(lastRun: unknown): string {
  if (lastRun == null) return 'No run focused';
  if (typeof lastRun !== 'object' || Array.isArray(lastRun)) {
    return safeJson(lastRun);
  }
  const r = lastRun as Record<string, unknown>;
  const meta =
    r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta)
      ? (r.meta as Record<string, unknown>)
      : {};
  const name = typeof meta.script_name === 'string' ? meta.script_name : undefined;
  const ms = typeof meta.ms === 'number' ? meta.ms : undefined;
  const status = typeof r.status === 'string' ? r.status : 'unknown';
  const id = typeof r.id === 'string' ? r.id : undefined;
  const parts = [
    id ? `id=${id}` : null,
    `status=${status}`,
    name ? `script=${name}` : null,
    ms != null ? `ms=${Math.round(ms)}` : null,
    typeof r.error === 'string' && r.error ? `error=${r.error}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function applyResultsSet(payload: Record<string, unknown>): void {
  if (disposed) return;
  const focusEl = document.getElementById('results-focus');
  const bodyEl = document.getElementById('results-body');
  const emptyEl = document.getElementById('results-empty');
  const focusId = payload.focusId;
  const lastRun = payload.lastRun;
  const strategyReport = payload.strategyReport;
  const kind = panelKind();

  if (focusEl) {
    focusEl.textContent =
      focusId == null || focusId === ''
        ? 'No run focused'
        : `Focus: ${String(focusId)} — ${summarizeLastRun(lastRun)}`;
  }

  const content =
    kind === 'strategy'
      ? strategyReport != null
        ? safeJson(strategyReport)
        : lastRun != null
          ? safeJson({
              note: 'No strategyReport on this run',
              lastRun,
            })
          : null
      : lastRun != null
        ? safeJson(lastRun)
        : null;

  if (bodyEl && emptyEl) {
    if (content == null) {
      bodyEl.hidden = true;
      bodyEl.textContent = '';
      emptyEl.hidden = false;
    } else {
      bodyEl.hidden = false;
      bodyEl.textContent = content;
      emptyEl.hidden = true;
    }
  }
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
