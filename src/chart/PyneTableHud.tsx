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
 * HUD overlay for Pine **`table.*`** drawings (screen-space, not price scale).
 *
 * Collects tables from {@link store.runResults} for **still-applied** scripts
 * only — deleting a script drops its tables. Independent of the SVG drawing
 * layer used for line/box/label geometry.
 *
 * @module chart/PyneTableHud
 */

import { Component, For, Show, createMemo } from 'solid-js';
import { store, EDITOR_RUN_KEY } from '../store';
import {
  buildTableGrid,
  cellTextAlign,
  collectVisiblePineTables,
  pineTablePositionClass,
  type PineTable,
} from './pine-tables';

export const PyneTableHud: Component = () => {
  const tables = createMemo((): PineTable[] => {
    void store.scripts;
    void store.runResults;
    void store.lastRun;
    const scriptIds = (store.scripts || [])
      .filter((s) => s.visible !== false)
      .map((s) => s.id);
    return collectVisiblePineTables({
      scriptIds,
      runResults: store.runResults,
      editorKey: EDITOR_RUN_KEY,
      lastRun: store.lastRun,
    });
  });

  return (
    <Show when={tables().length > 0}>
      <For each={tables()}>
        {(tb) => {
          const grid = () => buildTableGrid(tb);
          const frame = () => tb.frame_color || tb.border_color || 'var(--color-border, #3a3d4a)';
          const frameW = () => Math.max(1, tb.frame_width ?? tb.border_width ?? 1);
          return (
            <div
              class={`absolute z-[6] pointer-events-none ${pineTablePositionClass(tb.position)}`}
              role="table"
              aria-label="Pine table"
              data-testid="axis-pine-table"
              data-owner={tb.ownerId || ''}
            >
              <table
                class="border-collapse text-[10px] font-mono shadow-lg"
                style={{
                  'border': `${frameW()}px solid ${frame()}`,
                  'background-color': tb.bgcolor || 'rgba(17,18,24,0.92)',
                }}
              >
                <tbody>
                  <For each={grid()}>
                    {(row) => (
                      <tr>
                        <For each={row}>
                          {(cell) => (
                            <td
                              class="px-1.5 py-0.5 min-w-[1.5rem] max-w-[12rem] align-middle"
                              style={{
                                color: cell?.text_color || 'var(--color-text, #eceef4)',
                                'background-color': cell?.bgcolor || undefined,
                                'text-align': cellTextAlign(cell?.text_halign),
                                'border': `1px solid ${frame()}`,
                                'word-break': 'break-word',
                              }}
                            >
                              {cell?.text ?? ''}
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          );
        }}
      </For>
    </Show>
  );
};
