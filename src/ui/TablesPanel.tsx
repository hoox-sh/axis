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
 * Bottom Tables panel — September 2026 Pine Script™ parity.
 *
 * TradingView lets users move a script's `table.*` drawings off the chart into
 * a tab in the bottom panel ("Move tables to bottom" in the script's More
 * menu, "Move tables to chart" to send them back). Bottom tables stack
 * vertically in creation order regardless of `position` / `force_overlay`,
 * stretch to fit the pane width, never truncate text (scrollbars when needed),
 * and allow text selection / copy — unlike chart overlay tables.
 *
 * AXIS equivalent: `store.pineTablesLocation[scriptId] === 'bottom'` moves that
 * script's tables here. One tab per script; chart HUD (`PyneTableHud`) hides
 * moved tables. Column widths are proportional to `table.cell(width=…)` when
 * the engine provides them (see `bottomPanelColumnFractions`).
 *
 * @module ui/TablesPanel
 */

import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import {
  isPanelOpen,
  setPineTablesLocation,
  setStatus,
  store,
  EDITOR_RUN_KEY,
} from '../store';
import {
  bottomPanelColumnFractions,
  buildTableGrid,
  cellTextAlign,
  cellTextVerticalAlign,
  collectVisiblePineTables,
  groupBottomTablesByOwner,
  type PineTable,
  type PineTableCell,
} from '../chart/pine-tables';
import { labelFontSizePx } from '../chart/pyne-drawings';
import { FloatableShell } from './panels/FloatableShell';

function scriptLabel(ownerId: string): string {
  if (!ownerId) return 'Tables';
  if (ownerId === EDITOR_RUN_KEY) return 'Editor';
  const s = store.scripts.find((x) => x.id === ownerId);
  return s?.name?.trim() || ownerId.slice(0, 8);
}

function copyTableAsTsv(tb: PineTable): void {
  const grid = buildTableGrid(tb);
  const tsv = grid
    .map((row) => row.map((c) => (c?.text ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t'))
    .join('\n');
  const done = () => setStatus('ready', 'Table copied', { toast: true, source: 'tables' });
  const fail = () => setStatus('ready', 'Copy failed — select and copy manually', { toast: true, source: 'tables' });
  try {
    const p = navigator.clipboard?.writeText(tsv);
    if (p && typeof p.then === 'function') void p.then(done, fail);
    else done();
  } catch {
    fail();
  }
}

/** Merged-cell coverage: which grid positions are covered by a merge origin. */
function mergeCoverage(tb: PineTable): {
  originSpan: Map<string, { rowSpan: number; colSpan: number }>;
  covered: Set<string>;
} {
  const originSpan = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();
  for (const [r0, c0, r1, c1] of tb.merged_cells || []) {
    originSpan.set(`${r0},${c0}`, { rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 });
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r === r0 && c === c0) continue;
        covered.add(`${r},${c}`);
      }
    }
  }
  return { originSpan, covered };
}

