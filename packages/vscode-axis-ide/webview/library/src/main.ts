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
 * AXIS Library studio: library.ready → library.init.
 * Card click copies the id (1.2s "Copied"). Apply posts library.apply.
 */

import './style.css';
import { libraryViewHtml } from './render';
import {
  COPY_FLASH_MS,
  applyCatalog,
  clearFilters,
  decodeHostMessage,
  initialLibraryState,
  isKindFilter,
  readPersistedLibraryUi,
  setCategoryFilter,
  setKindFilter,
  setSearchQuery,
  type LibraryViewState,
} from './state';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let apiRef: VsCodeApi | null = null;
let state: LibraryViewState = initialLibraryState();
let root: HTMLElement | null = null;

let copyFlashId: string | null = null;
let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;
let applyFlashId: string | null = null;
let applyFlashTimer: ReturnType<typeof setTimeout> | null = null;

type FocusRestore =
  | { type: 'search'; start: number | null; end: number | null }
  | { type: 'kind'; id: string }
  | { type: 'category'; id: string }
  | { type: 'apply'; id: string }
  | { type: 'card'; id: string }
  | { type: 'clear' }
  | null;

function ensureRoot(): HTMLElement {
  const existing = document.getElementById('library-root');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'library-root';
  el.className = 'library-root';
  document.body.appendChild(el);
  return el;
}

function ensureLive(): HTMLElement {
  const existing = document.getElementById('library-live');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'library-live';
  el.className = 'library-live';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  document.body.prepend(el);
  return el;
}

function persist(): void {
  if (!apiRef || disposed) return;
  try {
    apiRef.setState({
      query: state.query,
      kind: state.kind,
      category: state.category,
    });
  } catch {
    // host state is optional
  }
}

function captureFocus(): FocusRestore {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !root?.contains(el)) return null;
  if (el instanceof HTMLInputElement && el.id === 'library-search') {
    return { type: 'search', start: el.selectionStart, end: el.selectionEnd };
  }
  if (el.dataset.kindFilter) return { type: 'kind', id: el.dataset.kindFilter };
  if (el.dataset.categoryFilter) return { type: 'category', id: el.dataset.categoryFilter };
  if (el.dataset.action === 'apply' && el.dataset.id) return { type: 'apply', id: el.dataset.id };
  if (el.dataset.action === 'clear') return { type: 'clear' };
  const card = el.closest('article.library-card');
  if (card instanceof HTMLElement && card.dataset.id) return { type: 'card', id: card.dataset.id };
  return null;
}

function restoreFocus(focus: FocusRestore): void {
  if (!focus || !root || disposed) return;
  let el: Element | null = null;
  try {
    if (focus.type === 'search') {
      const input = root.querySelector('#library-search');
      if (input instanceof HTMLInputElement) {
        input.focus();
        if (focus.start != null && focus.end != null) input.setSelectionRange(focus.start, focus.end);
      }
      return;
    }
    if (focus.type === 'kind') {
      el = root.querySelector(`[data-kind-filter="${CSS.escape(focus.id)}"]`);
    } else if (focus.type === 'category') {
      el = root.querySelector(`[data-category-filter="${CSS.escape(focus.id)}"]`);
    } else if (focus.type === 'apply') {
      el = root.querySelector(`[data-action="apply"][data-id="${CSS.escape(focus.id)}"]`);
    } else if (focus.type === 'clear') {
      el = root.querySelector('[data-action="clear"]');
    } else {
      el = root.querySelector(`article.library-card[data-id="${CSS.escape(focus.id)}"]`);
    }
  } catch {
    el = null;
  }
  if (el instanceof HTMLElement) el.focus();
}

function restoreFlashes(): void {
  if (!root) return;
  if (copyFlashId) {
    const card = cardEl(copyFlashId);
    card?.classList.add('is-copied');
  }
  if (applyFlashId) {
    const button = applyButton(applyFlashId);
    button?.classList.add('is-sent');
  }
}

function paint(): void {
  if (disposed || !root) return;
  const focus = captureFocus();
  root.innerHTML = libraryViewHtml(state);
  restoreFlashes();
  restoreFocus(focus);
}

