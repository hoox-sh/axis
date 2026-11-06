/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Shared `/`-to-search keyboard binding used by every searchable panel.
 *
 * The behaviour is deliberately identical everywhere: a bare `/` (no
 * modifier) focuses the panel's search field, and the key is ignored while
 * the user is typing in any input, textarea, select, or contenteditable host
 * so a literal slash never gets eaten.
 *
 * @module ui/focus-search
 */

/**
 * Bind `/` to a search field for the lifetime of the returned disposer.
 *
 * Intended for `onMount(() => onCleanup(bindSlashToSearch(() => input)))`.
 * The listener is registered on `window` and removed by the disposer.
 *
 * @param getInput Resolves the current search field. Called only on a match,
 *   so a field that is re-created by the framework is picked up automatically.
 * @returns Disposer that removes the keydown listener.
 *
 * @example
 * let searchInput: HTMLInputElement | undefined;
 * onMount(() => onCleanup(bindSlashToSearch(() => searchInput)));
 */
export function bindSlashToSearch(getInput: () => HTMLInputElement | null | undefined): () => void {
  const onSlash = (event: KeyboardEvent): void => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    getInput()?.focus();
  };
  window.addEventListener('keydown', onSlash);
  return () => window.removeEventListener('keydown', onSlash);
}
