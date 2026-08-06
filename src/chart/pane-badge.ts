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
 * Pane corner badges — indicator name + script action icons (settings, eye,
 * re-run, remove). Imperative DOM so {@link PaneManager} can own chrome without
 * Solid mounts per pane.
 *
 * Layout notes (avoid top-left pile-up):
 * - Chart workspace owns the **symbol · interval** chip (`.axis-slot-badge`).
 * - Price pane **never** shows a redundant "PRICE" label — that conflicted with
 *   the slot chip and any overlay indicator chips.
 * - Price pane script chips sit on the **top row**, offset **right of the drawing
 *   tool rail** (`.axis-pane-badge-root[data-pane-type="price"]`) so they are not
 *   covered by the DrawingToolbar / style bar (ChartHost sibling, higher paint).
 * - Volume / equity / indicator panes keep their own name chips at pane top.
 *
 * @module chart/pane-badge
 */

import {
  openScriptSettings,
  removeIndicator,
  removePane,
  setPaneVisible,
  store,
  toggleIndicator,
} from '../store';
import { getManager } from './manager-access';

type SvgKind = 'settings' | 'eye' | 'eyeOff' | 'refresh' | 'trash' | 'hide';

const SVG: Record<SvgKind, string> = {
  settings:
    '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M10.7 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.1"/><path d="M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a10.3 10.3 0 0 0 4.4-1"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  hide: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function iconSvg(kind: SvgKind): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[kind]}</svg>`;
}

function btn(title: string, kind: SvgKind, onClick: () => void, testId?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'axis-pane-badge-btn';
  b.title = title;
  b.setAttribute('aria-label', title);
  if (testId) b.dataset.testid = testId;
  b.innerHTML = iconSvg(kind);
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  return b;
}

function scriptsOnPane(paneId: string) {
  return store.scripts.filter((s) => s.paneId === paneId);
}

function reRunScript(id: string, code: string) {
  // Dynamic import avoids circular load (runner → pane-manager → badge → runner)
  void import('../indicators/runner').then(({ runAndApply }) => {
    void runAndApply(code, id, {
      silent: false,
      openResults: false,
      inputs: store.scripts.find((s) => s.id === id)?.inputValues,
    });
  });
}

function toggleScriptVisible(id: string, paneId: string, currentlyVisible: boolean) {
  toggleIndicator(id);
  const manager = getManager();
  if (!manager) return;
  if (currentlyVisible) {
    // Now hidden — clear series for this pane (other visible scripts re-applied)
    try {
      manager.removeOverlays(paneId);
    } catch {
      /* ignore */
    }
    for (const s of store.scripts) {
      if (s.paneId === paneId && s.visible && s.id !== id && s.code?.trim()) {
        reRunScript(s.id, s.code);
      }
    }
  } else {
    // Turning back on — re-run to repaint
    const script = store.scripts.find((s) => s.id === id);
    if (script?.code?.trim()) reRunScript(id, script.code);
  }
  refreshPaneBadge(paneId);
}

function removeScript(id: string, paneId: string) {
  const manager = getManager();
  if (manager) {
    try {
      manager.removeOverlays(paneId);
    } catch {
      /* ignore */
    }
  }
  removeIndicator(id);
  const remaining = store.scripts.filter((s) => s.paneId === paneId);
  if (manager && paneId !== 'price' && paneId !== 'volume' && remaining.length === 0) {
    try {
      manager.destroyPane(paneId);
    } catch {
      /* ignore */
    }
    if (store.panes.some((p) => p.id === paneId)) {
      try {
        removePane(paneId);
      } catch {
        /* ignore */
      }
    }
  } else if (remaining.length) {
    // Re-paint remaining scripts on this pane
    for (const s of remaining) {
      if (s.visible && s.code?.trim()) reRunScript(s.id, s.code);
    }
    refreshPaneBadge(paneId);
  } else {
    refreshPaneBadge(paneId);
  }
}

function hidePane(paneId: string) {
  setPaneVisible(paneId, false);
  getManager()?.setVisible(paneId, false);
  refreshPaneBadge(paneId);
}

/**
 * Build / rebuild badge chrome inside a pane host.
 * Safe to call repeatedly; replaces previous badge root.
 */
