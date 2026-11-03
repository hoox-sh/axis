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
 * Semantic HTML for the Library studio. Icons are inline SVG (currentColor).
 */

import {
  categoryOptions,
  filteredCards,
  formatScriptCount,
  formatShowing,
  kindCounts,
  kindLabel,
  overlayLabel,
  type LibraryCard,
  type LibraryKind,
  type LibraryKindFilter,
  type LibraryViewState,
} from './state';

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svg(inner: string, className: string): string {
  return `<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${inner}</svg>`;
}

export function libraryMarkSvg(): string {
  return svg(
    '<path fill="currentColor" d="M3 1.75h7.1c.9 0 1.65.75 1.65 1.65V13.2c0 .35-.4.55-.68.35L8.2 11.7 5.33 13.55c-.28.2-.68 0-.68-.35V3.4c0-.9.75-1.65 1.65-1.65H3z"/><path fill="currentColor" d="M3 2.6h1.15v10.15l2.15-1.4c.4-.26.92-.26 1.32 0l2.15 1.4V3.4c0-.4-.35-.75-.75-.75H3.9"/>',
    'library-icon',
  );
}

export function searchSvg(): string {
  return svg(
    '<circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" stroke-width="1.4"/><path fill="currentColor" d="M10.2 10.2 13.4 13.4l-1.05 1.05-3.2-3.2z"/>',
    'library-icon library-icon--search',
  );
}

export function kindSvg(kind: LibraryKind | 'all'): string {
  if (kind === 'strategy') {
    return svg(
      '<path fill="currentColor" d="M3 12.5h1.6V6.2H3zm4.2 0h1.6V3.4H7.2zm4.2 0H13V8.1h-1.6z"/><path fill="currentColor" d="M2.2 13.6h11.6v1.1H2.2z"/>',
      'library-icon',
    );
  }
  if (kind === 'indicator') {
    return svg(
      '<path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.5 11.5 5.2 7.6l2.3 2.2L14 3.2"/><path fill="currentColor" d="M12.1 2.6h2.6V5.2l-1.2-1.15z"/>',
      'library-icon',
    );
  }
  return svg(
    '<path fill="currentColor" d="M2 2h5v5H2zm7 0h5v5H9zM2 9h5v5H2zm7 0h5v5H9z"/>',
    'library-icon',
  );
}

function overlaySvg(overlay: boolean): string {
  if (overlay) {
    return svg(
      '<path fill="currentColor" d="M3 5.2 8 2.6l5 2.6v1.3L8 9.1 3 6.5z"/><path fill="currentColor" opacity="0.65" d="M3 8.4 8 11l5-2.6v1.3L8 12.3 3 9.7z"/>',
      'library-icon library-icon--meta',
    );
  }
  return svg(
    '<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="currentColor" d="M3.2 8.1h9.6v4.3H3.2z"/>',
    'library-icon library-icon--meta',
  );
}

function applySvg(): string {
  return svg(
    '<path fill="currentColor" d="M4 2.6v10.8l9-5.4z"/>',
    'library-icon library-icon--btn',
  );
}

function emptySvg(): string {
  return svg(
    '<path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 2.2h6.4c.7 0 1.3.6 1.3 1.3v9.2L8 11.1 5.3 12.7V3.5c0-.7.6-1.3 1.3-1.3"/><path fill="currentColor" d="M4.2 5.2h5.1v1.1H4.2zm0 2.2h5.1v1.1H4.2z"/>',
    'library-icon library-icon--empty',
  );
}

function chip(
  attrs: string,
  icon: string,
  label: string,
  count: number,
  selected: boolean,
): string {
  return `<button type="button" role="radio" class="library-chip${selected ? ' is-selected' : ''}" aria-checked="${selected ? 'true' : 'false'}" ${attrs}><span class="library-chip__icon" aria-hidden="true">${icon}</span><span class="library-chip__label">${escapeHtml(label)}</span><span class="library-chip__count">${count}</span></button>`;
}

