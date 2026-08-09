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
 * Import local PYNE / Pine Script™ source files into the active script library.
 *
 * Accepted extensions (case-insensitive):
 * - **`.pyne`** — preferred product extension (HOOX / PYNE / AXIS)
 * - **`.pine`**, **`.pinescript`**, **`.pinev5`**, **`.pinev6`** — TradingView®
 *   and legacy community exports
 *
 * Used by app-wide drag-and-drop and optional file-picker paths. Pure helpers
 * (`isPyneFileName`, `scriptNameFromFileName`, `filterPyneFiles`,
 * {@link sanitizePyneSource}) are unit-tested; {@link importPyneFiles} calls
 * {@link writeScript} for each accepted file.
 *
 * TradingView® community scrapes often end with an `Expand (N lines)` UI stub
 * when the code panel was collapsed — that text is **not** Pine Script™; we
 * strip it and surface a truncation warning (the missing lines were never in
 * the file).
 */

import type { ScriptMeta } from '../plugins/types';
import { writeScript } from './service';

/**
 * Extensions we treat as PYNE / Pine Script™ source files.
 * Prefer `.pyne` for new HOOX stack work; keep `.pine*` for TV exports.
 */
const PINE_EXT = /\.(pyne|pine|pinescript|pinev5|pinev6)$/i;

/**
 * TradingView community collapsed-code chrome, e.g. `Expand (132 lines)`.
 * Closing `)` is sometimes missing in bad scrapes.
 */
const EXPAND_STUB_RE = /^\s*Expand\s*\(\s*(\d+)\s*lines?\s*\)?\s*$/i;