export function mountPaneBadge(
  host: HTMLElement,
  paneId: string,
  paneType: string,
  label: string,
): HTMLElement {
  // Minimal test DOM stubs may lack querySelectorAll — guard
  if (typeof host.querySelectorAll === 'function') {
    host.querySelectorAll('.axis-pane-badge-root').forEach((n) => n.remove());
  }

  const scripts = scriptsOnPane(paneId);
  const isPrice = paneType === 'price' || paneId === 'price';

  const root = document.createElement('div');
  // Price pane with no scripts: empty root (hidden via CSS) — slot badge is the title
  root.className =
    isPrice && scripts.length === 0
      ? 'axis-pane-badge-root is-empty'
      : 'axis-pane-badge-root';
  if (root.dataset) {
    root.dataset.paneId = paneId;
    root.dataset.paneType = paneType;
  }

  if (scripts.length === 0) {
    // Price pane: skip bare "PRICE" — workspace slot badge already shows
    // symbol · interval. Empty root still marks the host for refresh.
    if (isPrice) {
      host.appendChild(root);
      return root;
    }

    // Built-in panes (volume / equity / empty indicator) — name + optional hide
    const chip = document.createElement('div');
    chip.className = 'axis-pane-badge-chip';
    const name = document.createElement('span');
    name.className = 'axis-pane-badge-name';
    name.textContent = label;
    chip.appendChild(name);
    if (paneType === 'volume' || paneType === 'equity') {
      chip.appendChild(
        btn('Hide pane', 'hide', () => hidePane(paneId), `axis-pane-hide-${paneId}`),
      );
    }
    root.appendChild(chip);
  } else {
    // Never prefix price with a "PRICE" chip — scripts only, stacked under slot badge
    for (const script of scripts) {
      const chip = document.createElement('div');
      chip.className = 'axis-pane-badge-chip';
      chip.dataset.scriptId = script.id;
      if (!script.visible) chip.classList.add('is-hidden-script');

      const name = document.createElement('span');
      // is-script: keep author casing (RSI, Supertrend) — not full uppercase
      name.className = 'axis-pane-badge-name is-script';
      name.textContent = script.name || label;
      name.title = script.name || label;
      chip.appendChild(name);

      chip.appendChild(
        btn(
          'Script settings / inputs',
          'settings',
          () => openScriptSettings(script.id),
          `axis-pane-settings-${script.id}`,
        ),
      );
      chip.appendChild(
        btn(
          script.visible ? 'Hide script' : 'Show script',
          script.visible ? 'eye' : 'eyeOff',
          () => toggleScriptVisible(script.id, paneId, script.visible),
          `axis-pane-eye-${script.id}`,
        ),
      );
      chip.appendChild(
        btn(
          'Re-run script',
          'refresh',
          () => {
            if (script.code?.trim()) reRunScript(script.id, script.code);
          },
          `axis-pane-rerun-${script.id}`,
        ),
      );
      chip.appendChild(
        btn(
          'Remove script',
          'trash',
          () => {
            if (confirm(`Remove “${script.name}” from the chart?`)) {
              removeScript(script.id, paneId);
            }
          },
          `axis-pane-remove-${script.id}`,
        ),
      );

      root.appendChild(chip);
    }
  }

  host.appendChild(root);
  return root;
}

function findPaneHost(paneId: string): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return null;
  }
  try {
    const esc =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(paneId)
        : paneId.replace(/"/g, '\\"');
    return document.querySelector(`[data-pane-id="${esc}"]`) as HTMLElement | null;
  } catch {
    return null;
  }
}

/** Update label text on the first chip when there are no scripts. */
export function setPaneBadgeLabel(paneId: string, label: string) {
  const el = findPaneHost(paneId);
  if (!el) return;
  const scripts = scriptsOnPane(paneId);
  if (scripts.length) {
    refreshPaneBadge(paneId);
    return;
  }
  const nameEl =
    typeof el.querySelector === 'function'
      ? el.querySelector('.axis-pane-badge-name')
      : null;
  if (nameEl) nameEl.textContent = label;
  else mountPaneBadge(el, paneId, el.dataset?.paneType || 'indicator', label);
}

/** Rebuild badge for one pane from current store.scripts. */
export function refreshPaneBadge(paneId: string) {
  const el = findPaneHost(paneId);
  if (!el) return;
  const type =
    el.dataset?.paneType || store.panes.find((p) => p.id === paneId)?.type || 'indicator';
  let nameText: string | null = null;
  try {
    nameText = el.querySelector?.('.axis-pane-badge-name')?.textContent ?? null;
  } catch {
    nameText = null;
  }
  const label = store.panes.find((p) => p.id === paneId)?.label || nameText || paneId;
  const mgrLabel = getManager()?.getPane(paneId)?.label;
  mountPaneBadge(el, paneId, type, mgrLabel || label || paneId);
}

/** Refresh badges for every pane host currently in the document. */
export function refreshAllPaneBadges() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return;
  }
  document.querySelectorAll<HTMLElement>('[data-pane-id]').forEach((el) => {
    const id = el.dataset?.paneId;
    if (id) refreshPaneBadge(id);
  });
}
