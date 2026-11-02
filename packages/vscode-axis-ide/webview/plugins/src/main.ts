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
 * AXIS Plugins studio webview: plugins.ready → plugins.init / plugins.state.
 */

import './style.css';
import {
  KIND_TABS,
  decodeHostMessage,
  encodePluginsActivate,
  encodePluginsReady,
  isKindTab,
  type KindTab,
} from './protocol';
import { renderPluginsView } from './render';
import {
  ACTIVATE_FLASH_MS,
  COPY_FLASH_MS,
  applyActivateFlash,
  applyCopiedFlash,
  applyPluginsHostMessage,
  initialPluginsState,
  setKindTab,
  setSearchQuery,
  tabFromPersisted,
  type PluginsViewState,
} from './state';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let disposed = false;
let apiRef: VsCodeApi | null = null;
let state: PluginsViewState = initialPluginsState();
let root: HTMLElement | null = null;

type FlashKey = { kind: string; id: string };

let copyFlashKey: FlashKey | null = null;
let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;
let activateFlashKey: FlashKey | null = null;
let activateFlashTimer: ReturnType<typeof setTimeout> | null = null;

function persistTab(api: VsCodeApi, tab: KindTab): void {
  try {
    api.setState({ tab });
  } catch {
    // host state is optional
  }
}

function liveEl(): HTMLElement | null {
  const el = root?.querySelector('#plugins-live');
  return el instanceof HTMLElement ? el : null;
}

function copyButton(kind: string, id: string): HTMLButtonElement | null {
  if (!root) return null;
  try {
    const el = root.querySelector(
      `[data-action="copy-id"][data-kind="${CSS.escape(kind)}"][data-id="${CSS.escape(id)}"]`,
    );
    return el instanceof HTMLButtonElement ? el : null;
  } catch {
    return null;
  }
}

function cardEl(kind: string, id: string): HTMLElement | null {
  if (!root) return null;
  try {
    const el = root.querySelector(
      `article.plugin-card[data-kind="${CSS.escape(kind)}"][data-id="${CSS.escape(id)}"]`,
    );
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

function restoreFlashes(): void {
  if (copyFlashKey) {
    applyCopiedFlash(copyButton(copyFlashKey.kind, copyFlashKey.id), liveEl(), true);
  }
  if (activateFlashKey) {
    applyActivateFlash(cardEl(activateFlashKey.kind, activateFlashKey.id), true);
  }
}

function startCopyFlash(button: HTMLButtonElement): void {
  const kind = button.getAttribute('data-kind') ?? '';
  const id = button.getAttribute('data-id') ?? '';
  if (copyFlashKey && (copyFlashKey.kind !== kind || copyFlashKey.id !== id)) {
    applyCopiedFlash(copyButton(copyFlashKey.kind, copyFlashKey.id), null, false);
  }
  copyFlashKey = { kind, id };
  applyCopiedFlash(button, liveEl(), true);
  if (copyFlashTimer) clearTimeout(copyFlashTimer);
  copyFlashTimer = setTimeout(() => {
    copyFlashTimer = null;
    const key = copyFlashKey;
    copyFlashKey = null;
    if (!disposed && key) applyCopiedFlash(copyButton(key.kind, key.id), liveEl(), false);
  }, COPY_FLASH_MS);
}

function startActivateFlash(kind: string, id: string): void {
  if (activateFlashKey) {
    applyActivateFlash(cardEl(activateFlashKey.kind, activateFlashKey.id), false);
  }
  activateFlashKey = { kind, id };
  applyActivateFlash(cardEl(kind, id), true);
  if (activateFlashTimer) clearTimeout(activateFlashTimer);
  activateFlashTimer = setTimeout(() => {
    activateFlashTimer = null;
    const key = activateFlashKey;
    activateFlashKey = null;
    if (!disposed && key) applyActivateFlash(cardEl(key.kind, key.id), false);
  }, ACTIVATE_FLASH_MS);
}

function paint(): void {
  if (disposed || !root) return;
  renderPluginsView(root, state);
  restoreFlashes();
}

function postReady(api: VsCodeApi): void {
  if (disposed) return;
  try {
    api.postMessage(encodePluginsReady());
  } catch {
    // host may be gone
  }
}

function postActivate(kind: string, id: string): void {
  if (disposed || !apiRef) return;
  const msg = encodePluginsActivate(kind, id);
  if (!msg) return;
  try {
    apiRef.postMessage(msg);
  } catch {
    // host may be gone
  }
}

function onHostMessage(event: MessageEvent): void {
  if (disposed) return;
  const decoded = decodeHostMessage(event.data);
  if (!decoded.ok) return;
  state = applyPluginsHostMessage(state, decoded.type, decoded.payload);
  paint();
}

function selectTab(tab: KindTab): void {
  state = setKindTab(state, tab);
  if (apiRef) persistTab(apiRef, state.tab);
  paint();
  const selected = root?.querySelector(`#tab-${state.tab}`);
  if (selected instanceof HTMLElement) selected.focus();
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el.isContentEditable;
}

function focusSearch(): void {
  const el = root?.querySelector('#plugins-search');
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

function copyPluginId(id: string): void {
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
      return;
    }
  } catch {
    // fall through
  }
  fallbackCopy();
}

function onClick(event: Event): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const tabBtn = target.closest('[data-tab]');
  if (tabBtn instanceof HTMLElement) {
    const tab = tabBtn.getAttribute('data-tab');
    if (isKindTab(tab)) selectTab(tab);
    return;
  }
  const copy = target.closest('[data-action="copy-id"]');
  if (copy instanceof HTMLButtonElement) {
    copyPluginId(copy.getAttribute('data-id') ?? '');
    startCopyFlash(copy);
    return;
  }
  const activate = target.closest('[data-action="activate"]');
  if (activate instanceof HTMLButtonElement && !activate.disabled) {
    const kind = activate.getAttribute('data-kind') ?? '';
    const id = activate.getAttribute('data-id') ?? '';
    postActivate(kind, id);
    startActivateFlash(kind, id);
  }
}

