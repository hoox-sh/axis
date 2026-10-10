// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared outside-click / Escape dismiss for non-modal popovers (chart layout,
 * screenshot, extra menu, watchlist alert popover, …).
 *
 * - `pointerdown` is listened to in the capture phase on `document`, so a
 *   click that lands on another control still closes the popover first.
 * - A pointer inside any element returned by `inside()` is ignored (typically
 *   the trigger button plus the popover panel).
 * - Escape closes by default; pass `escape: false` when the owner already
 *   handles keys (ContextMenu does its own arrow-key handling).
 *
 * @module ui/dismiss-on-outside
 */

export interface DismissOnOutsideOptions {
  /** Elements that count as "inside" (trigger + panel). Evaluated per event. */
  inside: () => ReadonlyArray<Element | null | undefined>;
  /** Called on outside pointerdown or Escape. Must be idempotent. */
  onDismiss: () => void;
  /** Close on Escape (default true). */
  escape?: boolean;
}

/**
 * Install the outside-dismiss listeners. Returns a dispose function that
 * removes them (wire it through `onCleanup`).
 */
export function dismissOnOutside(opts: DismissOnOutsideOptions): () => void {
  if (typeof document === 'undefined') return () => {};
  const closeOnEscape = opts.escape !== false;

  const onPointer = (e: PointerEvent) => {
    const t = e.target as Node | null;
    if (t && opts.inside().some((el) => !!el && el.contains(t))) return;
    opts.onDismiss();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') opts.onDismiss();
  };

  document.addEventListener('pointerdown', onPointer, true);
  if (closeOnEscape) document.addEventListener('keydown', onKey);

  return () => {
    document.removeEventListener('pointerdown', onPointer, true);
    if (closeOnEscape) document.removeEventListener('keydown', onKey);
  };
}
