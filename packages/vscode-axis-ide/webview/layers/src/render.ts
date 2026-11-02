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
 * Semantic Layers cards. Theme colors stay in style.css (`--vscode-*` only).
 */

import type { LayersSectionView, LayersViewState } from './state';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline marks, one per section title. Stroke uses currentColor. */
const SECTION_ICON: Record<string, string> = {
  Scripts:
    '<path d="M6 4.5 2.5 8 6 11.5"/><path d="M10 4.5 13.5 8 10 11.5"/>',
  Panes:
    '<rect x="2.5" y="2.5" width="11" height="4" rx="0.6"/><rect x="2.5" y="9.2" width="11" height="4.3" rx="0.6"/>',
  Overlays: '<path d="M2 12.5c2.2-4.8 3.5-4.8 5.4-1.2C9.2 14.2 10.4 14 14 5.5"/>',
  'On-chain':
    '<circle cx="4" cy="8" r="1.7"/><circle cx="12" cy="4.4" r="1.7"/><circle cx="12" cy="11.6" r="1.7"/><path d="M5.6 7.3 10.4 5.1"/><path d="M5.6 8.7 10.4 10.9"/>',
  Drawings: '<path d="M9.1 3.1 12.9 6.9 5.8 14H2.2v-3.6z"/><path d="M7.8 4.4 11.6 8.2"/>',
};

export type LayersDom = {
  summary: HTMLElement | null;
  live: HTMLElement | null;
  sections: HTMLElement | null;
  open: HTMLButtonElement | null;
};

export function queryLayersDom(root: ParentNode): LayersDom {
  const open = root.querySelector('#layers-open-chart');
  return {
    summary: root.querySelector('#layers-summary'),
    live: root.querySelector('#layers-live'),
    sections: root.querySelector('#layers-sections'),
    open: open instanceof HTMLButtonElement ? open : null,
  };
}

function iconSvg(title: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'layers-card__svg');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = SECTION_ICON[title] ?? SECTION_ICON.Scripts ?? '';
  return svg;
}

function itemsLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

function renderCard(section: LayersSectionView): HTMLElement {
  const card = document.createElement('section');
  card.className = 'layers-card';
  card.dataset.section = section.id;
  const headingId = `${section.id}-title`;
  card.setAttribute('aria-labelledby', headingId);

  const head = document.createElement('div');
  head.className = 'layers-card__head';

  const icon = document.createElement('span');
  icon.className = 'layers-card__icon';
  icon.append(iconSvg(section.title));

  const title = document.createElement('h2');
  title.className = 'layers-card__title';
  title.id = headingId;
  title.textContent = section.title;

  const role = document.createElement('p');
  role.className = 'layers-card__role';
  role.textContent = section.role;

  const count = document.createElement('p');
  count.className = 'layers-card__count';
  count.textContent = String(section.count);
  count.setAttribute('aria-label', `${section.title}: ${itemsLabel(section.count)}`);

  head.append(icon, title, role, count);
  card.append(head);

  if (section.rows.length > 0) {
    const list = document.createElement('ul');
    list.className = 'layers-rows';
    for (const row of section.rows) {
      const item = document.createElement('li');
      item.className = 'layers-row';
      item.dataset.row = row.id;
      const label = document.createElement('span');
      label.className = 'layers-row__label';
      label.textContent = row.label;
      item.append(label);
      if (row.detail) {
        const detail = document.createElement('span');
        detail.className = 'layers-row__detail';
        detail.textContent = row.detail;
        item.append(detail);
      }
      list.append(item);
    }
    card.append(list);
  } else {
    const empty = document.createElement('p');
    empty.className = 'layers-card__empty';
    empty.textContent = section.empty;
    card.append(empty);
  }
  return card;
}

export function renderSections(container: HTMLElement, sections: LayersSectionView[]): void {
  const frag = document.createDocumentFragment();
  for (const section of sections) frag.append(renderCard(section));
  container.replaceChildren(frag);
}

/**
 * Paint header, cards, and (on refresh) the polite live region.
 * The live text is exactly "Updated" so assistive tech can announce the refresh.
 */
export function paintLayers(dom: LayersDom, state: LayersViewState, announce: boolean): void {
  if (dom.summary) {
    dom.summary.textContent = `${itemsLabel(state.total)} · ${state.source}`;
  }
  if (dom.sections) renderSections(dom.sections, state.sections);
  if (!announce || !dom.live) return;
  const live = dom.live;
  live.textContent = '';
  requestAnimationFrame(() => {
    if (!live.isConnected) return;
    live.textContent = 'Updated';
  });
}