const BottomTableView: Component<{ tb: PineTable; index: number }> = (props) => {
  const grid = () => buildTableGrid(props.tb);
  const fractions = () => bottomPanelColumnFractions(props.tb);
  const coverage = () => mergeCoverage(props.tb);
  const frame = () => props.tb.frame_color || props.tb.border_color || 'var(--color-border, #3a3d4a)';
  const frameW = () => Math.max(1, props.tb.frame_width ?? props.tb.border_width ?? 1);

  return (
    <div class="axis-bottom-table" data-testid="axis-bottom-table" data-owner={props.tb.ownerId || ''}>
      <div class="mb-1 flex items-center justify-between gap-2">
        <span class="text-[11px] text-text-dim font-mono">
          Table {props.index + 1} · {props.tb.rows}×{props.tb.columns}
        </span>
        <button
          type="button"
          class="sc-btn sc-btn-ghost px-2 py-0.5 text-[11px]"
          title="Copy table as tab-separated text"
          onClick={() => copyTableAsTsv(props.tb)}
          data-testid="axis-bottom-table-copy"
        >
          Copy
        </button>
      </div>
      <div class="overflow-auto rounded border" style={{ 'border-color': frame(), 'max-height': '100%' }}>
        <table
          aria-label="Pine table (bottom panel)"
          class="border-collapse font-mono"
          style={{
            width: '100%',
            'table-layout': 'fixed',
            'border': `${frameW()}px solid ${frame()}`,
            'background-color': props.tb.bgcolor || 'rgba(17,18,24,0.92)',
            'font-size': '12px',
          }}
        >
          <colgroup>
            <For each={fractions()}>
              {(f) => <col style={{ width: `${(f * 100).toFixed(2)}%` }} />}
            </For>
          </colgroup>
          <tbody>
            <For each={grid()}>
              {(row, ri) => (
                <tr>
                  <For each={row}>
                    {(cell: PineTableCell | null, ci) => {
                      const key = `${ri()},${ci()}`;
                      if (coverage().covered.has(key)) return null as unknown as never;
                      const span = coverage().originSpan.get(key);
                      return (
                        <td
                          colspan={span?.colSpan}
                          rowspan={span?.rowSpan}
                          title={cell?.tooltip || undefined}
                          class="px-2 py-1 align-middle"
                          style={{
                            color: cell?.text_color || 'var(--color-text, #eceef4)',
                            'background-color': cell?.bgcolor || undefined,
                            'text-align': cellTextAlign(cell?.text_halign),
                            'vertical-align': cellTextVerticalAlign(cell?.text_valign),
                            'font-size': `${labelFontSizePx(cell?.text_size, 12)}px`,
                            'line-height': '1.35',
                            'border': `1px solid ${frame()}`,
                            'word-break': 'break-word',
                            'white-space': 'normal',
                            'user-select': 'text',
                            cursor: cell?.tooltip ? 'help' : 'text',
                          }}
                        >
                          {cell?.text ?? ''}
                        </td>
                      );
                    }}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Bottom Tables panel — one tab per script moved off the chart. */
export const TablesPanel: Component = () => {
  const [activeOwner, setActiveOwner] = createSignal<string | null>(null);

  const visibleTables = createMemo((): PineTable[] => {
    void store.scripts;
    void store.runResults;
    void store.lastRun;
    void store.resultsFocusId;
    void store.pineTablesLocation;
    const scriptIds = (store.scripts || [])
      .filter((s) => s.visible !== false)
      .map((s) => s.id);
    return collectVisiblePineTables({
      scriptIds,
      runResults: store.runResults,
      editorKey: EDITOR_RUN_KEY,
      lastRun: store.lastRun,
      lastRunOwnerId: store.resultsFocusId,
    });
  });

  const groups = createMemo(() => {
    const loc = (store.pineTablesLocation || {}) as Record<string, string>;
    const bottom = visibleTables().filter((tb) => tb.ownerId && loc[tb.ownerId] === 'bottom');
    return groupBottomTablesByOwner(bottom);
  });

  const active = createMemo(() => {
    const g = groups();
    if (g.length === 0) return null;
    const want = activeOwner();
    const found = want ? g.find((x) => x.ownerId === want) : undefined;
    return found || g[0] || null;
  });

  const moveBack = (ownerId: string) => {
    setPineTablesLocation(ownerId, 'chart');
    setStatus('ready', `${scriptLabel(ownerId)} tables back on chart`, { toast: false, source: 'tables' });
  };

  return (
    <Show when={isPanelOpen('tables')}>
      <FloatableShell id="tables" testId="axis-tables">
        <div class="flex h-full min-h-0 flex-col">
          <Show
            when={groups().length > 0}
            fallback={
              <div class="axis-empty-state px-3 py-4 text-[12px] text-text-dim" data-testid="axis-tables-empty">
                No tables in the bottom panel yet. Right-click a script chip (or open its chart menu) and choose
                “Move tables to bottom”. Tables stay live — move them back with “Move tables to chart”.
              </div>
            }
          >
            <Show when={groups().length > 1}>
              <div class="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border-soft px-2 py-1.5" role="tablist" aria-label="Scripts with bottom tables">
                <For each={groups()}>
                  {(g) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active()?.ownerId === g.ownerId}
                      class={`rounded px-2 py-1 text-[12px] font-mono ${active()?.ownerId === g.ownerId ? 'bg-bg-hover text-text' : 'text-text-dim hover:bg-bg-hover/60'}`}
                      onClick={() => setActiveOwner(g.ownerId)}
                      data-testid={`axis-tables-tab-${g.ownerId}`}
                      title={`${scriptLabel(g.ownerId)} — ${g.tables.length} table(s)`}
                    >
                      {scriptLabel(g.ownerId)} · {g.tables.length}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={active()}>
              {(grp) => (
                <div class="flex min-h-0 flex-1 flex-col">
                  <div class="flex flex-shrink-0 items-center justify-between gap-2 px-3 py-1.5">
                    <span class="text-[12px] font-semibold text-text">
                      {scriptLabel(grp().ownerId)}
                      <span class="ml-2 font-mono text-[11px] font-normal text-text-dim">
                        {grp().tables.length} table(s) · stacked top → bottom
                      </span>
                    </span>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost px-2 py-0.5 text-[11px]"
                      onClick={() => moveBack(grp().ownerId)}
                      data-testid="axis-tables-move-to-chart"
                      title="Move this script's tables back onto the chart"
                    >
                      Move tables to chart
                    </button>
                  </div>
                  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3" data-testid="axis-tables-list">
                    <For each={grp().tables}>{(tb, i) => <BottomTableView tb={tb} index={i()} />}</For>
                  </div>
                </div>
              )}
            </Show>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
