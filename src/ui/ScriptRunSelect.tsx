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
 * Script picker for Results / Scriptlogs when multiple indicators are on chart.
 * Binds to {@link setResultsFocusId} so live multi-script re-runs do not thrash
 * the open panel.
 *
 * @module ui/ScriptRunSelect
 */

import { Component, For, Show, createMemo } from 'solid-js';
import {
  store,
  listRunResultOptions,
  setResultsFocusId,
  EDITOR_RUN_KEY,
} from '../store';

export type ScriptRunSelectProps = {
  /** data-testid prefix (default axis-run-select) */
  testId?: string;
  class?: string;
};

/** Compact &lt;select&gt; of applied scripts (+ Editor) for run-bound panels. */
export const ScriptRunSelect: Component<ScriptRunSelectProps> = (props) => {
  const testId = () => props.testId || 'axis-run-select';
  const options = createMemo(() => listRunResultOptions());
  const show = createMemo(() => {
    const opts = options();
    // Always show when more than one option, or one applied script + editor, or any multi-script chart
    if (opts.length > 1) return true;
    if ((store.scripts?.length ?? 0) > 1) return true;
    return false;
  });

  const value = createMemo(() => {
    const focus = store.resultsFocusId;
    if (focus) return focus;
    const opts = options();
    return opts[0]?.id ?? EDITOR_RUN_KEY;
  });

  return (
    <Show when={show()}>
      <label
        class={`inline-flex items-center gap-1 min-w-0 max-w-[12rem] ${props.class || ''}`}
        title="Which script’s last run is shown"
      >
        <span class="sr-only">Script</span>
        <select
          class="sc-input text-[0.78em] py-0.5 px-1 max-w-full min-w-0"
          data-testid={testId()}
          aria-label="Select script for this panel"
          value={value()}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setResultsFocusId(v || null);
          }}
        >
          <For each={options()}>
            {(opt) => (
              <option value={opt.id} disabled={!opt.hasResult && opt.id !== value()}>
                {opt.label}
                {!opt.hasResult ? ' (no run)' : ''}
              </option>
            )}
          </For>
          <Show when={options().length === 0}>
            <option value={EDITOR_RUN_KEY}>Editor</option>
          </Show>
        </select>
      </label>
    </Show>
  );
};