function onInput(event: Event): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id !== 'plugins-search') return;
  state = setSearchQuery(state, target.value);
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

function onKeyDown(event: KeyboardEvent): void {
  if (disposed) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const tab = target.closest('[role="tab"]');
  if (tab instanceof HTMLElement && root?.contains(tab)) {
    const current = tab.getAttribute('data-tab');
    if (!isKindTab(current)) return;
    const idx = KIND_TABS.indexOf(current);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectTab(KIND_TABS[(idx + 1) % KIND_TABS.length] ?? 'all');
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = idx <= 0 ? KIND_TABS.length - 1 : idx - 1;
      selectTab(KIND_TABS[next] ?? 'all');
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTab('all');
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab(KIND_TABS[KIND_TABS.length - 1] ?? 'component');
    }
    return;
  }
  if (target.classList.contains('plugin-card') && (event.key === 'Enter' || event.key === ' ')) {
    const btn = target.querySelector('[data-action="activate"]');
    if (btn instanceof HTMLButtonElement && !btn.disabled) {
      event.preventDefault();
      btn.click();
    }
  }
}

function ensureRoot(): HTMLElement {
  const existing = document.getElementById('plugins-root');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'plugins-root';
  el.className = 'plugins-root';
  document.body.appendChild(el);
  return el;
}

function main(): void {
  const api = acquireVsCodeApi();
  apiRef = api;
  try {
    state = initialPluginsState(tabFromPersisted(api.getState()));
  } catch {
    state = initialPluginsState();
  }
  root = ensureRoot();
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
      copyFlashKey = null;
      activateFlashKey = null;
      if (copyFlashTimer) clearTimeout(copyFlashTimer);
      if (activateFlashTimer) clearTimeout(activateFlashTimer);
      copyFlashTimer = null;
      activateFlashTimer = null;
    },
    { once: true },
  );
  paint();
  postReady(api);
}

main();
