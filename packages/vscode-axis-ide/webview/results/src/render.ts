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

import type { ResultsMetaChip, ResultsRow, ResultsView } from './state';
import { filterRows } from './state';

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
      return `<div class="results-row${err}" data-row="${key}" tabindex="0"><dt>${label}</dt><dd>${value}</dd></div>`;
    })
    .join('');
}

export function metaChipsInnerHtml(chips: ResultsMetaChip[]): string {
  if (!Array.isArray(chips) || chips.length === 0) return '';
  return chips
    .map((chip) => {
      const key = escapeHtml(chip.key);
      const label = escapeHtml(chip.label);
      const value = escapeHtml(chip.value);
      return `<span class="results-chip" data-chip="${key}"><span class="results-chip__value">${value}</span><span class="results-chip__label">${label}</span></span>`;
    })
    .join('');
}

export function kpiCardsInnerHtml(rows: ResultsRow[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows
    .map((row) => {
      const key = escapeHtml(row.key);
      const label = escapeHtml(row.label);
      const value = escapeHtml(row.value);
      return `<div class="results-kpi" data-kpi="${key}" tabindex="0"><span class="results-kpi__label">${label}</span><span class="results-kpi__value">${value}</span></div>`;
    })
    .join('');
}

export function resultsCardHtml(view: ResultsView): string {
  const kpis =
    view.kpiRows.length > 0
      ? `<div class="results-kpis" id="results-kpis">${kpiCardsInnerHtml(view.kpiRows)}</div>`
      : '';
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
  return `${kpis}<dl class="results-rows" id="results-rows">${rows}</dl>${snippet}`;
}

export type ResultsDom = {
  title: HTMLElement | null;
  status: HTMLElement | null;
  focus: HTMLElement | null;
  time: HTMLElement | null;
  meta: HTMLElement | null;
  copyId: HTMLElement | null;
  focusProfiler: HTMLElement | null;
  focusLogs: HTMLElement | null;
  searchWrap: HTMLElement | null;
  search: HTMLInputElement | null;
  card: HTMLElement | null;
  kpis: HTMLElement | null;
  rows: HTMLElement | null;
  strategy: HTMLElement | null;
  strategyTitle: HTMLElement | null;
  strategyEmpty: HTMLElement | null;
  strategyRows: HTMLElement | null;
  empty: HTMLElement | null;
  emptyTitle: HTMLElement | null;
  emptyHint: HTMLElement | null;
  live: HTMLElement | null;
};

function asSearchInput(el: Element | null): HTMLInputElement | null {
  if (!el) return null;
  // Avoid relying on HTMLInputElement in non-DOM test hosts.
  if (typeof (el as HTMLInputElement).value === 'string' && 'focus' in el) {
    return el as HTMLInputElement;
  }
  return null;
}

export function queryResultsDom(root: ParentNode): ResultsDom {
  return {
    title: root.querySelector('#results-title'),
    status: root.querySelector('#results-status'),
    focus: root.querySelector('#results-focus'),
    time: root.querySelector('#results-time'),
    meta: root.querySelector('#results-meta'),
    copyId: root.querySelector('#results-copy-id'),
    focusProfiler: root.querySelector('#results-focus-profiler'),
    focusLogs: root.querySelector('#results-focus-logs'),
    searchWrap: root.querySelector('#results-search-wrap'),
    search: asSearchInput(root.querySelector('#results-search')),
    card: root.querySelector('#results-card'),
    kpis: root.querySelector('#results-kpis'),
    rows: root.querySelector('#results-rows'),
    strategy: root.querySelector('#results-strategy'),
    strategyTitle: root.querySelector('#results-strategy-title'),
    strategyEmpty: root.querySelector('#results-strategy-empty'),
    strategyRows: root.querySelector('#results-strategy-rows'),
    empty: root.querySelector('#results-empty'),
    emptyTitle: root.querySelector('#results-empty-title'),
    emptyHint: root.querySelector('#results-empty-hint'),
    live: root.querySelector('#results-live'),
  };
}

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  el.hidden = hidden;
}