function kindChips(state: LibraryViewState): string {
  const counts = kindCounts(state);
  const order: LibraryKindFilter[] = ['all', 'indicator', 'strategy'];
  const labels: Record<LibraryKindFilter, string> = {
    all: 'All',
    indicator: 'Indicator',
    strategy: 'Strategy',
  };
  const buttons = order
    .map((id) =>
      chip(
        `data-kind-filter="${id}"`,
        kindSvg(id),
        labels[id],
        counts[id],
        state.kind === id,
      ),
    )
    .join('');
  return `<div class="library-chips" role="radiogroup" aria-label="Script kind">${buttons}</div>`;
}

function categoryChips(state: LibraryViewState): string {
  const options = categoryOptions(state);
  const total = options.reduce((sum, row) => sum + row.count, 0);
  const all = chip(
    'data-category-filter="all"',
    kindSvg('all'),
    'All',
    total,
    state.category === 'all',
  );
  const rest = options
    .map((row) =>
      chip(
        `data-category-filter="${escapeHtml(row.id)}"`,
        '',
        row.label,
        row.count,
        state.category === row.id,
      ),
    )
    .join('');
  return `<div class="library-chips library-chips--category" role="radiogroup" aria-label="Category">${all}${rest}</div>`;
}

function tagsHtml(tags: readonly string[]): string {
  if (tags.length === 0) return '';
  const items = tags
    .map((tag) => `<li class="library-tag">${escapeHtml(tag)}</li>`)
    .join('');
  return `<ul class="library-tags" aria-label="Tags">${items}</ul>`;
}

