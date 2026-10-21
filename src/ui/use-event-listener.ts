// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Event listener primitives.
 *
 * The scan found dozens of `onMount(() => target.addEventListener(...))` /
 * `onCleanup(() => target.removeEventListener(...))` pairs — the same four
 * lines, repeated, and easy to get subtly wrong (a missing `capture` flag on
 * one side, a listener that outlives its component).
 *
 * @module ui/use-event-listener
 */

import { onCleanup, onMount } from 'solid-js';

/**
 * Attach a DOM event listener and return the disposer.
 *
 * The same options are used for the removal, as the DOM requires — a
 * `capture` flag on one side only would leak the listener.
 *
 * @param target The event target (`window`, `document`, an element).
 * @param type The event name.
 * @param handler The listener.
 * @param options Listener options (`capture`, `passive`, …).
 * @returns A function that removes the listener.
 */
export function attachEventListener(
  target: EventTarget | null | undefined,
  type: string,
  handler: (ev: Event) => void,
  options?: boolean | AddEventListenerOptions,
): () => void {
  if (!target) return () => {};
  const listener = handler as EventListener;
  target.addEventListener(type, listener, options);
  return () => {
    target.removeEventListener(type, listener, options);
  };
}

/**
 * Register a DOM event listener for the lifetime of the component.
 *
 * The listener is attached on mount and removed on cleanup — the two halves
 * cannot drift apart, because they are one call.
 */
export function useEventListener<E extends Event = Event>(
  target: EventTarget | null | undefined,
  type: string,
  handler: (ev: E) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  onMount(() => {
    const dispose = attachEventListener(target, type, handler as (ev: Event) => void, options);
    onCleanup(dispose);
  });
}
