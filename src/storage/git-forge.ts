// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The git storage backend, split into a provider half and a shared half.
 *
 * GitHub and GitLab were two near-identical files: twelve of their functions
 * had the same body, and the dispatch in `git.ts` picked between them with
 * nine ternaries. The provider half is now a {@link GitForge} — the parts
 * that genuinely differ (URL shape, auth header, encoding, update token) —
 * and the shared half lives here.
 *
 * @module storage/git-forge
 */

import { metaFromScriptContent } from '../indicators/script-meta';
import {
  type GitConfig,
  assertSafeRepoPath,
  formatCommitMessage,
  resolveScriptRepoPath,
} from './git-config';
import type { ScriptDocument, ScriptMeta, ScriptVersion } from '../plugins/types';

/** On-disk library index committed alongside script files. */
export interface IndexFile {
  version: 1;
  scripts: ScriptMeta[];
}

/**
 * Provider-specific update token.
 *
 * GitHub identifies a blob by its sha; GitLab only needs to know whether the
 * file exists. Both fit in this token type.
 */
export type GitToken = string | boolean | null;

/** The provider half of a git storage backend. */
export interface GitForge {
  /** Human label used in error messages (`GitHub` / `GitLab`). */
  readonly label: string;
  /** Fetch a file; `null` when it does not exist. */
  getFile(
    cfg: GitConfig,
    filePath: string,
    ref?: string,
  ): Promise<{ content: string; sha: string } | null>;
  /** Read a file at a specific ref; `null` when it does not exist. */
  getFileAtRef(
    cfg: GitConfig,
    filePath: string,
    ref: string,
  ): Promise<{ content: string; sha: string } | null>;
  /** Commit history for a file, newest first. */
  listFileCommits(
    cfg: GitConfig,
    filePath: string,
    opts?: { limit?: number },
  ): Promise<ScriptVersion[]>;
  /**
   * The update token for a file that already exists.
   * `null` / `false` means "create it".
   */
  fileToken(file: { content: string; sha: string } | null): GitToken;
  /** Write a file. Returns the revision id of the new content. */
  putFile(
    cfg: GitConfig,
    filePath: string,
    content: string,
    message: string,
    token: GitToken,
  ): Promise<{ revision: string | undefined }>;
  /** Delete a file. */
  deleteFile(cfg: GitConfig, filePath: string, message: string, token: GitToken): Promise<void>;
  /** Read the library index. */
  readIndex(
    cfg: GitConfig,
    opts?: { forWrite?: boolean },
  ): Promise<{ index: IndexFile; token: GitToken }>;
  /** Commit the library index. */
  writeIndex(cfg: GitConfig, index: IndexFile, token: GitToken, message: string): Promise<void>;
  /** Whether an index-write conflict should be retried. */
  isIndexConflict(status: number | undefined): boolean;
  /** Probe repository access. */
  status(cfg: GitConfig): Promise<{
    connected: boolean;
    remote?: string;
    branch?: string;
    error?: string;
  }>;
}

/** Index-write retries before the failure is surfaced. */
const INDEX_WRITE_RETRIES = 3;

/**
 * Merge `apply` into a freshly read index and commit it.
 *
 * Retries on a conflict (two writers raced), because the index is the
 * catalog and a lost update loses a script entry. If the script file was
 * already committed but the index write failed, the error says so — the
 * content is in the repo, only the catalog entry is missing.
 */
export async function upsertIndexEntry(
  cfg: GitConfig,
  forge: GitForge,
  apply: (index: IndexFile) => void,
  message: string,
  context: { scriptCommitted: boolean; scriptPath?: string },
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < INDEX_WRITE_RETRIES; attempt++) {
    try {
      const { index, token } = await forge.readIndex(cfg, { forWrite: true });
      apply(index);
      await forge.writeIndex(cfg, index, token, message);
      return;
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (forge.isIndexConflict(status) && attempt < INDEX_WRITE_RETRIES - 1) continue;
      break;
    }
  }
  const base = lastErr instanceof Error ? lastErr.message : String(lastErr);
  if (context.scriptCommitted) {
    throw new Error(
      `${base} — script file was committed` +
        (context.scriptPath ? ` (${context.scriptPath})` : '') +
        ' but index update failed; retry Save or fix library/index.json',
    );
  }
  throw lastErr instanceof Error ? lastErr : new Error(base);
}