function cardHtml(card: LibraryCard): string {
  const id = escapeHtml(card.id);
  const title = escapeHtml(card.title);
  const shorttitle = escapeHtml(card.shorttitle);
  const kind = card.kind;
  const kindText = escapeHtml(kindLabel(kind));
  const categoryText = escapeHtml(card.categoryLabel.trim() || card.category.trim() || 'Uncategorized');
  const place = escapeHtml(overlayLabel(card.overlay));
  const desc = card.description.trim()
    ? `<p class="library-card__desc">${escapeHtml(card.description)}</p>`
    : '';
  const covers = card.covers.trim()
    ? `<p class="library-card__covers"><span class="library-card__k">Covers</span> ${escapeHtml(card.covers)}</p>`
    : '';
  const titleId = `library-card-${card.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return `<article class="library-card library-card--${kind}" tabindex="0" data-id="${id}" data-kind="${kind}" aria-labelledby="${escapeHtml(titleId)}" aria-description="Copies id ${id}">
  <header class="library-card__head">
    <span class="library-card__kind-icon" title="${kindText}">${kindSvg(kind)}</span>
    <div class="library-card__titles">
      <h2 class="library-card__title" id="${escapeHtml(titleId)}">${title}</h2>
      <p class="library-card__short">${shorttitle}</p>
    </div>
    <code class="library-card__id" title="${id}">${id}</code>
  </header>
  <ul class="library-card__meta">
    <li class="library-meta library-meta--${kind}">${kindSvg(kind)}<span>${kindText}</span></li>
    <li class="library-meta">${escapeHtml(categoryText)}</li>
    <li class="library-meta">${overlaySvg(card.overlay)}<span>${place}</span></li>
  </ul>
  ${desc}
  ${covers}
  ${tagsHtml(card.tags)}
  <div class="library-card__actions">
    <span class="library-card__flash" aria-hidden="true">Copied</span>
    <p class="library-card__hint">Click the card to copy the id</p>
    <button type="button" class="library-apply" data-action="apply" data-id="${id}" aria-label="Apply ${title}" title="Apply ${title}">
      <span class="library-apply__label">${applySvg()}<span>Apply</span></span>
      <span class="library-apply__sent">Sent</span>
    </button>
  </div>
</article>`;
}

function banner(error: string): string {
  if (!error) return '';
  return `<p class="library-banner" role="status"><span class="library-banner__k">Catalog</span> ${escapeHtml(error)}</p>`;
}

function emptyState(state: LibraryViewState, showing: number): string {
  if (!state.loaded) {
    return `<section class="library-empty" role="status">
      ${emptySvg()}
      <h2 class="library-empty__title">Loading builtin scripts</h2>
      <p>The studio reads the offline catalog shipped in this extension. Nothing is fetched from the network.</p>
    </section>`;
  }
  if (state.cards.length === 0) {
    const title = state.catalogError ? 'Builtin catalog unavailable' : 'No builtin scripts';
    const detail = state.catalogError
      ? escapeHtml(state.catalogError)
      : 'The catalog file parsed, but it did not contain any usable scripts.';
    return `<section class="library-empty" role="status">
      ${emptySvg()}
      <h2 class="library-empty__title">${escapeHtml(title)}</h2>
      <p class="library-empty__error">${detail}</p>
      <p>AXIS Library lists first-party builtins from <code>media/builtins/catalog.json</code> inside the extension install. Reload the window after that file is restored. Apply still opens an untitled Pine document for the script you pick.</p>
      <dl class="library-empty__facts">
        <div><dt>View</dt><dd><code>axis.library</code></dd></div>
        <div><dt>Catalog</dt><dd><code>media/builtins/catalog.json</code></dd></div>
        <div><dt>Schema</dt><dd><code>axis.builtins.v1</code></dd></div>
        <div><dt>Scripts</dt><dd>${formatScriptCount(0)}</dd></div>
      </dl>
    </section>`;
  }
  if (showing === 0) {
    const bits = [`kind ${state.kind === 'all' ? 'All' : kindLabel(state.kind)}`];
    if (state.category !== 'all') bits.push(`category ${state.category}`);
    const q = state.query.trim();
    const queryBit = q ? ` matching “${escapeHtml(q)}”` : '';
    return `<section class="library-empty" role="status">
      ${searchSvg()}
      <h2 class="library-empty__title">No scripts match</h2>
      <p>Nothing in the offline catalog is visible with ${escapeHtml(bits.join(', '))}${queryBit}. Search checks title, short title, id, tags, and category.</p>
      <p class="library-empty__counts">${escapeHtml(formatScriptCount(state.cards.length))} in the catalog, ${escapeHtml(formatShowing(0))}.</p>
      <button type="button" class="library-clear" data-action="clear">Clear filters</button>
    </section>`;
  }
  return '';
}

export function libraryViewHtml(state: LibraryViewState): string {
  const total = state.cards.length;
  const visible = filteredCards(state);
  const showing = visible.length;
  const indicatorN = state.cards.filter((card) => card.kind === 'indicator').length;
  const strategyN = state.cards.filter((card) => card.kind === 'strategy').length;
  const body =
    showing === 0
      ? emptyState(state, showing)
      : `<div class="library-cards">${visible.map((card) => cardHtml(card)).join('')}</div>`;
  const errBanner = state.loaded && state.cards.length > 0 ? banner(state.catalogError) : '';
  return `<div class="library-shell">
  <header class="library-header">
    <div class="library-header__top">
      <h1 class="library-title">${libraryMarkSvg()}<span>Library</span></h1>
      <p class="library-counts">
        <span id="library-total">${escapeHtml(formatScriptCount(total))}</span>
        <span id="library-showing">${escapeHtml(formatShowing(showing))}</span>
      </p>
    </div>
    <p class="library-sub">${indicatorN} indicators · ${strategyN} strategies · offline catalog</p>
    <div class="library-search-wrap" role="search">
      ${searchSvg()}
      <input id="library-search" class="library-search" type="search" name="library-search" value="${escapeHtml(state.query)}" placeholder="Filter by title, id, tag, or category" aria-label="Filter scripts by title, short title, id, tags, or category" autocomplete="off" spellcheck="false" />
    </div>
    ${kindChips(state)}
    ${categoryChips(state)}
  </header>
  <div class="library-body">
    ${errBanner}
    ${body}
  </div>
</div>`;
}
