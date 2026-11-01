// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lightweight focus trap for AXIS modal dialogs (div[role=dialog][aria-modal]).
 *
 * - Restores focus to `returnElement` (or the previously focused element) on dispose
 * - Hides sibling subtrees with aria-hidden while the trap is active
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

function isFocusTarget(x: unknown): x is HTMLElement {
  return !!x && typeof x === 'object' && typeof (x as HTMLElement).focus === 'function';
}

function isHideableSibling(x: unknown): x is HTMLElement {
  if (!x || typeof x !== 'object') return false;
  if (typeof HTMLElement !== 'undefined') {
    try {
      if (x instanceof HTMLElement) return true;
    } catch {
      /* incomplete test DOM */
    }
  }
  const el = x as HTMLElement;
  return (
    typeof el.setAttribute === 'function' &&
    typeof el.getAttribute === 'function' &&
    typeof el.removeAttribute === 'function'
  );
}

function inDocument(el: HTMLElement): boolean {
  try {
    if (typeof document === 'undefined' || typeof document.contains !== 'function') return true;
    return document.contains(el);
  } catch {
    return false;
  }
}

/**
 * Hide siblings of `dialogRoot`'s ancestor chain up to `document.body` so
 * background content is inert to AT while the trap is active.
 *
 * No-ops when `document.body` is missing (minimal test stubs). Leaves
 * already-hidden siblings alone so dispose does not unhide them.
 */
function hideAriaSiblings(dialogRoot: HTMLElement): () => void {
  const hidden: Array<{ el: HTMLElement; prev: string | null }> = [];
  let cancelled = false;

  const apply = () => {
    if (cancelled) return;
    if (typeof document === 'undefined' || !document.body) return;
    if (hidden.length > 0) return;
    let node: HTMLElement | null = dialogRoot;
    try {
      while (node && node !== document.body && node !== document.documentElement) {
        const parent = node.parentElement;
        if (!parent || parent.children == null) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) continue;
          if (!isHideableSibling(sibling)) continue;
          const prev = sibling.getAttribute('aria-hidden');
          if (prev === 'true') continue;
          sibling.setAttribute('aria-hidden', 'true');
          hidden.push({ el: sibling, prev });
        }
        node = parent as HTMLElement;
      }
    } catch {
      /* incomplete test DOM */
    }
  };

  // Solid refs fire before the node is inserted. Walk now (tests already
  // parent the double) and retry on a microtask once the dialog is in-tree.
  apply();
  if (hidden.length === 0) queueMicrotask(apply);

  return () => {
    cancelled = true;
    for (const { el, prev } of hidden) {
      try {
        if (prev == null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', prev);
      } catch {
        /* ignore */
      }
    }
  };
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
 * `autoFocus` is true. Returns dispose that restores `returnElement` or the
 * previously focused element.
 */
export function installFocusTrap(
  root: HTMLElement,
  opts?: {
    autoFocus?: boolean;
    /** Restore focus here on dispose. Defaults to the previously focused element. */
    returnElement?: HTMLElement | null;
  },
): () => void {
  if (!isHtmlEl(root) || typeof root.addEventListener !== 'function') {
    return () => {};
  }
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const prev = isFocusTarget(active) ? active : null;
  const restoreAria = hideAriaSiblings(root);

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
    const current = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (current === first || current === root || !root.contains(current)) {
        e.preventDefault();
        last.focus();
      }
    } else if (current === last) {
      e.preventDefault();
      first.focus();
    }
  };

  root.addEventListener('keydown', onKeyDown);

  // Focus containment: Tab cycling alone cannot stop a pointer click or a
  // programmatic `.focus()` from landing outside the dialog while it is open.
  // `focusin` bubbles, so one document-level listener pulls focus back in.
  const canUseDocumentFocus =
    typeof document !== 'undefined' &&
    typeof document.addEventListener === 'function';
  const onFocusIn = (e: FocusEvent) => {
    const t = e.target as Node | null;
    if (t && root.contains(t)) return;
    // Focus that landed outside `root` (including aria-hidden background) is
    // pulled back; listFocusable already skips aria-hidden descendants.
    const list = listFocusable(root);
    const target = list[0] || root;
    try {
      target.focus();
    } catch {
      /* ignore */
    }
  };
  if (canUseDocumentFocus) document.addEventListener('focusin', onFocusIn);

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
    if (canUseDocumentFocus) document.removeEventListener('focusin', onFocusIn);
    try {
      restoreAria();
    } catch {
      /* ignore */
    }
    const preferred = opts?.returnElement;
    const target =
      isFocusTarget(preferred) && inDocument(preferred)
        ? preferred
        : isFocusTarget(prev) && inDocument(prev)
          ? prev
          : null;
    if (target) {
      try {
        target.focus();
      } catch {
        /* ignore */
      }
    }
  };
}
