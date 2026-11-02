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
 * Semantic HTML for the Plugins studio (VS Code tokens live in style.css).
 */

import {
  extraFacts,
  EMPTY_KIND_COPY,
  activeChips,
  emptyFilterMessage,
  formatActiveStatus,
  isPluginActive,
  KIND_LABELS,
  KIND_MARKS,
  KIND_TABS,
  kindRole,
  kindsToRender,
  pluginBadges,
  visiblePluginsForKind,
  type ActiveChip,
  type PluginBadge,
  type PluginsViewState,
} from './state';
import type { KindTab, PluginCard, PluginKind } from './protocol';

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeHtml(badge: PluginBadge): string {
  const text = escapeHtml(badge.text);
  return `<span class="plugin-badge plugin-badge--${badge.tone}">${text}</span>`;
}

function factsHtml(card: PluginCard): string {
  const facts = extraFacts(card.extra);
  if (facts.length === 0) return '';
  const rows = facts
    .map(
      (f) =>
        `<div class="plugin-card__fact"><dt>${escapeHtml(f.key)}</dt><dd>${escapeHtml(f.value)}</dd></div>`,
    )
    .join('');
  return `<dl class="plugin-card__facts">${rows}</dl>`;
}

function kindMarkHtml(tab: KindTab): string {
  if (tab === 'all') return '';
  return `<span class="plugins-kind-mark" aria-hidden="true">${escapeHtml(KIND_MARKS[tab])}</span>`;
}

