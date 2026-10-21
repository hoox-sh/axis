// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
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

import type { ScriptDocument, ScriptMeta, ScriptVersion } from '../plugins/types';
import { metaFromScriptContent } from '../indicators/script-meta';
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
import {
  forgeList,
  forgeRead,
  forgeRemove,
  forgeWrite,
  type GitForge,
  type IndexFile,
} from './git-forge';

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
  ref?: string,
): Promise<{ content: string; blobId: string } | null> {
  try {
    const at = encodeURIComponent(ref || cfg.branch);
    const { json } = await gl(cfg, `${fileUrl(cfg, filePath)}?ref=${at}`);
    const encoding = String(json.encoding || 'base64');
    const raw = String(json.content || '');
    const content = encoding === 'base64' ? b64Decode(raw) : raw;
    return { content, blobId: String(json.blob_id || json.commit_id || '') };
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/**
 * Commit history for a path (newest first).
 * `GET /projects/:id/repository/commits?path=…`
 */
export async function gitlabListFileCommits(
  cfg: GitConfig,
  filePath: string,
  opts?: { limit?: number },
): Promise<ScriptVersion[]> {
  assertGitConfig(cfg);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 30));
  const q = new URLSearchParams({
    path: filePath,
    ref_name: cfg.branch,
    per_page: String(limit),
  });
  const url = `${cfg.apiBaseUrl}/projects/${projectRef(cfg)}/repository/commits?${q}`;
  const headers = gitlabAuthHeaders(cfg.token);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = String((JSON.parse(text) as { message?: string }).message || text);
    } catch {
      /* keep */
    }
    throw new Error(`GitLab: ${msg || `HTTP ${res.status}`}`);
  }
  let arr: unknown[] = [];
  try {
    const parsed = JSON.parse(text) as unknown;
    arr = Array.isArray(parsed) ? parsed : [];
  } catch {
    arr = [];
  }
  const out: ScriptVersion[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const c = row as {
      id?: string;
      short_id?: string;
      title?: string;
      message?: string;
      author_name?: string;
      committed_date?: string;
      created_at?: string;
      web_url?: string;
    };
    const sha = String(c.id || '');
    if (!sha) continue;
    const msg =
      String(c.title || '').trim() ||
      String(c.message || '').split('\n')[0] ||
      '(no message)';
    const dateStr = c.committed_date || c.created_at || '';
    const committedAt = dateStr ? Date.parse(dateStr) : Date.now();
    out.push({
      sha,
      shortSha: String(c.short_id || sha.slice(0, 7)),
      message: msg,
      author: c.author_name ? String(c.author_name) : undefined,
      committedAt: Number.isFinite(committedAt) ? committedAt : Date.now(),
      url: c.web_url ? String(c.web_url) : undefined,
    });
  }
  return out;
}

/** Read file body at an arbitrary commit / branch ref. */
export async function gitlabGetFileAtRef(
  cfg: GitConfig,
  filePath: string,
  ref: string,
): Promise<{ content: string; blobId: string } | null> {
  return gitlabGetFile(cfg, filePath, ref);
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

/**
 * The GitLab half of the git storage backend.
 *
 * Only the parts that genuinely differ from GitHub live here: the URL shape,
 * the auth header, plain-text content encoding and the exists/not-exists
 * update token.
 */
export const gitlabForge: GitForge = {
  label: 'GitLab',
  getFile: async (cfg, filePath, ref) => {
    const file = await gitlabGetFile(cfg, filePath, ref);
    // The provider names the blob id differently; the forge uses one shape.
    return file ? { content: file.content, sha: file.blobId } : null;
  },
  getFileAtRef: async (cfg, filePath, ref) => {
    const file = await gitlabGetFileAtRef(cfg, filePath, ref);
    // The provider names the blob id differently; the forge uses one shape.
    return file ? { content: file.content, sha: file.blobId } : null;
  },
  listFileCommits: (cfg, filePath, opts) => gitlabListFileCommits(cfg, filePath, opts),
  fileToken: (file) => file !== null,
  putFile: async (cfg, filePath, content, message, token) => {
    const r = await gitlabPutFile(cfg, filePath, content, message, token === true);
    return { revision: r.commitId || `gl-${Date.now()}` };
  },
  deleteFile: async (cfg, filePath, message) => {
    await gitlabDeleteFile(cfg, filePath, message);
  },
  readIndex: async (cfg, opts) => {
    const { index, exists } = await gitlabReadIndex(cfg, opts);
    return { index, token: exists };
  },
  writeIndex: async (cfg, index, token, message) => {
    await gitlabWriteIndex(cfg, index, token === true, message);
  },
  // GitLab may answer 400/409/422 on a race; retry re-read.
  isIndexConflict: (status) => status === 400 || status === 409 || status === 422,
  status: (cfg) => gitlabStatus(cfg),
};

/** List scripts from the index, newest first. */
export async function gitlabList(cfg: GitConfig): Promise<ScriptMeta[]> {
  return forgeList(cfg, gitlabForge);
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
    revision: file.blobId || meta?.revision,
    tags: meta?.tags,
    scriptKind: derived.scriptKind,
    pineVersion: derived.pineVersion,
  };
}

/** Write script body and upsert index entry. */
export async function gitlabWrite(cfg: GitConfig, doc: ScriptDocument): Promise<ScriptMeta> {
  return forgeWrite(cfg, gitlabForge, doc);
}

/** Delete script file (if present) and drop index entry. */
export async function gitlabRemove(cfg: GitConfig, id: string): Promise<void> {
  await forgeRemove(cfg, gitlabForge, id);
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
