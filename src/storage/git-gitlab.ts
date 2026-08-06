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
 * GitLab Repository Files API adapter for the git storage plugin.
 *
 * Same library layout as GitHub (`index.json` + `.pyne` / legacy `.pine`).
 * Auth: `PRIVATE-TOKEN` for PATs (`glpat-…`); `Authorization: Bearer` for
 * OAuth device-flow tokens (both sent when not a classic PAT).
 * Project identity from `projectId` or `owner/repo`.
 */

import type { ScriptDocument, ScriptMeta } from '../plugins/types';
import {
  type GitConfig,
  GitIndexCorruptError,
  assertGitConfig,
  assertSafeRepoPath,
  formatCommitMessage,
  indexPath,
  resolveScriptRepoPath,
  scriptPath,
} from './git-config';
import type { IndexFile } from './git-github';

const INDEX_WRITE_RETRIES = 3;

function projectRef(cfg: GitConfig): string {
  // Prefer raw group/project; encode once. If already %-encoded, decode first.
  const raw = cfg.projectId
    ? cfg.projectId.includes('%')
      ? decodeURIComponent(cfg.projectId)
      : cfg.projectId
    : `${cfg.owner}/${cfg.repo}`;
  return encodeURIComponent(raw);
}

/** Auth headers for PAT vs OAuth access tokens. */
function gitlabAuthHeaders(token: string): Record<string, string> {
  const t = String(token || '');
  // Personal access tokens (classic + glpat-) use PRIVATE-TOKEN
  if (t.startsWith('glpat-') || t.startsWith('gloas-')) {
    return { 'PRIVATE-TOKEN': t };
  }
  // OAuth device-flow / app tokens: Bearer is required; keep PRIVATE-TOKEN
  // as a fallback for unprefixed PATs some instances still accept.
  return {
    Authorization: `Bearer ${t}`,
    'PRIVATE-TOKEN': t,
  };
}

function fileUrl(cfg: GitConfig, filePath: string): string {
  const enc = encodeURIComponent(filePath);
  return `${cfg.apiBaseUrl}/projects/${projectRef(cfg)}/repository/files/${enc}`;
}

