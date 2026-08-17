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
 * Match editor Pine source to applied chart scripts for Re-run vs Run, and
 * resolve whether to replace an existing instance or add another.
 *
 * @module indicators/run-target
 */

import type { Indicator } from '../store/types';
import { store } from '../store';
import { runAndApply, type RunOptions, type RunResult } from './runner';

/** How interactive editor Run should target chart scripts. */
export type EditorRunMode =
  /** Replace matching chart script when present; else add. */
  | 'auto'
  /** Force replace of a match when present; else add. */
  | 'replace'
  /** Always add a new chart instance (second / third copy). */
  | 'new';

/** Normalize source for equality (CRLF → LF, trim). */
export function normalizeScriptSource(code: string): string {
  return String(code ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Best-effort Pine title from `indicator("…")` / `strategy("…")` / `library("…")`
 * (positional title or `title=`).
 */
export function extractScriptTitle(code: string): string | null {
  const src = String(code ?? '');
  // title= form first (may appear after shorttitle= etc.)
  const named = src.match(
    /\b(?:indicator|strategy|library)\s*\(\s*[^)]*?\btitle\s*=\s*(["'])([^"']+)\1/i,
  );
  if (named?.[2]) return named[2].trim() || null;
  // positional first string arg
  const pos = src.match(
    /\b(?:indicator|strategy|library)\s*\(\s*(["'])([^"']+)\1/i,
  );
  if (pos?.[2]) return pos[2].trim() || null;
  return null;
}

/** Engine / store placeholders that are not real Pine titles. */
const GENERIC_SCRIPT_NAMES = new Set([
  'plot',
  'indicator',
  'strategy',
  'library',
  'script',
  'untitled',
  'draft',
]);

/**
 * Display name for an applied chart script.
 * **Always prefers the Pine declaration title** over engine meta / file names.
 */
export function resolveScriptDisplayName(
  code: string,
  metaName?: string | null,
  existingName?: string | null,
): string {
  const fromSource = extractScriptTitle(code);
  if (fromSource) return fromSource;

  const meta = metaName != null ? String(metaName).trim() : '';
  if (meta && !GENERIC_SCRIPT_NAMES.has(meta.toLowerCase())) return meta;

  const existing = existingName != null ? String(existingName).trim() : '';
  if (existing && !GENERIC_SCRIPT_NAMES.has(existing.toLowerCase())) {
    return existing;
  }
  if (existing) return existing;
  if (meta) return meta;
  return 'Indicator';
}

/**
 * Prefer results focus when it is one of the matches; else the last match
 * (most recently added instance).
 */
export function pickPreferredScript(
  matches: readonly Indicator[],
  focusId?: string | null,
): Indicator | undefined {
  if (!matches.length) return undefined;
  const focus = focusId ?? store.resultsFocusId;
  if (focus) {
    const hit = matches.find((m) => m.id === focus);
    if (hit) return hit;
  }
  return matches[matches.length - 1];
}

/**
 * Find a chart script to replace for the given editor source.
 * Prefer exact code match, then same Pine title / stored name.
 */
export function findChartScriptForEditor(
  code: string,
  scripts: readonly Indicator[] = store.scripts,
  focusId?: string | null,
): Indicator | undefined {
  const norm = normalizeScriptSource(code);
  if (!norm) return undefined;
  const list = Array.isArray(scripts) ? scripts : [];
  if (!list.length) return undefined;

  const codeMatches = list.filter((s) => normalizeScriptSource(s.code) === norm);
  if (codeMatches.length) return pickPreferredScript(codeMatches, focusId);

  const title = extractScriptTitle(norm);
  if (title) {
    const titleMatches = list.filter(
      (s) => s.name === title || extractScriptTitle(s.code) === title,
    );
    if (titleMatches.length) return pickPreferredScript(titleMatches, focusId);
  }

  return undefined;
}

/** Count chart instances that match this editor source (code or title). */
export function countChartScriptsForEditor(
  code: string,
  scripts: readonly Indicator[] = store.scripts,
): number {
  const norm = normalizeScriptSource(code);
  if (!norm) return 0;
  const list = Array.isArray(scripts) ? scripts : [];
  if (!list.length) return 0;
  const title = extractScriptTitle(norm);
  let n = 0;
  for (const s of list) {
    if (normalizeScriptSource(s.code) === norm) {
      n += 1;
      continue;
    }
    if (title && (s.name === title || extractScriptTitle(s.code) === title)) n += 1;
  }
  return n;
}

/**
 * True when the editor document already has at least one instance on the chart
 * (button should show Re-run + add-instance caret).
 */
export function editorHasChartInstance(code: string): boolean {
  return findChartScriptForEditor(code) != null;
}

/**
 * Run editor source against the chart.
 * - `auto` / `replace` → update matching instance when present
 * - `new` → always {@link runAndApply} without id (add another instance)
 */
export async function runFromEditor(
  code: string,
  opts: RunOptions & { mode?: EditorRunMode } = {},
): Promise<RunResult> {
  const { mode = 'auto', ...runOpts } = opts;
  const src = String(code ?? '');
  let indicatorId: string | undefined;
  if (mode !== 'new') {
    indicatorId = findChartScriptForEditor(src)?.id;
  }
  const inputs =
    runOpts.inputs && Object.keys(runOpts.inputs).length
      ? runOpts.inputs
      : store.editorInputValues && Object.keys(store.editorInputValues).length
        ? store.editorInputValues
        : undefined;
  return runAndApply(src, indicatorId, {
    ...runOpts,
    ...(inputs ? { inputs } : {}),
  });
}
