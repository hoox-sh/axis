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
  formatActiveStatus,
  isPluginActive,
  KIND_LABELS,
  KIND_TABS,
  kindRole,
  kindsToRender,
  pluginBadges,
  pluginsForKind,
  type PluginBadge,
  type PluginsViewState,
} from './state';
import type { PluginCard, PluginKind } from './protocol';

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
  return `<article class="plugin-card${activeClass}" tabindex="0" data-kind="${escapeHtml(card.kind)}" data-id="${escapeHtml(card.id)}" aria-labelledby="${nameId}">
  <header class="plugin-card__head">
    <div class="plugin-card__titles">
      <h3 class="plugin-card__name" id="${nameId}">${escapeHtml(card.name)}</h3>
      <code class="plugin-card__id" title="${escapeHtml(card.id)}">${escapeHtml(card.id)}</code>
    </div>
    <div class="plugin-card__badges">${badges}</div>
  </header>
  ${desc}
  ${factsHtml(card)}
  <div class="plugin-card__actions">
    <button type="button" class="plugin-card__activate" data-action="activate" data-kind="${escapeHtml(card.kind)}" data-id="${escapeHtml(card.id)}"${disabled}>${activateLabel}</button>
  </div>
</article>`;
}

function sectionHtml(kind: PluginKind, state: PluginsViewState): string {
  const cards = pluginsForKind(state.plugins, kind);
  const role = escapeHtml(kindRole(kind, cards));
  const count = String(cards.length);
  const body =
    cards.length === 0
      ? `<p class="plugins-empty">${escapeHtml(EMPTY_KIND_COPY[kind])}</p>`
      : `<div class="plugins-cards">${cards.map((c) => cardHtml(c, state)).join('')}</div>`;
  return `<section class="plugins-kind" data-kind="${kind}" aria-labelledby="kind-${kind}-title">
  <header class="plugins-kind__head">
    <div class="plugins-kind__title-row">
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
    return `<button type="button" role="tab" id="tab-${id}" class="plugins-tabs__tab" data-tab="${id}" aria-selected="${selected ? 'true' : 'false'}" tabindex="${selected ? '0' : '-1'}">${escapeHtml(KIND_LABELS[id])}</button>`;
  }).join('');
  return `<div class="plugins-tabs" role="tablist" aria-label="Plugin kinds">${buttons}</div>`;
}

export function pluginsViewHtml(state: PluginsViewState): string {
  const kinds = kindsToRender(state.tab);
  const sections = kinds.map((k) => sectionHtml(k, state)).join('');
  const waiting =
    !state.ready && state.plugins.length === 0
      ? `<p class="plugins-empty plugins-empty--waiting">Waiting for host catalog…</p>`
      : '';
  return `<div class="plugins-shell" data-axis-plugins-host="1">
  <header class="plugins-header">
    <h1 class="plugins-title">Plugins</h1>
    ${tabsHtml(state.tab)}
    <p class="plugins-status" id="plugins-status">${escapeHtml(formatActiveStatus(state.active))}</p>
  </header>
  <div class="plugins-body" id="plugins-body" role="tabpanel" aria-labelledby="tab-${state.tab}">
    ${waiting}${sections}
  </div>
</div>`;
}

export function renderPluginsView(root: HTMLElement, state: PluginsViewState): void {
  const activeId =
    document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
      ? document.activeElement.id ||
        `${document.activeElement.getAttribute('data-action') ?? ''}:${document.activeElement.getAttribute('data-kind') ?? ''}:${document.activeElement.getAttribute('data-id') ?? ''}:${document.activeElement.getAttribute('data-tab') ?? ''}`
      : '';
  root.innerHTML = pluginsViewHtml(state);
  if (!activeId) return;
  const [action, kind, id, tab] = activeId.split(':');
  let next: Element | null = null;
  if (activeId.startsWith('tab-')) {
    next = root.querySelector(`#${CSS.escape(activeId)}`);
  } else if (action === 'activate' && kind && id) {
    next = root.querySelector(
      `[data-action="activate"][data-kind="${CSS.escape(kind)}"][data-id="${CSS.escape(id)}"]`,
    );
  } else if (tab) {
    next = root.querySelector(`[data-tab="${CSS.escape(tab)}"]`);
  }
  if (next instanceof HTMLElement) next.focus();
}
