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
 * Built-in **git** storage plugin — GitHub or GitLab Contents/Files API.
 *
 * Explicit Save/Delete → commit (and push via host API). Drafts are **not**
 * written remotely (local plugin handles crash recovery). Provider dispatch
 * uses `resolveGitConfig` → `git-github` / `git-gitlab`.
 */

import type {
  ScriptDocument,
  ScriptMeta,
  ScriptVersion,
  StoragePlugin,
  StorageStatus,
  SyncResult,
} from '../plugins/types';
import { metaFromScriptContent } from '../indicators/script-meta';
import { resolveGitConfig, resolveScriptRepoPath } from './git-config';
import * as gh from './git-github';
import * as gl from './git-gitlab';

/** Storage plugin `id: git` with configSchema for Provider Manager / Settings. */
export const gitStoragePlugin: StoragePlugin = {
  id: 'git',
  name: 'Git (GitHub / GitLab)',
  kind: 'storage',
  builtIn: true,
  description:
    'Store Pine scripts in a git repo. Each Save commits (and pushes) via the host API. Browse and restore historical versions. Drafts stay local.',
  capabilities: { needsNetwork: true, needsAuth: true },
  configSchema: {
    provider: {
      type: 'select',
      options: ['github', 'gitlab'],
      default: 'github',
      label: 'Provider',
    },
    apiBaseUrl: {
      type: 'string',
      default: '',
      label: 'API base URL',
      description: 'Empty = api.github.com or gitlab.com/api/v4. Set for self-hosted.',
      placeholder: 'https://api.github.com',
    },
    token: {
      type: 'string',
      default: '',
      label: 'Personal access token',
      description: 'GitHub: contents:write. GitLab: api or write_repository.',
      placeholder: 'ghp_… / glpat-…',
    },
    owner: { type: 'string', default: '', label: 'Owner / namespace' },
    repo: { type: 'string', default: '', label: 'Repository' },
    projectId: {
      type: 'string',
      default: '',
      label: 'GitLab project id (optional)',
      description: 'Numeric id or group/project path; overrides owner/repo for GitLab',
    },
    branch: { type: 'string', default: 'main', label: 'Branch' },
    basePath: {
      type: 'string',
      default: 'pyne-library',
      label: 'Base path in repo',
    },
    commitMessageTemplate: {
      type: 'string',
      default: 'chore(pine): save {{name}} @ {{iso}}',
      label: 'Commit message template',
    },
  },

  async list(opts) {
    const cfg = resolveGitConfig(opts?.config);
    const metas = cfg.provider === 'gitlab' ? await gl.gitlabList(cfg) : await gh.githubList(cfg);
    const prefix = opts?.prefix;
    if (!prefix) return metas;
    return metas.filter(
      (m) => m.name.startsWith(prefix) || (m.path && m.path.startsWith(prefix)),
    );
  },

  async read(id, config) {
    const cfg = resolveGitConfig(config);
    return cfg.provider === 'gitlab' ? gl.gitlabRead(cfg, id) : gh.githubRead(cfg, id);
  },

  async write(doc, config) {
    const cfg = resolveGitConfig(config);
    // Explicit Save only — this is the commit boundary
    return cfg.provider === 'gitlab' ? gl.gitlabWrite(cfg, doc) : gh.githubWrite(cfg, doc);
  },

  async remove(id, config) {
    const cfg = resolveGitConfig(config);
    if (cfg.provider === 'gitlab') await gl.gitlabRemove(cfg, id);
    else await gh.githubRemove(cfg, id);
  },

  // Drafts intentionally not pushed to git — local dual-write handles crash recovery
  async saveDraft() {
    /* no-op: use local storage draft */
  },

  async loadDraft() {
    return null;
  },

  async sync(_direction, config): Promise<SyncResult> {
    try {
      const cfg = resolveGitConfig(config);
      const list =
        cfg.provider === 'gitlab' ? await gl.gitlabList(cfg) : await gh.githubList(cfg);
      return {
        ok: true,
        message: `Pulled ${list.length} script(s) from ${cfg.provider}`,
        revision: list[0]?.revision,
      };
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async getStatus(config): Promise<StorageStatus> {
    const cfg = resolveGitConfig(config);
    const st =
      cfg.provider === 'gitlab' ? await gl.gitlabStatus(cfg) : await gh.githubStatus(cfg);
    return {
      connected: st.connected,
      remote: st.remote,
      branch: st.branch || cfg.branch,
      error: st.error,
      lastSyncAt: st.connected ? Date.now() : undefined,
    };
  },

  async listVersions(id, opts): Promise<ScriptVersion[]> {
    const cfg = resolveGitConfig(opts?.config);
    const path = await resolveScriptPathForId(cfg, id);
    return cfg.provider === 'gitlab'
      ? gl.gitlabListFileCommits(cfg, path, { limit: opts?.limit })
      : gh.githubListFileCommits(cfg, path, { limit: opts?.limit });
  },

  async readAtRevision(id, rev, config): Promise<ScriptDocument> {
    const cfg = resolveGitConfig(config);
    const meta = await findScriptMeta(cfg, id);
    const path = resolveScriptRepoPath(cfg, {
      id,
      indexPath: meta?.path,
      docPath: meta?.path,
    });
    const file =
      cfg.provider === 'gitlab'
        ? await gl.gitlabGetFileAtRef(cfg, path, rev)
        : await gh.githubGetFileAtRef(cfg, path, rev);
    if (!file) {
      throw new Error(`Script not found at revision ${rev.slice(0, 7)}: ${id}`);
    }
    const content = file.content;
    const derived = metaFromScriptContent(content, {
      scriptKind: meta?.scriptKind,
      pineVersion: meta?.pineVersion,
    });
    return {
      id,
      name: meta?.name || id,
      description: meta?.description,
      path,
      content,
      updatedAt: meta?.updatedAt || Date.now(),
      createdAt: meta?.createdAt,
      revision: rev,
      tags: meta?.tags,
      scriptKind: derived.scriptKind,
      pineVersion: derived.pineVersion,
    };
  },
};

/** Look up index meta for a script id (GitHub or GitLab). */
async function findScriptMeta(
  cfg: ReturnType<typeof resolveGitConfig>,
  id: string,
): Promise<ScriptMeta | undefined> {
  const list =
    cfg.provider === 'gitlab' ? await gl.gitlabList(cfg) : await gh.githubList(cfg);
  return list.find((s) => s.id === id);
}

/** Resolve on-disk path for a script id from the library index. */
async function resolveScriptPathForId(
  cfg: ReturnType<typeof resolveGitConfig>,
  id: string,
): Promise<string> {
  const meta = await findScriptMeta(cfg, id);
  return resolveScriptRepoPath(cfg, {
    id,
    indexPath: meta?.path,
    docPath: meta?.path,
  });
}

/** Re-export script types for callers that only import git storage. */
export type { ScriptMeta, ScriptDocument, ScriptVersion };