async function gl(
  cfg: GitConfig,
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  assertGitConfig(cfg);
  const headers: Record<string, string> = {
    ...gitlabAuthHeaders(cfg.token),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg = String(json.message || json.error || text || `HTTP ${res.status}`);
    const err = new Error(`GitLab: ${msg}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return { status: res.status, json };
}

function b64Decode(s: string): string {
  const bin = atob(s.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Fetch a repository file; returns null on 404. */
export async function gitlabGetFile(
  cfg: GitConfig,
  filePath: string,
): Promise<{ content: string; blobId: string } | null> {
  try {
    const { json } = await gl(
      cfg,
      `${fileUrl(cfg, filePath)}?ref=${encodeURIComponent(cfg.branch)}`,
    );
    const encoding = String(json.encoding || 'base64');
    const raw = String(json.content || '');
    const content = encoding === 'base64' ? b64Decode(raw) : raw;
    return { content, blobId: String(json.blob_id || json.commit_id || '') };
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** Create (`POST`) or update (`PUT`) a text file on the branch. */
export async function gitlabPutFile(
  cfg: GitConfig,
  filePath: string,
  content: string,
  message: string,
  exists: boolean,
): Promise<{ commitId?: string }> {
  const body = {
    branch: cfg.branch,
    content,
    commit_message: message,
    encoding: 'text',
  };
  const { json } = await gl(cfg, fileUrl(cfg, filePath), {
    method: exists ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
  return { commitId: String(json.commit_id || '') };
}

/** Delete a repository file with a commit message. */
export async function gitlabDeleteFile(
  cfg: GitConfig,
  filePath: string,
  message: string,
): Promise<void> {
  await gl(cfg, fileUrl(cfg, filePath), {
    method: 'DELETE',
    body: JSON.stringify({
      branch: cfg.branch,
      commit_message: message,
    }),
  });
}

/** Read library index.json; `exists` false when file is missing. */
export async function gitlabReadIndex(
  cfg: GitConfig,
  opts?: { forWrite?: boolean },
): Promise<{
  index: IndexFile;
  exists: boolean;
  corrupt?: boolean;
}> {
  const file = await gitlabGetFile(cfg, indexPath(cfg));
  if (!file) return { index: { version: 1, scripts: [] }, exists: false };
  try {
    const parsed = JSON.parse(file.content) as IndexFile;
    if (!Array.isArray(parsed.scripts)) parsed.scripts = [];
    return { index: parsed, exists: true };
  } catch {
    if (opts?.forWrite) {
      throw new GitIndexCorruptError();
    }
    return { index: { version: 1, scripts: [] }, exists: false, corrupt: true };
  }
}

/** Commit library index.json (create vs update via `exists`). */
export async function gitlabWriteIndex(
  cfg: GitConfig,
  index: IndexFile,
  exists: boolean,
  message: string,
): Promise<void> {
  await gitlabPutFile(cfg, indexPath(cfg), JSON.stringify(index, null, 2) + '\n', message, exists);
}

async function gitlabUpsertIndexEntry(
  cfg: GitConfig,
  apply: (index: IndexFile) => void,
  message: string,
  context: { scriptCommitted: boolean; scriptPath?: string },
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < INDEX_WRITE_RETRIES; attempt++) {
    try {
      const { index, exists } = await gitlabReadIndex(cfg, { forWrite: true });
      apply(index);
      await gitlabWriteIndex(cfg, index, exists, message);
      return;
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      // GitLab may return 400/409 on race; retry re-read
      if ((status === 400 || status === 409 || status === 422) && attempt < INDEX_WRITE_RETRIES - 1) {
        continue;
      }
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

/** List scripts from the index, newest first. */
export async function gitlabList(cfg: GitConfig): Promise<ScriptMeta[]> {
  const { index } = await gitlabReadIndex(cfg);
  return [...index.scripts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Read a script file + merge metadata from the index. */
export async function gitlabRead(cfg: GitConfig, id: string): Promise<ScriptDocument> {
  const { index } = await gitlabReadIndex(cfg);
  const meta = index.scripts.find((s) => s.id === id);
  const path = resolveScriptRepoPath(cfg, {
    id,
    indexPath: meta?.path,
  });
  const file = await gitlabGetFile(cfg, path);
  if (!file) throw new Error(`Script not found in repo: ${id}`);
  return {
    id,
    name: meta?.name || id,
    description: meta?.description,
    path,
    content: file.content,
    updatedAt: meta?.updatedAt || Date.now(),
    createdAt: meta?.createdAt,
    revision: file.blobId || meta?.revision,
    tags: meta?.tags,
  };
}

/** Write script body and upsert index entry. */
export async function gitlabWrite(cfg: GitConfig, doc: ScriptDocument): Promise<ScriptMeta> {
  const now = Date.now();
  const { index: preIndex } = await gitlabReadIndex(cfg, { forWrite: true });
  const prevMeta = preIndex.scripts.find((s) => s.id === doc.id);
  const path = resolveScriptRepoPath(cfg, {
    id: doc.id,
    docPath: doc.path,
    indexPath: prevMeta?.path,
  });
  assertSafeRepoPath(cfg, path);

  const existing = await gitlabGetFile(cfg, path);
  const msg = formatCommitMessage(cfg.commitMessageTemplate, doc.name);
  const put = await gitlabPutFile(cfg, path, doc.content, msg, !!existing);

  let meta: ScriptMeta = {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    path,
    updatedAt: now,
    createdAt: prevMeta?.createdAt || doc.createdAt || now,
    revision: put.commitId || `gl-${now}`,
    tags: doc.tags,
  };

  await gitlabUpsertIndexEntry(
    cfg,
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

/** Delete script file (if present) and drop index entry. */
export async function gitlabRemove(cfg: GitConfig, id: string): Promise<void> {
  const { index } = await gitlabReadIndex(cfg, { forWrite: true });
  const meta = index.scripts.find((s) => s.id === id);
  const path = resolveScriptRepoPath(cfg, {
    id,
    indexPath: meta?.path,
  });
  const file = await gitlabGetFile(cfg, path);
  let deleted = false;
  if (file) {
    await gitlabDeleteFile(
      cfg,
      path,
      formatCommitMessage(cfg.commitMessageTemplate, `delete ${meta?.name || id}`),
    );
    deleted = true;
  }
  await gitlabUpsertIndexEntry(
    cfg,
    (idx) => {
      idx.scripts = idx.scripts.filter((s) => s.id !== id);
    },
    formatCommitMessage(cfg.commitMessageTemplate, `index remove ${id}`),
    { scriptCommitted: deleted, scriptPath: path },
  );
}

/** Probe project access; returns connected=false with error on failure. */
export async function gitlabStatus(cfg: GitConfig): Promise<{
  connected: boolean;
  remote?: string;
  branch?: string;
  error?: string;
}> {
  try {
    assertGitConfig(cfg);
    const { json } = await gl(cfg, `${cfg.apiBaseUrl}/projects/${projectRef(cfg)}`);
    return {
      connected: true,
      remote: String(json.path_with_namespace || json.name || cfg.projectId || `${cfg.owner}/${cfg.repo}`),
      branch: cfg.branch,
    };
  } catch (e: unknown) {
    return {
      connected: false,
      error: e instanceof Error ? e.message : String(e),
      branch: cfg.branch,
    };
  }
}
