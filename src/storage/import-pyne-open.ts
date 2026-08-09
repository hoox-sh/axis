/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Shared UI side-effects after importing Pine sources into the library:
 * status bar, system logs, and opening editor tabs.
 *
 * Used by window drag-and-drop and the Tauri desktop File → Open path.
 */

import type { ImportPyneResult } from './import-pyne-files';
import { importPyneFiles, importPyneSources, type PyneSourceInput } from './import-pyne-files';
import { appendLog, setEditorOpen, setStatus } from '../store';

/** Minimal editor surface used when opening imported tabs. */
export interface ImportEditorHost {
  setDoc?: (doc: string) => void;
  loadLibraryDoc?: (doc: string, name?: string, libraryId?: string) => void;
  loadLibraryDocs?: (
    docs: Array<{ content: string; name?: string; libraryId?: string }>,
  ) => void;
}

export interface OpenImportedOptions {
  /** Editor ref (mutated by TabbedEditor on mount). */
  editorRef: ImportEditorHost;
  /** Status prefix when nothing imported (drop vs open). Default: "drop". */
  emptyContext?: 'drop' | 'open';
}

/**
 * Apply import result to status/logs/editor. Returns the same result.
 */
export function applyImportedPyneResult(
  result: ImportPyneResult,
  opts: OpenImportedOptions,
): ImportPyneResult {
  const n = result.imported.length;
  const emptyCtx = opts.emptyContext ?? 'drop';

  if (n > 0) {
    const names = result.imported.map((d) => d.meta.name).join(', ');
    const lineHint = result.imported
      .map((d) => {
        const lines = d.content.split(/\r?\n/).length;
        return `${d.meta.name} (${lines} ln)`;
      })
      .join(', ');
    setStatus(
      'ready',
      n === 1
        ? `Saved "${names}" to script library`
        : `Saved ${n} scripts to library · opened ${n} tabs`,
    );
    appendLog(
      'ok',
      n === 1
        ? `Imported pine file → library: ${lineHint}`
        : `Imported ${n} pine files → library + tabs: ${lineHint}`,
      'library',
    );
    try {
      const docs = result.imported.map((d) => ({
        content: d.content,
        name: d.meta.name,
        libraryId: d.meta.id,
      }));
      const editor = opts.editorRef;
      if (editor.loadLibraryDocs) {
        editor.loadLibraryDocs(docs);
      } else if (editor.loadLibraryDoc) {
        const first = docs[0]!;
        editor.loadLibraryDoc(first.content, first.name, first.libraryId);
      } else {
        editor.setDoc?.(docs[0]!.content);
      }
      setEditorOpen(true);
    } catch {
      /* open is best-effort */
    }
  }

  if (result.warnings.length) {
    const w = result.warnings[0]!;
    setStatus('error', w.length > 160 ? `${w.slice(0, 157)}…` : w);
    for (const line of result.warnings.slice(0, 5)) {
      appendLog('warn', line, 'library');
    }
  }
  if (result.errors.length) {
    const msg = result.errors.slice(0, 3).join('; ');
    setStatus('error', `Pine import: ${msg}`);
    appendLog('error', `Pine import errors: ${msg}`, 'library');
  }
  if (!n && !result.errors.length) {
    setStatus(
      'error',
      emptyCtx === 'open'
        ? 'No Pine scripts selected'
        : 'No Pine scripts found in drop',
    );
  }

  return result;
}

/** Import browser Files and open them in the editor / library. */
export async function importAndOpenPyneFiles(
  files: File[],
  opts: OpenImportedOptions,
): Promise<ImportPyneResult> {
  try {
    const result = await importPyneFiles(files);
    return applyImportedPyneResult(result, opts);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus('error', `Pine import failed: ${msg}`);
    appendLog('error', `Pine import failed: ${msg}`, 'library');
    return { imported: [], errors: [msg], warnings: [], skipped: 0 };
  }
}

/** Import pre-read sources (desktop open) and open them in the editor / library. */
export async function importAndOpenPyneSources(
  sources: PyneSourceInput[],
  opts: OpenImportedOptions,
): Promise<ImportPyneResult> {
  try {
    const result = await importPyneSources(sources);
    return applyImportedPyneResult(result, { ...opts, emptyContext: opts.emptyContext ?? 'open' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus('error', `Pine import failed: ${msg}`);
    appendLog('error', `Pine import failed: ${msg}`, 'library');
    return { imported: [], errors: [msg], warnings: [], skipped: 0 };
  }
}
