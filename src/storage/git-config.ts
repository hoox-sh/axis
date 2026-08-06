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
 * Shared git storage config — types, defaults, path helpers, validation.
 * Used by `git.ts` plugin and GitHub/GitLab adapters.
 *
 * Resolution order: call-site config → `pluginsConfig[storage:git]` / `git` →
 * {@link DEFAULT_GIT_CONFIG}. Empty `apiBaseUrl` becomes api.github.com or
 * gitlab.com/api/v4.
 */

import { store } from '../store';
import { pluginKey } from '../plugins/types';

/** Host API family for the git storage plugin. */
export type GitProvider = 'github' | 'gitlab';

/** Normalized git library settings (token never logged by adapters). */
export interface GitConfig {
  provider: GitProvider;
  apiBaseUrl: string;
  token: string;
  owner: string;
  repo: string;
  /** GitLab project path (group/repo) or numeric id — falls back to owner/repo */
  projectId: string;
  branch: string;
  /** Repo subdirectory for index + `.pyne` / `.pine` files (no leading/trailing slashes). */
  basePath: string;
  autoPush: boolean;
  /** Supports `{{name}}` and `{{iso}}` placeholders. */
  commitMessageTemplate: string;
  /**
   * Optional public OAuth App client id for device-flow Connect when the
   * Worker env `GITHUB_OAUTH_CLIENT_ID` / `GITLAB_OAUTH_CLIENT_ID` is unset.
   */
  oauthClientId?: string;
}

/** Factory defaults for git storage settings UI. */
export const DEFAULT_GIT_CONFIG: GitConfig = {
  provider: 'github',
  apiBaseUrl: '',
  token: '',
  owner: '',
  repo: '',
  projectId: '',
  branch: 'main',
  basePath: 'pyne-library',
  autoPush: true,
  commitMessageTemplate: 'chore(pine): save {{name}} @ {{iso}}',
};

/**
 * Sanitize repo base path: strip slashes, reject `.` / `..` segments.
 * Falls back to default when empty or invalid.
 */
export function sanitizeBasePath(raw: string): string {
  const parts = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (!parts.length) return DEFAULT_GIT_CONFIG.basePath;
  if (parts.some((p) => p === '.' || p === '..')) return DEFAULT_GIT_CONFIG.basePath;
  return parts.join('/');
}

/**
 * Merge plugin config + store pluginsConfig into a full {@link GitConfig}.
 * Fills default API base URL from provider when empty.
 */
export function resolveGitConfig(config?: Record<string, unknown>): GitConfig {
  const pc = store.pluginsConfig || {};
  const saved = (pc[pluginKey('storage', 'git')] || pc['git'] || {}) as Record<string, unknown>;
  const merged = { ...DEFAULT_GIT_CONFIG, ...saved, ...(config || {}) } as Record<string, unknown>;

  const provider = (String(merged.provider || 'github') as GitProvider) === 'gitlab' ? 'gitlab' : 'github';
  let apiBaseUrl = String(merged.apiBaseUrl || '').replace(/\/$/, '');
  if (!apiBaseUrl) {
    apiBaseUrl = provider === 'gitlab' ? 'https://gitlab.com/api/v4' : 'https://api.github.com';
  }

  const oauthClientId = String(merged.oauthClientId || '').trim();

  return {
    provider,
    apiBaseUrl,
    token: String(merged.token || ''),
    owner: String(merged.owner || ''),
    repo: String(merged.repo || ''),
    projectId: String(merged.projectId || ''),
    branch: String(merged.branch || 'main'),
    basePath: sanitizeBasePath(String(merged.basePath || DEFAULT_GIT_CONFIG.basePath)),
    autoPush: merged.autoPush !== false && merged.autoPush !== 'false',
    commitMessageTemplate: String(
      merged.commitMessageTemplate || DEFAULT_GIT_CONFIG.commitMessageTemplate,
    ),
    ...(oauthClientId ? { oauthClientId } : {}),
  };
}

/** Expand `{{name}}` / `{{iso}}` in the commit message template. */
export function formatCommitMessage(template: string, name: string): string {
  const iso = new Date().toISOString();
  return template.replace(/\{\{name\}\}/g, name).replace(/\{\{iso\}\}/g, iso);
}

/** `{basePath}/library` directory for scripts + index. */
export function libraryDir(cfg: GitConfig): string {
  return `${cfg.basePath}/library`.replace(/\/+/g, '/');
}

/** Path to the library index JSON in the repo. */
export function indexPath(cfg: GitConfig): string {
  return `${libraryDir(cfg)}/index.json`;
}

/**
 * Path to a single script file; id sanitized for safe filenames.
 * New commits use **`.pyne`**; indexes may still point at legacy `.pine` paths.
 */
export function scriptPath(cfg: GitConfig, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${libraryDir(cfg)}/${safe}.pyne`;
}

/**
 * Normalize a repo-relative path (forward slashes, no leading slash).
 * Rejects empty, absolute, and `..` / `.` segments.
 */
export function normalizeRepoPath(path: string): string {
  const p = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!p) throw new Error('Git storage: empty path');
  const parts = p.split('/').filter(Boolean);
  if (!parts.length || parts.some((seg) => seg === '.' || seg === '..')) {
    throw new Error(`Git storage: unsafe path "${path}"`);
  }
  return parts.join('/');
}

/**
 * Ensure `path` is under `{basePath}/library` (or is that directory).
 * @returns normalized path
 */
export function assertSafeRepoPath(cfg: GitConfig, path: string): string {
  const p = normalizeRepoPath(path);
  const lib = libraryDir(cfg);
  if (p === lib || p.startsWith(`${lib}/`)) return p;
  throw new Error(
    `Git storage: path must be under ${lib}/ (got "${path}")`,
  );
}

/**
 * Resolve the repo path for a script write/read.
 *
 * Order: safe full `docPath` → safe index `meta.path` → {@link scriptPath}.
 * Bare filenames (no `/`) are ignored so imports cannot land at repo root.
 */
export function resolveScriptRepoPath(
  cfg: GitConfig,
  opts: { id: string; docPath?: string | null; indexPath?: string | null },
): string {
  for (const candidate of [opts.docPath, opts.indexPath]) {
    if (!candidate || !String(candidate).trim()) continue;
    const raw = String(candidate).trim();
    // Bare filename only — not a repo-relative path
    if (!raw.includes('/') && !raw.includes('\\')) continue;
    try {
      return assertSafeRepoPath(cfg, raw);
    } catch {
      /* try next */
    }
  }
  return scriptPath(cfg, opts.id);
}

/** Thrown when index.json exists but is not valid JSON — refuse overwrite. */
export class GitIndexCorruptError extends Error {
  readonly code = 'GIT_INDEX_CORRUPT';
  constructor(message?: string) {
    super(
      message ||
        'Git storage: library index.json is corrupt — refuse to overwrite. Fix or replace the index in the repo.',
    );
    this.name = 'GitIndexCorruptError';
  }
}

/**
 * Throw if token or repo identity is missing for the selected provider.
 * Called by adapters before network I/O.
 */
export function assertGitConfig(cfg: GitConfig): void {
  if (!cfg.token) throw new Error('Git storage: PAT / token required');
  if (cfg.provider === 'github') {
    if (!cfg.owner || !cfg.repo) throw new Error('Git storage: owner and repo required');
  } else {
    if (!cfg.projectId && !(cfg.owner && cfg.repo)) {
      throw new Error('Git storage: projectId or owner/repo required for GitLab');
    }
  }
}
