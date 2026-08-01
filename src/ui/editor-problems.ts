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
 * Pure format helpers for the editor **Problems** panel.
 *
 * Diagnostic extraction lives in {@link ../editor/diagnostics} —
 * this module only formats rows for the list UI (safe for unit tests).
 *
 * @module ui/editor-problems
 */

import type { DiagnosticSeverity, EditorDiagnostic } from '../editor/diagnostics';

/** Re-export list-row shape used by the panel (alias of editor diagnostics). */
export type EditorProblem = Pick<
  EditorDiagnostic,
  'line' | 'severity' | 'message' | 'source'
> & {
  column?: number;
  from?: number;
  to?: number;
};

const DEFAULT_MSG_MAX = 120;

/** Rank for sort / badge priority (lower = worse). */
export function severityRank(severity: DiagnosticSeverity | string): number {
  switch (String(severity).toLowerCase()) {
    case 'error':
    case 'err':
    case 'fatal':
      return 0;
    case 'warning':
    case 'warn':
      return 1;
    case 'info':
    case 'information':
    case 'hint':
    case 'debug':
    default:
      return 2;
  }
}

/** Truncate a problem message for list rows (ellipsis when clipped). */
export function truncateProblemMessage(
  message: string,
  maxLen: number = DEFAULT_MSG_MAX,
): string {
  const m = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (maxLen <= 0 || m.length <= maxLen) return m;
  if (maxLen <= 1) return '…';
  return `${m.slice(0, maxLen - 1)}…`;
}

/** Format line column: `12` or `—` when unknown. */
export function formatProblemLine(line: number): string {
  if (!Number.isFinite(line) || line < 1) return '—';
  return String(Math.trunc(line));
}

/** Map full CM diagnostics to compact problem rows (stable order preserved). */
export function diagnosticsToProblems(
  diags: readonly EditorDiagnostic[] | null | undefined,
): EditorProblem[] {
  if (!diags?.length) return [];
  return diags.map((d) => ({
    line: d.line,
    severity: d.severity,
    message: d.message,
    source: d.source,
    from: d.from,
    to: d.to,
  }));
}

/** Count errors / warnings for badge text. */
export function countProblemsBySeverity(
  problems: readonly Pick<EditorProblem, 'severity'>[],
): {
  errors: number;
  warnings: number;
  total: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const p of problems) {
    if (p.severity === 'error') errors += 1;
    else if (p.severity === 'warning') warnings += 1;
  }
  return { errors, warnings, total: problems.length };
}