function cardHtml(card: PluginCard, state: PluginsViewState): string {
  const active = isPluginActive(card, state.active);
  const badges = pluginBadges(card, state.active, state.flags)
    .map(badgeHtml)
    .join('');
  const desc = card.description
    ? `<p class="plugin-card__desc">${escapeHtml(card.description)}</p>`
    : '';
  const activateLabel = active ? 'Active' : 'Activate';
  const disabled = active ? ' disabled' : '';
  const activeClass = active ? ' is-active' : '';
  const nameId = `plugin-${card.kind}-${card.id}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const kindAttr = escapeHtml(card.kind);
  const idAttr = escapeHtml(card.id);
  return `<article class="plugin-card${activeClass}" tabindex="0" data-kind="${kindAttr}" data-id="${idAttr}" aria-labelledby="${nameId}">
  <header class="plugin-card__head">
    <div class="plugin-card__titles">
      <h3 class="plugin-card__name" id="${nameId}">${escapeHtml(card.name)}</h3>
      <code class="plugin-card__id" title="${idAttr}">${idAttr}</code>
    </div>
    <div class="plugin-card__badges">${badges}</div>
  </header>
  ${desc}
  ${factsHtml(card)}
  <div class="plugin-card__actions">
    <button type="button" class="plugin-card__copy" data-action="copy-id" data-kind="${kindAttr}" data-id="${idAttr}" aria-label="Copy id ${idAttr}" title="Copy id">Copy id</button>
    <button type="button" class="plugin-card__activate" data-action="activate" data-kind="${kindAttr}" data-id="${idAttr}"${disabled}>${activateLabel}</button>
  </div>
</article>`;
}

function sectionHtml(kind: PluginKind, state: PluginsViewState): string {
  const cards = visiblePluginsForKind(state, kind);
  const searching = state.query.trim().length > 0;
  if (searching && cards.length === 0 && state.tab === 'all') return '';
  const role = escapeHtml(kindRole(kind, cards));
  const count = String(cards.length);
  const emptyCopy = searching ? emptyFilterMessage(state.query) : EMPTY_KIND_COPY[kind];
  const body =
    cards.length === 0
      ? `<p class="plugins-empty">${escapeHtml(emptyCopy)}</p>`
      : `<div class="plugins-cards">${cards.map((c) => cardHtml(c, state)).join('')}</div>`;
  return `<section class="plugins-kind" data-kind="${kind}" aria-labelledby="kind-${kind}-title">
  <header class="plugins-kind__head">
    <div class="plugins-kind__title-row">
      ${kindMarkHtml(kind)}
      <h2 class="plugins-kind__title" id="kind-${kind}-title">${escapeHtml(KIND_LABELS[kind])}</h2>
      <span class="plugins-kind__count" aria-label="${count} plugins">${escapeHtml(count)}</span>
    </div>
    <p class="plugins-kind__role">${role}</p>
  </header>
  ${body}
</section>`;
}

function tabsHtml(tab: PluginsViewState['tab']): string {
  const buttons = KIND_TABS.map((id) => {
    const selected = id === tab;
    const label = KIND_LABELS[id];
    return `<button type="button" role="tab" id="tab-${id}" class="plugins-tabs__tab" data-tab="${id}" aria-label="${escapeHtml(label)}" aria-selected="${selected ? 'true' : 'false'}" tabindex="${selected ? '0' : '-1'}">${kindMarkHtml(id)}<span class="plugins-tabs__text">${escapeHtml(label)}</span></button>`;
  }).join('');
  return `<div class="plugins-tabs" role="tablist" aria-label="Plugin kinds">${buttons}</div>`;
}

function chipHtml(chip: ActiveChip): string {
  const label = KIND_LABELS[chip.tab];
  return `<button type="button" role="listitem" id="chip-${chip.kind}" class="plugins-chip" data-tab="${chip.tab}" data-chip="1" aria-label="Show ${escapeHtml(label)}, ${escapeHtml(chip.id)}"><span class="plugins-chip__mark" aria-hidden="true">${escapeHtml(chip.chip)}</span><span class="plugins-chip__id">${escapeHtml(chip.id)}</span></button>`;
}

function chipsHtml(state: PluginsViewState): string {
  const chips = activeChips(state.active);
  const status = escapeHtml(formatActiveStatus(state.active));
  if (chips.length === 0) {
    return `<p class="plugins-status" id="plugins-status">${status}</p>`;
  }
  return `<div class="plugins-chips" id="plugins-status" role="list" aria-label="${status}">${chips.map(chipHtml).join('')}</div>`;
}

function searchHtml(query: string): string {
  return `<div class="plugins-search-wrap" role="search">
    <input id="plugins-search" class="plugins-search" type="search" name="plugins-search" value="${escapeHtml(query)}" placeholder="Filter plugins" aria-label="Filter plugins by name, id, or description" autocomplete="off" spellcheck="false" />
  </div>`;
}

export function pluginsViewHtml(state: PluginsViewState): string {
  const kinds = kindsToRender(state.tab);
  const sections = kinds.map((k) => sectionHtml(k, state)).join('');
  const searching = state.query.trim().length > 0;
  const anyVisible = kinds.some((k) => visiblePluginsForKind(state, k).length > 0);
  const emptyFilter =
    searching && !anyVisible && state.plugins.length > 0 && state.tab === 'all'
      ? `<p class="plugins-empty">${escapeHtml(emptyFilterMessage(state.query))}</p>`
      : '';
  const waiting =
    !state.ready && state.plugins.length === 0
      ? `<p class="plugins-empty plugins-empty--waiting">Waiting for host catalog…</p>`
      : '';
  return `<div class="plugins-shell" data-axis-plugins-host="1">
  <header class="plugins-header">
    <div class="plugins-header__sticky">
      <div class="plugins-header__top">
        <h1 class="plugins-title">Plugins</h1>
        ${searchHtml(state.query)}
      </div>
      ${tabsHtml(state.tab)}
    </div>
    ${chipsHtml(state)}
  </header>
  <div class="plugins-body" id="plugins-body" role="tabpanel" aria-labelledby="tab-${state.tab}">
    ${waiting}${emptyFilter}${sections}
  </div>
</div>`;
}

export function renderPluginsView(root: HTMLElement, state: PluginsViewState): void {
  const active = document.activeElement;
  const inRoot = active instanceof HTMLElement && root.contains(active);
  const activeEl = inRoot && active instanceof HTMLElement ? active : null;
  const searchEl = root.querySelector('#plugins-search');
  const searchSel =
    searchEl instanceof HTMLInputElement && activeEl === searchEl
      ? { start: searchEl.selectionStart ?? 0, end: searchEl.selectionEnd ?? 0 }
      : null;
  const body = root.querySelector('#plugins-body');
  const scrollTop = body instanceof HTMLElement ? body.scrollTop : 0;
  const focusKey = activeEl
    ? activeEl.id ||
      `${activeEl.getAttribute('data-action') ?? ''}:${activeEl.getAttribute('data-kind') ?? ''}:${activeEl.getAttribute('data-id') ?? ''}:${activeEl.getAttribute('data-tab') ?? ''}`
    : '';

  root.innerHTML = pluginsViewHtml(state);

  const nextBody = root.querySelector('#plugins-body');
  if (nextBody instanceof HTMLElement) nextBody.scrollTop = scrollTop;

  let next: Element | null = null;
  if (searchSel) {
    next = root.querySelector('#plugins-search');
  } else if (focusKey && !focusKey.includes(':')) {
    next = root.querySelector(`#${CSS.escape(focusKey)}`);
  } else if (focusKey) {
    const [action, kind, id, tab] = focusKey.split(':');
    if (action === 'activate' && kind && id) {
      next = root.querySelector(
        `[data-action="activate"][data-kind="${CSS.escape(kind)}"][data-id="${CSS.escape(id)}"]`,
      );
    } else if (action === 'copy-id' && kind && id) {
      next = root.querySelector(
        `[data-action="copy-id"][data-kind="${CSS.escape(kind)}"][data-id="${CSS.escape(id)}"]`,
      );
    } else if (tab) {
      next = root.querySelector(`.plugins-tabs__tab[data-tab="${CSS.escape(tab)}"]`);
    }
  }
  if (next instanceof HTMLElement) {
    next.focus();
    if (searchSel && next instanceof HTMLInputElement) {
      try {
        next.setSelectionRange(searchSel.start, searchSel.end);
      } catch {
        // ignore
      }
    }
  }
}
