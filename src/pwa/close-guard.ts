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
 * Window-close confirmation guard.
 *
 * Tracks "unsaved work" via registered predicates (editor tabs, …) and shows
 * the browser's close confirmation when the user closes / reloads / navigates
 * away while a predicate reports dirty state.
 *
 * Install once per page (`installCloseGuard()` in the app shells); feature
 * code registers predicates with {@link registerCloseGuardPredicate} and
 * removes them on cleanup. Coexists with the persist-flush `beforeunload`
 * handlers in `store/index.ts` (flush runs regardless; this only prompts).
 *
 * Note: modern browsers show a generic prompt and ignore the custom message;
 * setting `returnValue` + returning the string keeps legacy behavior.
 *
 * @module pwa/close-guard
 */

/** Returns true while there is unsaved work worth confirming. */
export type CloseGuardPredicate = () => boolean;

const predicates = new Map<string, CloseGuardPredicate>();

/** Master switch — prompts only fire while enabled (default: on). */
let guardEnabled = true;

let closeGuardMessage = 'You have unsaved changes. Close anyway?';

let closeGuardInstalled = false;
let boundHandler: ((e: BeforeUnloadEvent) => unknown) | null = null;
let boundTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = null;

/** Whether any registered predicate currently reports unsaved work. */
export function shouldConfirmClose(): boolean {
  if (!guardEnabled) return false;
  for (const predicate of predicates.values()) {
    try {
      if (predicate()) return true;
    } catch {
      /* a throwing predicate must never block unload */
    }
  }
  return false;
}

/** Enable or disable the close prompt (predicates stay registered). */
export function setCloseGuardEnabled(enabled: boolean): void {
  guardEnabled = enabled;
}

/** Current master-switch state. */
export function isCloseGuardEnabled(): boolean {
  return guardEnabled;
}

/** Override the (legacy) confirmation message. */
export function setCloseGuardMessage(message: string): void {
  const text = String(message || '').trim();
  if (text) closeGuardMessage = text;
}

/** Current confirmation message. */
export function getCloseGuardMessage(): string {
  return closeGuardMessage;
}

/**
 * Register a dirty-state predicate under `id` (re-registering replaces it).
 * Returns an unregister function for `onCleanup`.
 */
export function registerCloseGuardPredicate(id: string, predicate: CloseGuardPredicate): () => void {
  predicates.set(id, predicate);
  return () => {
    predicates.delete(id);
  };
}

/** Remove a previously registered predicate. */
export function unregisterCloseGuardPredicate(id: string): void {
  predicates.delete(id);
}

/** Registered predicate ids (for tests / debugging). */
export function closeGuardPredicateIds(): string[] {
  return [...predicates.keys()];
}

/**
 * Track window close: installs a single `beforeunload` listener that prompts
 * when {@link shouldConfirmClose} is true. Idempotent — safe to call from
 * every shell (`App`, `EditorApp`). Returns an uninstall function.
 */
export function installCloseGuard(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window !== 'undefined'
    ? window
    : null,
): () => void {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  if (closeGuardInstalled) return uninstallCloseGuard;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!shouldConfirmClose()) return;
    e.preventDefault();
    // Legacy browsers read the return value; modern ones show a generic prompt.
    (e as BeforeUnloadEvent & { returnValue?: unknown }).returnValue = closeGuardMessage;
    return closeGuardMessage;
  };
  boundHandler = onBeforeUnload as (e: BeforeUnloadEvent) => unknown;
  boundTarget = target;
  try {
    target.addEventListener('beforeunload', boundHandler);
  } catch {
    boundHandler = null;
    boundTarget = null;
    return () => {};
  }
  closeGuardInstalled = true;
  return uninstallCloseGuard;
}

/** Remove the `beforeunload` listener installed by {@link installCloseGuard}. */
export function uninstallCloseGuard(): void {
  if (!closeGuardInstalled) return;
  closeGuardInstalled = false;
  const handler = boundHandler;
  const target = boundTarget;
  boundHandler = null;
  boundTarget = null;
  if (!handler || !target) return;
  try {
    target.removeEventListener('beforeunload', handler);
  } catch {
    /* ignore */
  }
}

/** Test helper — reset guard state between unit tests. */
export function _resetCloseGuardForTests(): void {
  predicates.clear();
  guardEnabled = true;
  closeGuardMessage = 'You have unsaved changes. Close anyway?';
  closeGuardInstalled = false;
  boundHandler = null;
  boundTarget = null;
}