function cardEl(id: string): HTMLElement | null {
  if (!root) return null;
  try {
    const el = root.querySelector(`article.library-card[data-id="${CSS.escape(id)}"]`);
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

function applyButton(id: string): HTMLButtonElement | null {
  if (!root) return null;
  try {
    const el = root.querySelector(`[data-action="apply"][data-id="${CSS.escape(id)}"]`);
    return el instanceof HTMLButtonElement ? el : null;
  } catch {
    return null;
  }
}

function flashCopied(id: string): void {
  const live = ensureLive();
  live.textContent = '';
  window.requestAnimationFrame(() => {
    if (!disposed) live.textContent = 'Copied';
  });
  if (copyFlashId && copyFlashId !== id) cardEl(copyFlashId)?.classList.remove('is-copied');
  copyFlashId = id;
  cardEl(id)?.classList.add('is-copied');
  if (copyFlashTimer) clearTimeout(copyFlashTimer);
  copyFlashTimer = setTimeout(() => {
    copyFlashTimer = null;
    const prev = copyFlashId;
    copyFlashId = null;
    if (!disposed && prev) cardEl(prev)?.classList.remove('is-copied');
    const region = document.getElementById('library-live');
    if (region && region.textContent === 'Copied') region.textContent = '';
  }, COPY_FLASH_MS);
}

function flashApply(id: string): void {
  if (applyFlashId && applyFlashId !== id) applyButton(applyFlashId)?.classList.remove('is-sent');
  applyFlashId = id;
  applyButton(id)?.classList.add('is-sent');
  if (applyFlashTimer) clearTimeout(applyFlashTimer);
  applyFlashTimer = setTimeout(() => {
    applyFlashTimer = null;
    const prev = applyFlashId;
    applyFlashId = null;
    if (!disposed && prev) applyButton(prev)?.classList.remove('is-sent');
  }, COPY_FLASH_MS);
}

function post(message: unknown): void {
  if (disposed || !apiRef) return;
  try {
    apiRef.postMessage(message);
  } catch {
    // host may be gone
  }
}

function copyId(id: string): void {
  const text = id.trim();
  if (!text) return;
  const fallbackCopy = (): void => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch {
      // clipboard unavailable
    }
  };
  try {
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      void clip.writeText(text).catch(() => {
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }
  } catch {
    fallbackCopy();
  }
  post({ type: 'library.copy', id: text });
  flashCopied(text);
}

function postApply(id: string): void {
  const text = id.trim();
  if (!text) return;
  post({ type: 'library.apply', id: text });
  flashApply(text);
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded) return;
  state = applyCatalog(state, decoded.cards, decoded.catalogError);
  paint();
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el.isContentEditable;
}

function focusSearch(): void {
  const el = root?.querySelector('#library-search');
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

function onClick(event: Event): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const kindBtn = target.closest('[data-kind-filter]');
  if (kindBtn instanceof HTMLElement) {
    const kind = kindBtn.getAttribute('data-kind-filter');
    if (isKindFilter(kind)) {
      state = setKindFilter(state, kind);
      persist();
      paint();
    }
    return;
  }
  const categoryBtn = target.closest('[data-category-filter]');
  if (categoryBtn instanceof HTMLElement) {
    state = setCategoryFilter(state, categoryBtn.getAttribute('data-category-filter') ?? 'all');
    persist();
    paint();
    return;
  }
  const clear = target.closest('[data-action="clear"]');
  if (clear instanceof HTMLElement) {
    state = clearFilters(state);
    persist();
    paint();
    return;
  }
  const apply = target.closest('[data-action="apply"]');
  if (apply instanceof HTMLButtonElement) {
    event.preventDefault();
    event.stopPropagation();
    postApply(apply.getAttribute('data-id') ?? '');
    return;
  }
  const card = target.closest('article.library-card');
  if (card instanceof HTMLElement) {
    copyId(card.getAttribute('data-id') ?? '');
  }
}

function onInput(event: Event): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id !== 'library-search') return;
  state = setSearchQuery(state, target.value);
  persist();
  paint();
}

function onGlobalKey(event: KeyboardEvent): void {
  if (disposed) return;
  if ((event.key === 'f' || event.key === 'F') && (event.ctrlKey || event.metaKey) && !event.altKey) {
    event.preventDefault();
    focusSearch();
    return;
  }
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) {
    event.preventDefault();
    focusSearch();
  }
}

function moveRadio(current: HTMLElement, key: string): void {
  const group = current.closest('[role="radiogroup"]');
  if (!(group instanceof HTMLElement)) return;
  const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const idx = buttons.indexOf(current as HTMLButtonElement);
  if (idx < 0 || buttons.length === 0) return;
  let next = idx;
  if (key === 'ArrowRight' || key === 'ArrowDown') next = (idx + 1) % buttons.length;
  else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (idx - 1 + buttons.length) % buttons.length;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = buttons.length - 1;
  else return;
  buttons[next]?.focus();
  buttons[next]?.click();
}

function onKeyDown(event: KeyboardEvent): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !root?.contains(target)) return;
  if (target.getAttribute('role') === 'radio') {
    if (
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      moveRadio(target, event.key);
    }
    return;
  }
  if (target.classList.contains('library-card') && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    copyId(target.getAttribute('data-id') ?? '');
  }
}

function main(): void {
  let api: VsCodeApi;
  try {
    api = acquireVsCodeApi();
  } catch {
    root = ensureRoot();
    root.textContent = 'Library studio could not reach the AXIS host.';
    return;
  }
  apiRef = api;
  try {
    state = initialLibraryState(readPersistedLibraryUi(api.getState()));
  } catch {
    state = initialLibraryState();
  }
  root = ensureRoot();
  ensureLive();
  window.addEventListener('message', onHostMessage);
  window.addEventListener('keydown', onGlobalKey);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKeyDown);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      apiRef = null;
      root = null;
      copyFlashId = null;
      applyFlashId = null;
      if (copyFlashTimer) clearTimeout(copyFlashTimer);
      if (applyFlashTimer) clearTimeout(applyFlashTimer);
      copyFlashTimer = null;
      applyFlashTimer = null;
    },
    { once: true },
  );
  paint();
  post({ type: 'library.ready' });
}

main();
