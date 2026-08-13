// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lightweight focus trap for AXIS modal dialogs (div[role=dialog][aria-modal]).
 *
 * - Restores focus to the previously focused element on dispose
 * - Tabs cycle within the container
 * - Does not own Escape (callers still handle close)
 *
 * @module ui/focus-trap
 */

const FOCUSABLE_SEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isHtmlEl(x: unknown): x is HTMLElement {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as HTMLElement).addEventListener === 'function' &&
    typeof (x as HTMLElement).focus === 'function'
  );
}

/** Visible focusable elements inside `root` (order = document order). */
export function listFocusable(root: HTMLElement): HTMLElement[] {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const nodes = root.querySelectorAll(FOCUSABLE_SEL);
  const out: HTMLElement[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (typeof el.closest === 'function' && el.closest('[aria-hidden="true"]')) continue;
    // Offset parent null often means display:none (except fixed)
    if (typeof getComputedStyle === 'function') {
      try {
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
      } catch {
        /* minimal test DOM */
      }
    }
    out.push(el);
  }
  return out;
}

/**
 * Install a Tab trap on `root`. Focuses `root` (or first focusable) when
 * `autoFocus` is true. Returns dispose that restores prior active element.
 */
export function installFocusTrap(
  root: HTMLElement,
  opts?: { autoFocus?: boolean },
): () => void {
  if (!isHtmlEl(root) || typeof root.addEventListener !== 'function') {
    return () => {};
  }
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const prev = isHtmlEl(active) ? active : null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const list = listFocusable(root);
    if (!list.length) {
      e.preventDefault();
      try {
        root.focus();
      } catch {
        /* ignore */
      }
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || active === root || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  root.addEventListener('keydown', onKeyDown);

  if (opts?.autoFocus !== false) {
    const list = listFocusable(root);
    const target = list[0] || root;
    try {
      if (!root.hasAttribute('tabindex') && target === root) {
        root.tabIndex = -1;
      }
      // Defer so Solid finishes mounting children
      queueMicrotask(() => {
        try {
          target.focus();
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
  }

  return () => {
    root.removeEventListener('keydown', onKeyDown);
    if (prev && typeof prev.focus === 'function') {
      try {
        // Only restore if still in document
        if (typeof document?.contains !== 'function' || document.contains(prev)) {
          prev.focus();
        }
      } catch {
        /* ignore */
      }
    }
  };
}
