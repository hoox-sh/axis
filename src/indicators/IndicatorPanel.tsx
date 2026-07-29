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
 * Floatable **Indicators** panel listing all scripts applied via {@link runAndApply}.
 *
 * Renders when panel id `indicators` is open (or legacy `store.indicatorPanel.open`).
 * Empty state prompts the user to run a Pine script.
 *
 * @module indicators/IndicatorPanel
 */

import { Component, For, Show } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { IndicatorCard } from './IndicatorCard';
import { FloatableShell } from '../ui/panels/FloatableShell';

/** Shell + list of {@link IndicatorCard} for `store.scripts`. */
export const IndicatorPanel: Component = () => {
  return (
    <Show when={isPanelOpen('indicators') || store.indicatorPanel.open}>
      <FloatableShell id="indicators" testId="axis-indicators">
        <div class="flex-1 overflow-y-auto p-2 min-h-0">
          <Show
            when={store.scripts.length > 0}
            fallback={
              <div class="text-text-faint text-[0.85em] italic p-2">
                No indicators running.
                <div class="mt-2 not-italic text-text-dim normal-case tracking-normal">
                  Run a Pine script to list plots here. Toggle visibility and colors per series.
                </div>
              </div>
            }
          >
            <For each={store.scripts}>{(ind) => <IndicatorCard indicator={ind} />}</For>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