function setLive(dom: ResultsDom, text: string): void {
  if (!dom.live) return;
  // Retrigger polite announcements when the same status repeats.
  if (dom.live.textContent === text) dom.live.textContent = '';
  dom.live.textContent = text;
}

/** Paint filtered row lists without rewriting the whole card. */
export function paintFilteredRows(dom: ResultsDom, view: ResultsView, query: string): void {
  const q = String(query ?? '');
  if (dom.rows) {
    try {
      dom.rows.innerHTML = rowsInnerHtml(filterRows(view.rows, q));
    } catch {
      dom.rows.textContent = '';
    }
  }
  if (dom.strategyRows) {
    try {
      dom.strategyRows.innerHTML = rowsInnerHtml(filterRows(view.strategyRows, q));
    } catch {
      dom.strategyRows.textContent = '';
    }
  }
  if (dom.kpis) {
    try {
      const kpis = filterRows(view.kpiRows, q);
      dom.kpis.innerHTML = kpiCardsInnerHtml(kpis);
      setHidden(dom.kpis, view.empty || kpis.length === 0);
    } catch {
      dom.kpis.textContent = '';
    }
  }
}

/** Fill static Results / Strategy hooks. Keeps `#results-status` so aria-live can announce. */
export function paintResults(dom: ResultsDom, view: ResultsView, query = ''): void {
  if (dom.title) dom.title.textContent = view.title;
  if (dom.status) {
    dom.status.textContent = view.statusLabel;
    dom.status.setAttribute('data-status', view.status);
    dom.status.setAttribute('aria-label', `Status: ${view.statusLabel}`);
    dom.status.className = `results-status results-status--${view.status}`;
  }
  if (dom.focus) dom.focus.textContent = view.focusLine;

  if (dom.time) {
    if (view.relativeTime || view.absoluteTime) {
      const rel = view.relativeTime;
      const abs = view.absoluteTime;
      dom.time.textContent = rel && abs ? `${rel} · ${abs}` : rel || abs;
      dom.time.setAttribute('title', abs || rel);
      setHidden(dom.time, false);
    } else {
      dom.time.textContent = '';
      setHidden(dom.time, true);
    }
  }

  if (dom.meta) {
    try {
      dom.meta.innerHTML = metaChipsInnerHtml(view.metaChips);
    } catch {
      dom.meta.textContent = '';
    }
    setHidden(dom.meta, view.empty || view.metaChips.length === 0);
  }

  const hasRun = !view.empty && !!view.runId;
  if (dom.copyId) {
    setHidden(dom.copyId, !hasRun);
    if (view.runId) dom.copyId.setAttribute('data-run-id', view.runId);
    else dom.copyId.removeAttribute('data-run-id');
  }
  setHidden(dom.focusProfiler, !hasRun);
  setHidden(dom.focusLogs, !hasRun);
  setHidden(dom.searchWrap, view.empty);

  if (dom.emptyTitle) dom.emptyTitle.textContent = view.emptyTitle;
  if (dom.emptyHint) dom.emptyHint.textContent = view.emptyMessage;
  if (dom.empty) {
    if (!dom.emptyTitle && !dom.emptyHint) {
      dom.empty.textContent = view.emptyMessage;
    }
    setHidden(dom.empty, !view.empty);
  }

  setHidden(dom.card, view.empty);
  paintFilteredRows(dom, view, query);

  const showStrategy = !view.empty && view.showStrategy;
  setHidden(dom.strategy, !showStrategy);
  if (dom.strategyTitle) dom.strategyTitle.textContent = 'Strategy';
  if (dom.strategyEmpty) {
    dom.strategyEmpty.textContent = view.strategyNote ?? '';
    setHidden(dom.strategyEmpty, !view.strategyNote);
  }

  setLive(dom, view.liveMessage);
}
