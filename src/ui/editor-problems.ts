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

/** localStorage key for problems panel total height (px). */
export const EDITOR_PROBLEMS_HEIGHT_KEY = 'pynescript.axis.editor.problemsHeight';

/** Default total panel height including header + handle. */
export const EDITOR_PROBLEMS_DEFAULT_HEIGHT = 120;

/** Minimum total height (header + handle + one row). */
export const EDITOR_PROBLEMS_MIN_HEIGHT = 56;

/** Pure clamp for resizable problems panel height. */
export function clampProblemsHeight(h: number, max?: number): number {
  const hi =
    typeof max === 'number' && Number.isFinite(max)
      ? max
      : typeof window !== 'undefined'
        ? Math.floor(window.innerHeight * 0.85)
        : 800;
  if (!Number.isFinite(h)) return EDITOR_PROBLEMS_DEFAULT_HEIGHT;
  return Math.min(
    Math.max(Math.round(h), EDITOR_PROBLEMS_MIN_HEIGHT),
    Math.max(EDITOR_PROBLEMS_MIN_HEIGHT, hi),
  );
}

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
    case 'typo':
      return 2;
    case 'info':
    case 'information':
    case 'hint':
    case 'debug':
      return 3;
    default:
      return 3;
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

/**
 * One-line clipboard text for a problem row
 * (e.g. `L12 [error] Unknown strategy.etry`).
 */
export function formatProblemForCopy(
  p: Pick<EditorProblem, 'line' | 'severity' | 'message' | 'source'>,
): string {
  const line =
    Number.isFinite(p.line) && (p.line as number) >= 1
      ? `L${Math.trunc(p.line as number)}`
      : 'L—';
  const sev = String(p.severity || 'info').toLowerCase();
  const msg = String(p.message ?? '').replace(/\s+/g, ' ').trim();
  const src = p.source && p.source !== 'diagnostic' ? ` (${p.source})` : '';
  return `${line} [${sev}] ${msg}${src}`.trim();
}

/** Multi-line clipboard text for the full problems list. */
export function formatProblemsListForCopy(
  problems: readonly Pick<EditorProblem, 'line' | 'severity' | 'message' | 'source'>[],
): string {
  if (!problems.length) return '';
  return problems.map(formatProblemForCopy).join('\n');
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

/** Count errors / warnings / typos for badge text. */
export function countProblemsBySeverity(
  problems: readonly Pick<EditorProblem, 'severity'>[],
): {
  errors: number;
  warnings: number;
  typos: number;
  total: number;
} {
  let errors = 0;
  let warnings = 0;
  let typos = 0;
  for (const p of problems) {
    if (p.severity === 'error') errors += 1;
    else if (p.severity === 'warning') warnings += 1;
    else if (p.severity === 'typo') typos += 1;
  }
  return { errors, warnings, typos, total: problems.length };
}
