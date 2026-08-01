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
 * Compact **Problems** list under the Pine editor — diagnostics / errors
 * from the last run with jump-to-line.
 *
 * Data source: {@link EditorDiagnostic} from `editor/diagnostics`.
 *
 * @module ui/EditorProblems
 */

import { Component, For, Show } from 'solid-js';
import type { DiagnosticSeverity, EditorDiagnostic } from '../editor/diagnostics';
import {
  formatProblemLine,
  truncateProblemMessage,
  type EditorProblem,
} from './editor-problems';

export type { EditorProblem } from './editor-problems';
export {
  countProblemsBySeverity,
  diagnosticsToProblems,
  formatProblemLine,
  severityRank,
  truncateProblemMessage,
} from './editor-problems';

function severityClass(sev: DiagnosticSeverity | string): string {
  switch (String(sev).toLowerCase()) {
    case 'error':
      return 'text-red';
    case 'warning':
      return 'text-orange';
    case 'info':
      return 'text-text-dim';
    default:
      return 'text-text-faint';
  }
}

function SeverityGlyph(props: { severity: DiagnosticSeverity | string }) {
  const glyph = () => {
    switch (String(props.severity).toLowerCase()) {
      case 'error':
        return '⊗';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
      default:
        return '·';
    }
  };
  return (
    <span
      class={`inline-flex w-3.5 justify-center flex-shrink-0 ${severityClass(props.severity)}`}
      aria-hidden
      title={String(props.severity)}
    >
      {glyph()}
    </span>
  );
}

export interface EditorProblemsProps {
  /**
   * Diagnostics from last run — accepts full {@link EditorDiagnostic}s
   * or compact problem rows.
   */
  diagnostics: readonly (EditorDiagnostic | EditorProblem)[];
  /** Jump editor cursor to 1-based line */
  onJump: (line: number) => void;
  /** Optional clear / dismiss callback */
  onClear?: () => void;
  class?: string;
}

/**
 * Compact problems list — severity · line · truncated message.
 * Click a row to jump; empty state shows “No problems”.
 */
export const EditorProblems: Component<EditorProblemsProps> = (props) => {
  return (
    <div
      class={`flex flex-col min-h-0 flex-shrink-0 border-t-2 border-border bg-bg-base ${props.class ?? ''}`}
      data-testid="axis-editor-problems"
      role="region"
      aria-label="Editor problems"
    >
      <div class="flex items-center gap-1.5 px-2 py-0.5 border-b border-border-soft flex-shrink-0">
        <span class="text-text-faint text-[11px] leading-none" aria-hidden>
          ⚠
        </span>
        <span class="text-[10px] uppercase tracking-wider text-text-faint font-semibold">
          Problems
        </span>
        <span
          class="text-[10px] font-mono tabular-nums text-text-dim"
          data-testid="axis-editor-problems-count"
        >
          {props.diagnostics.length}
        </span>
        <div class="flex-1" />
        <Show when={props.onClear}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 py-0 text-[10px]"
            title="Clear problems list"
            data-testid="axis-editor-problems-clear"
            onClick={() => props.onClear?.()}
          >
            Clear
          </button>
        </Show>
      </div>

      <div
        class="max-h-[7.5rem] overflow-y-auto font-mono text-[10px]"
        data-testid="axis-editor-problems-list"
      >
        <Show
          when={props.diagnostics.length > 0}
          fallback={
            <div
              class="px-2 py-1.5 text-text-faint italic"
              data-testid="axis-editor-problems-empty"
            >
              No problems
            </div>
          }
        >
          <ul class="list-none m-0 p-0">
            <For each={[...props.diagnostics]}>
              {(p, idx) => (
                <li>
                  <button
                    type="button"
                    class="w-full flex items-start gap-1.5 px-2 py-0.5 text-left hover:bg-bg-hover border-none bg-transparent cursor-pointer text-text group"
                    data-testid="axis-editor-problems-row"
                    data-line={p.line > 0 ? p.line : undefined}
                    data-severity={p.severity}
                    title={
                      p.line > 0
                        ? `Go to line ${p.line}: ${p.message}`
                        : p.message
                    }
                    onClick={() => {
                      if (p.line >= 1) props.onJump(p.line);
                    }}
                  >
                    <SeverityGlyph severity={p.severity} />
                    <span
                      class="text-text-faint tabular-nums w-7 flex-shrink-0 text-right group-hover:text-accent"
                      data-testid="axis-editor-problems-line"
                    >
                      {formatProblemLine(p.line)}
                    </span>
                    <span
                      class={`flex-1 min-w-0 truncate ${severityClass(p.severity)}`}
                      data-testid="axis-editor-problems-msg"
                    >
                      {truncateProblemMessage(p.message)}
                    </span>
                    <Show when={p.source && p.source !== 'diagnostic'}>
                      <span class="text-text-faint/70 flex-shrink-0 text-[9px] uppercase">
                        {p.source}
                      </span>
                    </Show>
                    <span class="sr-only">{idx() + 1}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
};
