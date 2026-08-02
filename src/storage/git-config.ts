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

  return {
    provider,
    apiBaseUrl,
    token: String(merged.token || ''),
    owner: String(merged.owner || ''),
    repo: String(merged.repo || ''),
    projectId: String(merged.projectId || ''),
    branch: String(merged.branch || 'main'),
    basePath: String(merged.basePath || 'pyne-library').replace(/^\/+|\/+$/g, ''),
    autoPush: merged.autoPush !== false && merged.autoPush !== 'false',
    commitMessageTemplate: String(
      merged.commitMessageTemplate || DEFAULT_GIT_CONFIG.commitMessageTemplate,
    ),
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
