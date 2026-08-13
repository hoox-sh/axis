// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workspace presentation modes — browser fullscreen + chart-only chrome hide.
 *
 * - **Fullscreen** — Fullscreen API on the app shell (OS/browser chrome off).
 * - **Chart only** — hide topbar / docks / status / system logs so the chart
 *   fills the shell. Works with or without browser fullscreen.
 *
 * State lives on {@link store.presentation} (ephemeral). DOM Fullscreen API
 * is owned here so the store stays free of document globals.
 *
 * @module ui/presentation
 */

import {
  store,
  setPresentationFullscreen,
  setChartOnly,
  toggleChartOnly as toggleChartOnlyStore,
} from '../store';

/** Element that requestFullscreen targets (the product shell). */
let appRootEl: HTMLElement | null = null;

/** Register the shell root used for Fullscreen API requests. */
export function setPresentationRoot(el: HTMLElement | null): void {
  appRootEl = el;
}

/** True when the document is currently in Fullscreen API mode. */
export function isBrowserFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.fullscreenElement;
}

/** Nudge layout/listeners after chrome show/hide or FS enter/exit. */
function notifyLayout(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event('resize'));
  } catch {
    /* ignore */
  }
}

/**
 * Enter browser fullscreen on the app shell (falls back to documentElement).
 * Resolves false when the Fullscreen API is unavailable or denied.
 */
export async function enterBrowserFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  if (document.fullscreenElement) {
    setPresentationFullscreen(true);
    return true;
  }
  const target = appRootEl || document.documentElement;
  const req = target.requestFullscreen?.bind(target);
  if (!req) return false;
  try {
    await req();
    setPresentationFullscreen(true);
    notifyLayout();
    return true;
  } catch {
    setPresentationFullscreen(false);
    return false;
  }
}

/** Exit browser fullscreen if active. */
export async function exitBrowserFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement) {
    setPresentationFullscreen(false);
    return;
  }
  try {
    await document.exitFullscreen?.();
  } catch {
    /* ignore */
  }
  setPresentationFullscreen(false);
  notifyLayout();
}

/** Toggle browser fullscreen on the app shell. */
export async function toggleBrowserFullscreen(): Promise<boolean> {
  if (isBrowserFullscreen()) {
    await exitBrowserFullscreen();
    return false;
  }
  return enterBrowserFullscreen();
}

/** Hide / show workspace chrome (topbar, docks, status, system logs). */
export function setChartOnlyMode(on: boolean): void {
  setChartOnly(!!on);
  // After CSS reflow, charts ResizeObserver / window listeners reflow panes
  queueMicrotask(() => notifyLayout());
}

/** Toggle chart-only presentation. */
export function toggleChartOnlyMode(): void {
  toggleChartOnlyStore();
  queueMicrotask(() => notifyLayout());
}

/**
 * Chart-only + browser fullscreen for an immersive chart.
 * Toggles: if already chart-only, exits chart-only and fullscreen.
 */
export async function toggleChartOnlyFullscreen(): Promise<void> {
  if (store.presentation?.chartOnly) {
    setChartOnlyMode(false);
    if (isBrowserFullscreen()) await exitBrowserFullscreen();
    return;
  }
  setChartOnlyMode(true);
  await enterBrowserFullscreen();
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  if (t.closest?.('.cm-editor, .cm-content, [role="textbox"]')) return true;
  return false;
}

/**
 * Wire Fullscreen API sync + Escape / shortcut handlers.
 * Call once from the product shell `onMount`; returns cleanup.
 *
 * Shortcuts (when not typing in an editor/input):
 * - **F11** — browser fullscreen (prevents default OS/browser chrome when
 *   Fullscreen API is available)
 * - **Shift+F** — chart-only chrome hide
 * - **Escape** — exit chart-only (browser also exits Fullscreen API on Escape)
 */
export function installPresentationControls(): () => void {
  if (typeof document === 'undefined') return () => {};

  const syncFs = () => {
    const on = !!document.fullscreenElement;
    setPresentationFullscreen(on);
    notifyLayout();
  };

  const onKey = (e: KeyboardEvent) => {
    // F11 → our Fullscreen API (more reliable than native for element FS)
    if (e.key === 'F11') {
      e.preventDefault();
      e.stopPropagation();
      void toggleBrowserFullscreen();
      return;
    }

    // Shift+F — chart only (not when typing)
    if (
      e.key === 'F' &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !isEditableTarget(e.target)
    ) {
      e.preventDefault();
      e.stopPropagation();
      toggleChartOnlyMode();
      return;
    }

    // Escape exits chart-only after browser has left fullscreen (or when
    // chart-only without FS). Skip when typing / modal dialog open.
    if (e.key !== 'Escape') return;
    if (isEditableTarget(e.target)) return;
    if (document.fullscreenElement) return; // browser handles FS exit first
    // Don't steal Escape from open dialogs / command palette.
    // AXIS dialogs are div[role=dialog][aria-modal=true], not <dialog open>.
    if (
      document.querySelector(
        '[role="dialog"][aria-modal="true"], [role="dialog"][open], [data-testid="axis-command-palette"], [data-testid="axis-command-palette-backdrop"]',
      )
    ) {
      return;
    }
    if (!store.presentation?.chartOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setChartOnlyMode(false);
  };

  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('keydown', onKey, true);
  // Initial sync (e.g. rare restore of FS across navigation)
  syncFs();

  return () => {
    document.removeEventListener('fullscreenchange', syncFs);
    document.removeEventListener('keydown', onKey, true);
  };
}
