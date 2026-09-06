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
 * @module ui/shortcuts/Hub
 *
 * Single capture-phase `keydown` listener that owns the dispatch table for
 * every keyboard shortcut. The dispatch core lives in {@link runtime} (action
 * registry, matching, dialog-skip guard); this module mounts it on `window`
 * and pulls in the app-level action registrations (actions.ts) as a side
 * effect.
 */

import { Component, createMemo, onCleanup, onMount } from 'solid-js';
import { buildDispatchTable, dispatchShortcut } from './runtime';
import './actions';

export {
  registerShortcut,
  buildDispatchTable,
  dispatchShortcut,
  type DispatchRow,
} from './runtime';

/**
 * Mount once from the product shell. Renders nothing; owns the capture-phase
 * keydown listener for the whole app.
 */
export const ShortcutHub: Component<{ children?: any }> = (props) => {
  const table = createMemo(buildDispatchTable);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      dispatchShortcut(table(), e);
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  return props.children ?? null;
};