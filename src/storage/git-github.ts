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
 * GitHub Contents API adapter for the git storage plugin.
 *
 * Layout: `{basePath}/library/index.json` + `{id}.pyne` files (legacy `.pine`
 * via index path). Each put/delete is a commit on the configured branch
 * (Contents API = auto-push). Library index is rewritten on every write/remove.
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

/** On-disk library index committed alongside script files. */
export interface IndexFile {
  version: 1;
  scripts: ScriptMeta[];
}

const INDEX_WRITE_RETRIES = 3;

async function gh(
  cfg: GitConfig,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  assertGitConfig(cfg);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${cfg.apiBaseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const msg = String(json.message || text || `HTTP ${res.status}`);
    let detail = msg;
    if (res.status === 409) {
      detail = `${msg} (conflict — retry with fresh file sha)`;
    } else if (res.status === 403 || res.status === 429) {
      detail = `${msg} (rate limited or forbidden)`;
    }
    const err = new Error(`GitHub: ${detail}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return { status: res.status, json, text };
}

function b64Encode(s: string): string {
  // UTF-8 safe
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64Decode(s: string): string {
  const bin = atob(s.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function repoPath(cfg: GitConfig, filePath: string): string {
  const enc = filePath
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/');
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${enc}`;
}

/** Fetch a file; returns null on 404. Content is UTF-8 decoded from base64. */
export async function githubGetFile(
  cfg: GitConfig,
  filePath: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const { json } = await gh(cfg, `${repoPath(cfg, filePath)}?ref=${encodeURIComponent(cfg.branch)}`);
    if (json.type === 'file' && typeof json.content === 'string') {
      return { content: b64Decode(String(json.content)), sha: String(json.sha) };
    }
    return null;
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** Create or update a file (pass previous `sha` for updates). */
export async function githubPutFile(
  cfg: GitConfig,
  filePath: string,
  content: string,
  message: string,
  sha?: string,
): Promise<{ sha: string; commitSha?: string }> {
  const body: Record<string, unknown> = {
    message,
    content: b64Encode(content),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const { json } = await gh(cfg, repoPath(cfg, filePath), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const contentObj = json.content as { sha?: string } | undefined;
  const commitObj = json.commit as { sha?: string } | undefined;
  return {
    sha: String(contentObj?.sha || ''),
    commitSha: commitObj?.sha,
  };
}

/** Delete a file at the given blob sha. */
export async function githubDeleteFile(
  cfg: GitConfig,
  filePath: string,
  message: string,
  sha: string,
): Promise<void> {
  await gh(cfg, repoPath(cfg, filePath), {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: cfg.branch }),
  });
}

/** Read library index.json (empty index if missing). */
export async function githubReadIndex(
  cfg: GitConfig,
  opts?: { forWrite?: boolean },
): Promise<{
  index: IndexFile;
  sha: string | null;
  corrupt?: boolean;
}> {
  const file = await githubGetFile(cfg, indexPath(cfg));
  if (!file) return { index: { version: 1, scripts: [] }, sha: null };
  try {
    const parsed = JSON.parse(file.content) as IndexFile;
    if (!Array.isArray(parsed.scripts)) parsed.scripts = [];
    return { index: parsed, sha: file.sha };
  } catch {
    if (opts?.forWrite) {
      throw new GitIndexCorruptError();
    }
    // List/read: empty catalog without a write sha so we never overwrite on next save
    return { index: { version: 1, scripts: [] }, sha: null, corrupt: true };
  }
}

/** Commit library index.json; returns commit sha when available. */
export async function githubWriteIndex(
  cfg: GitConfig,
  index: IndexFile,
  sha: string | null,
  message: string,
): Promise<string | undefined> {
  const r = await githubPutFile(
    cfg,
    indexPath(cfg),
    JSON.stringify(index, null, 2) + '\n',
    message,
    sha || undefined,
  );
  return r.commitSha;
}

/**
 * Merge `apply` into a freshly read index and commit, retrying on 409.
 * Throws a structured error if all retries fail after a script file was written.
 */
async function githubUpsertIndexEntry(
  cfg: GitConfig,
  apply: (index: IndexFile) => void,
  message: string,
  context: { scriptCommitted: boolean; scriptPath?: string },
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < INDEX_WRITE_RETRIES; attempt++) {
    try {
      const { index, sha } = await githubReadIndex(cfg, { forWrite: true });
      apply(index);
      await githubWriteIndex(cfg, index, sha, message);
      return;
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (status === 409 && attempt < INDEX_WRITE_RETRIES - 1) continue;
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
export async function githubList(cfg: GitConfig): Promise<ScriptMeta[]> {
  const { index } = await githubReadIndex(cfg);
  return [...index.scripts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Read a script file + merge metadata from the index. */
export async function githubRead(cfg: GitConfig, id: string): Promise<ScriptDocument> {
  const { index } = await githubReadIndex(cfg);
  const meta = index.scripts.find((s) => s.id === id);
  const path = resolveScriptRepoPath(cfg, {
    id,
    docPath: meta?.path,
    indexPath: meta?.path,
  });
  const file = await githubGetFile(cfg, path);
  if (!file) throw new Error(`Script not found in repo: ${id}`);
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
  };
}

/** Write script body and upsert index entry (two commits; index retried on 409). */
export async function githubWrite(cfg: GitConfig, doc: ScriptDocument): Promise<ScriptMeta> {
  const now = Date.now();
  // Resolve path against current index so re-saves keep legacy .pine paths
  const { index: preIndex } = await githubReadIndex(cfg, { forWrite: true });
  const prevMeta = preIndex.scripts.find((s) => s.id === doc.id);
  const path = resolveScriptRepoPath(cfg, {
    id: doc.id,
    docPath: doc.path,
    indexPath: prevMeta?.path,
  });
  assertSafeRepoPath(cfg, path);

  const existing = await githubGetFile(cfg, path);
  const msg = formatCommitMessage(cfg.commitMessageTemplate, doc.name);
  const put = await githubPutFile(cfg, path, doc.content, msg, existing?.sha);

  let meta: ScriptMeta = {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    path,
    updatedAt: now,
    createdAt: prevMeta?.createdAt || doc.createdAt || now,
    revision: put.sha || put.commitSha,
    tags: doc.tags,
  };

  await githubUpsertIndexEntry(
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
export async function githubRemove(cfg: GitConfig, id: string): Promise<void> {
  const { index } = await githubReadIndex(cfg, { forWrite: true });
  const meta = index.scripts.find((s) => s.id === id);
  const path = resolveScriptRepoPath(cfg, {
    id,
    indexPath: meta?.path,
  });
  const file = await githubGetFile(cfg, path);
  let deleted = false;
  if (file) {
    await githubDeleteFile(
      cfg,
      path,
      formatCommitMessage(cfg.commitMessageTemplate, `delete ${meta?.name || id}`),
      file.sha,
    );
    deleted = true;
  }
  await githubUpsertIndexEntry(
    cfg,
    (idx) => {
      idx.scripts = idx.scripts.filter((s) => s.id !== id);
    },
    formatCommitMessage(cfg.commitMessageTemplate, `index remove ${id}`),
    { scriptCommitted: deleted, scriptPath: path },
  );
}

/** Probe repo access; returns connected=false with error message on failure. */
export async function githubStatus(cfg: GitConfig): Promise<{
  connected: boolean;
  remote?: string;
  branch?: string;
  error?: string;
}> {
  try {
    assertGitConfig(cfg);
    const { json } = await gh(
      cfg,
      `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,
    );
    return {
      connected: true,
      remote: String(json.full_name || `${cfg.owner}/${cfg.repo}`),
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