/** Markdown fence leftover from docs/community scrapes. */
const FENCE_RE = /^\s*```/;

/** Common TradingView community / docs chrome lines after real pine. */
const UI_CHROME_RE =
  /^\s*(Copy(\s+code)?|Copied|Pine\s+Script\s*®?|Share|Open\s+in\s+editor)\s*$/i;

/** True when a file name looks like a PYNE / Pine Script™ source file. */
export function isPyneFileName(name: string): boolean {
  return PINE_EXT.test(String(name || '').trim());
}

/**
 * Derive a library display name from a file path/name.
 * Strips directories and known source extensions (`.pyne`, `.pine`, …).
 */
export function scriptNameFromFileName(fileName: string): string {
  const base = String(fileName || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim() || 'Imported';
  const stripped = base.replace(PINE_EXT, '').trim();
  return stripped || 'Imported';
}

/** Filter a FileList / File array down to Pine sources (order preserved). */
export function filterPyneFiles(files: ArrayLike<File> | File[]): File[] {
  const list = Array.from(files as ArrayLike<File>);
  return list.filter((f) => f && isPyneFileName(f.name));
}

/** True when a DataTransfer (or similar) carries at least one Pine file. */
export function dataTransferHasPyneFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  // During dragover, browsers often only expose types, not full FileList
  if (dt.files && dt.files.length > 0) {
    return filterPyneFiles(dt.files).length > 0;
  }
  const items = dt.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.kind === 'file') {
        // File name may be available via getAsFile() or type heuristics
        const file = item.getAsFile?.();
        if (file && isPyneFileName(file.name)) return true;
        // Some browsers only give a generic type during drag — accept Files
        if (item.type === '' || item.type.startsWith('text/') || item.type === 'application/octet-stream') {
          // Can't know extension yet; treat as possible pine if only Files are dragged
          // Caller should still filter on drop.
        }
      }
    }
  }
  // Fallback: if dragging files at all, allow drop target (filter on drop)
  const types = Array.from(dt.types || []);
  return types.includes('Files');
}

/** Result of stripping TradingView community / docs chrome from raw file text. */
export interface SanitizePyneResult {
  /** Cleaned source ready for the library / editor. */
  content: string;
  /**
   * When the source ended with `Expand (N lines)`, N is the count of lines that
   * were never copied (TradingView collapsed panel). The body is incomplete.
   */
  missingLines?: number;
  /** Human-readable notes (truncation, chrome stripped, …). */
  warnings: string[];
}

/**
 * Strip TradingView / markdown chrome from a dropped Pine source.
 *
 * Most important: remove trailing `Expand (N lines)` UI stubs. That text is
 * page chrome from a **collapsed** community code panel — the N lines were
 * never in the file; we cannot recover them here.
 */
export function sanitizePyneSource(raw: string): SanitizePyneResult {
  const warnings: string[] = [];
  let missingLines: number | undefined;
  const lines = String(raw ?? '').split(/\r?\n/);
  const out: string[] = [];
  let sawPine = false;

  for (const line of lines) {
    const expand = EXPAND_STUB_RE.exec(line);
    if (expand) {
      const n = Number(expand[1]);
      if (Number.isFinite(n) && n > 0) missingLines = (missingLines ?? 0) + n;
      // Drop the stub; stop so trailing page chrome cannot re-enter.
      if (sawPine) break;
      continue;
    }

    if (FENCE_RE.test(line)) {
      if (sawPine) break;
      continue;
    }

    if (sawPine && UI_CHROME_RE.test(line)) {
      break;
    }

    out.push(line);
    if (!sawPine && line.trim()) {
      // Any non-empty kept line after leading chrome counts as body start
      sawPine = true;
    }
  }

  // Trim trailing blank lines introduced by strip
  while (out.length && !out[out.length - 1]!.trim()) out.pop();
  // Preserve a single trailing newline for editor friendliness
  let content = out.join('\n');
  if (content && !content.endsWith('\n')) content += '\n';

  if (missingLines != null && missingLines > 0) {
    warnings.push(
      `Source looks truncated (TradingView “Expand (${missingLines} lines)” chrome). ` +
        `Re-copy with the full script expanded on TradingView — those lines were never in the file.`,
    );
  }

  return { content, missingLines, warnings };
}

/** One successfully imported script (meta + full source body). */
export interface ImportedPyneScript {
  meta: ScriptMeta;
  /** Full file text as written to the library (use this to open editor tabs). */
  content: string;
  /** Present when TradingView community collapse chrome indicated missing lines. */
  missingLines?: number;
  warnings?: string[];
}

export interface ImportPyneResult {
  /** Successfully saved scripts (in file order). */
  imported: ImportedPyneScript[];
  /** Per-file error messages (e.g. read/write failures). */
  errors: string[];
  /** Non-fatal warnings (truncation, chrome stripped, …). */
  warnings: string[];
  /** Count of non-pine files skipped. */
  skipped: number;
}

/**
 * Read a dropped/selected File as UTF-8 text.
 * Uses TextDecoder so large scripts keep every line (no partial reads).
 */
export async function readFileAsText(file: File): Promise<string> {
  // Prefer arrayBuffer + UTF-8 decode for full fidelity on large drops.
  if (typeof file.arrayBuffer === 'function') {
    const buf = await file.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  }
  return file.text();
}

/** In-memory source ready for library import (browser File or desktop open). */
export interface PyneSourceInput {
  /** File name or path used for display / extension checks. */
  name: string;
  /** Full UTF-8 source text. */
  content: string;
  /** Optional original path for library `path` metadata. */
  path?: string;
}

/**
 * Write already-read Pine sources into the active script library.
 *
 * Used by browser File import and the Tauri desktop open flow (paths are
 * already filtered by extension on the host when possible).
 */
export async function importPyneSources(
  sources: PyneSourceInput[],
): Promise<ImportPyneResult> {
  const all = Array.isArray(sources) ? sources : [];
  const pine = all.filter((s) => s && isPyneFileName(s.name));
  const skipped = all.length - pine.length;
  const imported: ImportedPyneScript[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const stamp = Date.now().toString(36);

  for (let i = 0; i < pine.length; i++) {
    const src = pine[i]!;
    const label = src.name;
    const name = scriptNameFromFileName(label);
    try {
      const raw = String(src.content ?? '');
      if (!raw.trim()) {
        errors.push(`${label}: empty file`);
        continue;
      }
      const cleaned = sanitizePyneSource(raw);
      if (!cleaned.content.trim()) {
        errors.push(`${label}: empty after removing page chrome`);
        continue;
      }
      for (const w of cleaned.warnings) {
        warnings.push(`${label}: ${w}`);
      }
      const pathMeta = src.path || label;
      const desc =
        cleaned.missingLines != null
          ? `Imported from ${pathMeta} (truncated — missing ~${cleaned.missingLines} lines)`
          : `Imported from ${pathMeta}`;
      const meta = await writeScript({
        // Unique even when many files import in the same millisecond
        id: `s_${stamp}_${i}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        content: cleaned.content,
        path: pathMeta,
        description: desc,
      });
      imported.push({
        meta,
        content: cleaned.content,
        missingLines: cleaned.missingLines,
        warnings: cleaned.warnings,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${label}: ${msg}`);
    }
  }

  return { imported, errors, warnings, skipped };
}

/**
 * Read Pine source files and write each into the active script library.
 *
 * @param files - FileList or File array (non-pine entries are skipped)
 * @returns summary of imports / errors / skipped
 */
export async function importPyneFiles(
  files: ArrayLike<File> | File[],
): Promise<ImportPyneResult> {
  const all = Array.from(files as ArrayLike<File>);
  const sources: PyneSourceInput[] = [];
  const readErrors: string[] = [];
  for (const file of all) {
    if (!file) continue;
    try {
      const content = await readFileAsText(file);
      sources.push({ name: file.name, content, path: file.name });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      readErrors.push(`${file.name}: ${msg}`);
    }
  }

  const result = await importPyneSources(sources);
  if (readErrors.length) {
    result.errors = [...readErrors, ...result.errors];
  }
  return result;
}
