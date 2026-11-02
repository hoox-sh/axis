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
 * Semantic HTML fragments for Results / Strategy cards (VS Code tokens in CSS).
 */

import type { ResultsRow, ResultsView } from './state';

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function rowsInnerHtml(rows: ResultsRow[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows
    .map((row) => {
      const key = escapeHtml(row.key);
      const label = escapeHtml(row.label);
      const value = escapeHtml(row.value);
      const err = row.key === 'error' ? ' is-error' : '';
      return `<div class="results-row${err}" data-row="${key}"><dt>${label}</dt><dd>${value}</dd></div>`;
    })
    .join('');
}

export function resultsCardHtml(view: ResultsView): string {
  const rows = rowsInnerHtml(view.rows);
  const snippet = view.showStrategy
    ? `<div class="results-strategy" id="results-strategy">
      <h2 class="results-strategy__title" id="results-strategy-title">Strategy</h2>
      ${
        view.strategyNote
          ? `<p class="results-strategy__empty" id="results-strategy-empty">${escapeHtml(view.strategyNote)}</p>`
          : ''
      }
      <dl class="results-rows results-rows--strategy" id="results-strategy-rows">${rowsInnerHtml(view.strategyRows)}</dl>
    </div>`
    : '';
  return `<dl class="results-rows" id="results-rows">${rows}</dl>${snippet}`;
}

export type ResultsDom = {
  title: HTMLElement | null;
  status: HTMLElement | null;
  focus: HTMLElement | null;
  card: HTMLElement | null;
  rows: HTMLElement | null;
  strategy: HTMLElement | null;
  strategyTitle: HTMLElement | null;
  strategyEmpty: HTMLElement | null;
  strategyRows: HTMLElement | null;
  empty: HTMLElement | null;
};

export function queryResultsDom(root: ParentNode): ResultsDom {
  return {
    title: root.querySelector('#results-title'),
    status: root.querySelector('#results-status'),
    focus: root.querySelector('#results-focus'),
    card: root.querySelector('#results-card'),
    rows: root.querySelector('#results-rows'),
    strategy: root.querySelector('#results-strategy'),
    strategyTitle: root.querySelector('#results-strategy-title'),
    strategyEmpty: root.querySelector('#results-strategy-empty'),
    strategyRows: root.querySelector('#results-strategy-rows'),
    empty: root.querySelector('#results-empty'),
  };
}

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  el.hidden = hidden;
}

/** Fill static Results / Strategy hooks. Keeps `#results-status` so aria-live can announce. */
export function paintResults(dom: ResultsDom, view: ResultsView): void {
  if (dom.title) dom.title.textContent = view.title;
  if (dom.status) {
    dom.status.textContent = view.statusLabel;
    dom.status.setAttribute('data-status', view.status);
    dom.status.setAttribute('aria-label', `Status: ${view.statusLabel}`);
    dom.status.className = `results-status results-status--${view.status}`;
  }
  if (dom.focus) dom.focus.textContent = view.focusLine;
  if (dom.empty) {
    dom.empty.textContent = view.emptyMessage;
    setHidden(dom.empty, !view.empty);
  }
  setHidden(dom.card, view.empty);
  if (dom.rows) {
    try {
      dom.rows.innerHTML = rowsInnerHtml(view.rows);
    } catch {
      dom.rows.textContent = '';
    }
  }
  const showStrategy = !view.empty && view.showStrategy;
  setHidden(dom.strategy, !showStrategy);
  if (dom.strategyTitle) dom.strategyTitle.textContent = 'Strategy';
  if (dom.strategyEmpty) {
    dom.strategyEmpty.textContent = view.strategyNote ?? '';
    setHidden(dom.strategyEmpty, !view.strategyNote);
  }
  if (dom.strategyRows) {
    try {
      dom.strategyRows.innerHTML = rowsInnerHtml(view.strategyRows);
    } catch {
      dom.strategyRows.textContent = '';
    }
  }
}
