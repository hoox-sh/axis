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
 * Import local `.pine` / `.pinescript` files into the active script library.
 *
 * Used by app-wide drag-and-drop and optional file-picker paths. Pure helpers
 * (`isPineFileName`, `scriptNameFromFileName`, `filterPineFiles`) are unit-tested;
 * {@link importPineFiles} calls {@link writeScript} for each accepted file.
 */

import type { ScriptMeta } from '../plugins/types';
import { writeScript } from './service';

/** Extensions we treat as Pine Script source files. */
const PINE_EXT = /\.(pine|pinescript)$/i;

/** True when a file name looks like a Pine Script source file. */
export function isPineFileName(name: string): boolean {
  return PINE_EXT.test(String(name || '').trim());
}

/**
 * Derive a library display name from a file path/name.
 * Strips directories and the `.pine` / `.pinescript` extension.
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
export function filterPineFiles(files: ArrayLike<File> | File[]): File[] {
  const list = Array.from(files as ArrayLike<File>);
  return list.filter((f) => f && isPineFileName(f.name));
}

/** True when a DataTransfer (or similar) carries at least one Pine file. */
export function dataTransferHasPineFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  // During dragover, browsers often only expose types, not full FileList
  if (dt.files && dt.files.length > 0) {
    return filterPineFiles(dt.files).length > 0;
  }
  const items = dt.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.kind === 'file') {
        // File name may be available via getAsFile() or type heuristics
        const file = item.getAsFile?.();
        if (file && isPineFileName(file.name)) return true;
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

export interface ImportPineResult {
  /** Successfully saved library metas (in file order). */
  imported: ScriptMeta[];
  /** Per-file error messages (e.g. read/write failures). */
  errors: string[];
  /** Count of non-pine files skipped. */
  skipped: number;
}

/**
 * Read Pine source files and write each into the active script library.
 *
 * @param files - FileList or File array (non-pine entries are skipped)
 * @returns summary of imports / errors / skipped
 */
export async function importPineFiles(
  files: ArrayLike<File> | File[],
): Promise<ImportPineResult> {
  const all = Array.from(files as ArrayLike<File>);
  const pine = filterPineFiles(all);
  const skipped = all.length - pine.length;
  const imported: ScriptMeta[] = [];
  const errors: string[] = [];

  for (let i = 0; i < pine.length; i++) {
    const file = pine[i]!;
    const name = scriptNameFromFileName(file.name);
    try {
      const content = await file.text();
      if (!content.trim()) {
        errors.push(`${file.name}: empty file`);
        continue;
      }
      const meta = await writeScript({
        id: `s_${Date.now().toString(36)}_${i}`,
        name,
        content,
        path: file.name,
        description: `Imported from ${file.name}`,
      });
      imported.push(meta);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${file.name}: ${msg}`);
    }
  }

  return { imported, errors, skipped };
}