/** List scripts from the index, newest `updatedAt` first. */
export async function forgeList(cfg: GitConfig, forge: GitForge): Promise<ScriptMeta[]> {
  const { index } = await forge.readIndex(cfg);
  return [...index.scripts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Read a script file + merge metadata from the index. */
export async function forgeRead(
  cfg: GitConfig,
  forge: GitForge,
  id: string,
): Promise<ScriptDocument> {
  const { index } = await forge.readIndex(cfg);
  const meta = index.scripts.find((s) => s.id === id);
  const path = resolveScriptRepoPath(cfg, {
    id,
    indexPath: meta?.path,
  });
  const file = await forge.getFile(cfg, path);
  if (!file) throw new Error(`Script not found in repo: ${id}`);
  const derived = metaFromScriptContent(file.content, {
    scriptKind: meta?.scriptKind,
    pineVersion: meta?.pineVersion,
  });
  return {
    id,
    name: meta?.name || id,
    description: meta?.description,
    path,
    content: file.content,
    updatedAt: meta?.updatedAt || Date.now(),
    createdAt: meta?.createdAt,
    revision: file.sha,
    tags: meta?.tags,
    scriptKind: derived.scriptKind,
    pineVersion: derived.pineVersion,
  };
}

/** Write the script body and upsert the index entry (two commits). */
export async function forgeWrite(
  cfg: GitConfig,
  forge: GitForge,
  doc: ScriptDocument,
): Promise<ScriptMeta> {
  const now = Date.now();
  // Resolve the path against the current index so re-saves keep legacy .pine paths
  const { index: preIndex } = await forge.readIndex(cfg, { forWrite: true });
  const prevMeta = preIndex.scripts.find((s) => s.id === doc.id);
  const path = resolveScriptRepoPath(cfg, {
    id: doc.id,
    docPath: doc.path,
    indexPath: prevMeta?.path,
  });
  assertSafeRepoPath(cfg, path);

  const existing = await forge.getFile(cfg, path);
  const msg = formatCommitMessage(cfg.commitMessageTemplate, doc.name);
  const put = await forge.putFile(cfg, path, doc.content, msg, forge.fileToken(existing));

  const derived = metaFromScriptContent(doc.content, {
    scriptKind: doc.scriptKind ?? prevMeta?.scriptKind,
    pineVersion: doc.pineVersion ?? prevMeta?.pineVersion,
  });
  let meta: ScriptMeta = {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    path,
    updatedAt: now,
    createdAt: prevMeta?.createdAt || doc.createdAt || now,
    revision: put.revision,
    tags: doc.tags,
    scriptKind: derived.scriptKind,
    pineVersion: derived.pineVersion,
  };

  await upsertIndexEntry(
    cfg,
    forge,
    (index) => {
      const prev = index.scripts.find((s) => s.id === doc.id);
      meta = {
        ...meta,
        createdAt: prev?.createdAt || meta.createdAt,
      };
      index.scripts = index.scripts.filter((s) => s.id !== doc.id);
      index.scripts.push(meta);
    },
    formatCommitMessage(cfg.commitMessageTemplate, `index ${doc.name}`),
    { scriptCommitted: true, scriptPath: path },
  );
  return meta;
}

/** Delete the script file (if present) and drop its index entry. */
export async function forgeRemove(cfg: GitConfig, forge: GitForge, id: string): Promise<void> {
  const { index } = await forge.readIndex(cfg, { forWrite: true });
  const meta = index.scripts.find((s) => s.id === id);
  const path = resolveScriptRepoPath(cfg, {
    id,
    indexPath: meta?.path,
  });
  const file = await forge.getFile(cfg, path);
  let deleted = false;
  if (file) {
    await forge.deleteFile(
      cfg,
      path,
      formatCommitMessage(cfg.commitMessageTemplate, `delete ${meta?.name || id}`),
      forge.fileToken(file),
    );
    deleted = true;
  }
  await upsertIndexEntry(
    cfg,
    forge,
    (idx) => {
      idx.scripts = idx.scripts.filter((s) => s.id !== id);
    },
    formatCommitMessage(cfg.commitMessageTemplate, `index remove ${id}`),
    { scriptCommitted: deleted, scriptPath: path },
  );
}
