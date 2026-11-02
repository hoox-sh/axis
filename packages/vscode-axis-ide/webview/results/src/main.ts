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
 * Local actions (`results.action`) stay off axis.webview.v1.
 */

import './style.css';
import { decodeHostMessage, PROTOCOL_VERSION } from './protocol';
import { paintFilteredRows, paintResults, queryResultsDom, type ResultsDom } from './render';
import { buildResultsView, type ResultsKind, type ResultsView } from './state';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let api: VsCodeApi | null = null;
let dom: ResultsDom | null = null;
let currentView: ResultsView | null = null;
let filterQuery = '';

function panelKind(): ResultsKind {
  const raw = document.body?.getAttribute('data-axis-results-kind');
  return raw === 'strategy' ? 'strategy' : 'results';
}

function postReady(vscode: VsCodeApi): void {
  if (disposed) return;
  vscode.postMessage({
    v: PROTOCOL_VERSION,
    type: 'results.ready',
    payload: {},
    ts: Date.now(),
  });
}

function postAction(kind: 'copyId' | 'focusProfiler' | 'focusLogs', text?: string): void {
  if (disposed || !api) return;
  if (kind === 'copyId') {
    const value = typeof text === 'string' ? text : '';
    if (!value.trim()) return;
    api.postMessage({ type: 'results.action', kind, text: value });
    return;
  }
  api.postMessage({ type: 'results.action', kind });
}

function applyResultsSet(payload: Record<string, unknown>): void {
  if (disposed) return;
  currentView = buildResultsView(panelKind(), payload);
  if (!dom) dom = queryResultsDom(document);
  paintResults(dom, currentView, filterQuery);
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  if (decoded.type === 'results.set') {
    applyResultsSet(decoded.payload);
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function focusSearch(): void {
  if (!dom?.search || dom.searchWrap?.hidden) return;
  dom.search.focus();
  try {
    dom.search.select();
  } catch {
    // ignore
  }
}

function clearSearch(): void {
  filterQuery = '';
  if (dom?.search) dom.search.value = '';
  if (currentView && dom) paintFilteredRows(dom, currentView, '');
}

function onKeyDown(event: KeyboardEvent): void {
  if (disposed) return;
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) {
    event.preventDefault();
    focusSearch();
    return;
  }
  if (event.key === 'Escape') {
    if (dom?.search && document.activeElement === dom.search) {
      event.preventDefault();
      clearSearch();
      dom.search.blur();
      return;
    }
    if (filterQuery) {
      event.preventDefault();
      clearSearch();
    }
  }
}

function onClick(event: MouseEvent): void {
  if (disposed || !api) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const btn = target.closest('[data-action]') as HTMLElement | null;
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  if (action === 'copyId') {
    const id = btn.getAttribute('data-run-id') || currentView?.runId || '';
    postAction('copyId', id);
    return;
  }
  if (action === 'focusProfiler') {
    postAction('focusProfiler');
    return;
  }
  if (action === 'focusLogs') {
    postAction('focusLogs');
  }
}

function onSearchInput(): void {
  if (disposed || !dom?.search || !currentView) return;
  filterQuery = dom.search.value;
  paintFilteredRows(dom, currentView, filterQuery);
}

function main(): void {
  api = acquireVsCodeApi();
  dom = queryResultsDom(document);
  window.addEventListener('message', onHostMessage);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('click', onClick);
  dom.search?.addEventListener('input', onSearchInput);
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
