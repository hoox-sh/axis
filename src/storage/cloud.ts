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
 * Built-in **cloud** storage plugin — AXIS Worker `/api/scripts` (D1 or memory).
 *
 * Config resolved from `pluginsConfig[storage:cloud]` / bare `cloud`
 * ({@link resolveCloudConfig}). Auth: `Authorization: Bearer <apiKey>`.
 * Optimistic concurrency via optional `If-Match` revision headers.
 * Version history: `GET /api/scripts/:id/versions` (+ `/:rev`).
 */

import type {
  ScriptDocument,
  ScriptMeta,
  ScriptVersion,
  StoragePlugin,
  StorageStatus,
} from '../plugins/types';
import { metaFromScriptContent } from '../indicators/script-meta';
import { defaultCloudEndpoint, resolveCloudConfig } from './cloud-config';

export type { CloudConfig } from './cloud-config';
export {
  defaultCloudEndpoint,
  generateDemoApiKey,
  resolveCloudConfig,
  writeStoredCloudConfig,
} from './cloud-config';

async function api(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    config?: Record<string, unknown>;
    ifMatch?: string;
  } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const cfg = resolveCloudConfig(opts.config);
  if (!cfg.apiKey) {
    throw new Error('Cloud storage requires an API key (Settings / storage config)');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
  const res = await fetch(`${cfg.endpoint}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String(json.message || json.error || `HTTP ${res.status}`);
    const err = new Error(msg) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = String(json.code || '');
    throw err;
  }
  return { status: res.status, json };
}

function metaFromRemote(r: Record<string, unknown>): ScriptMeta {
  const content = r.content != null ? String(r.content) : '';
  const kindRaw = r.scriptKind != null ? String(r.scriptKind) : r.kind != null ? String(r.kind) : '';
  const scriptKind =
    kindRaw === 'indicator' ||
    kindRaw === 'strategy' ||
    kindRaw === 'library' ||
    kindRaw === 'unknown'
      ? kindRaw
      : undefined;
  const pineVersion =
    r.pineVersion != null
      ? String(r.pineVersion)
      : r.version != null
        ? String(r.version)
        : undefined;
  const derived = content
    ? metaFromScriptContent(content, { scriptKind, pineVersion })
    : {
        scriptKind: (scriptKind || 'unknown') as
          | 'indicator'
          | 'strategy'
          | 'library'
          | 'unknown',
        pineVersion,
      };
  return {
    id: String(r.id),
    name: String(r.name || 'Untitled'),
    description: r.description ? String(r.description) : undefined,
    path: r.path ? String(r.path) : undefined,
    revision: r.revision ? String(r.revision) : undefined,
    createdAt: Number(r.createdAt ?? r.created_at ?? Date.now()),
    updatedAt: Number(r.updatedAt ?? r.updated_at ?? Date.now()),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : undefined,
    scriptKind: derived.scriptKind,
    pineVersion: derived.pineVersion,
  };
}

function docFromRemote(r: Record<string, unknown>): ScriptDocument {
  const content = String(r.content ?? '');
  return {
    ...metaFromRemote({ ...r, content }),
    content,
  };
}

/**
 * Cloud storage plugin (`id: cloud`) — REST against Worker `/api/scripts`.
 * Config schema: Worker URL + API key.
 */
export const cloudStoragePlugin: StoragePlugin = {
  id: 'cloud',
  name: 'Cloud (Worker)',
  kind: 'storage',
  builtIn: true,
  description:
    'Stores scripts on the AXIS Cloudflare Worker (/api/scripts). Uses Pro API keys; partition per key.',
  capabilities: { needsNetwork: true, needsAuth: true },
  configSchema: {
    endpoint: {
      type: 'string',
      default: defaultCloudEndpoint(),
      label: 'Worker URL',
      description: 'AXIS Worker base URL (no trailing slash). Not the Pine engine host.',
    },
    apiKey: {
      type: 'string',
      default: '',
      label: 'API key',
      description: 'Bearer key from Settings or /api/keys (pn_…)',
      placeholder: 'pn_…',
    },
  },

  async list(opts) {
    const { json } = await api('/api/scripts', { config: opts?.config });
    const scripts = (json.scripts as Record<string, unknown>[]) || [];
    let metas = scripts.map(metaFromRemote);
    const prefix = opts?.prefix;
    if (prefix) {
      metas = metas.filter(
        (m) => m.name.startsWith(prefix) || (m.path && m.path.startsWith(prefix)),
      );
    }
    return metas;
  },

  async read(id, config) {
    const { json } = await api(`/api/scripts/${encodeURIComponent(id)}`, { config });
    const script = json.script as Record<string, unknown>;
    if (!script) throw new Error(`Script not found: ${id}`);
    return docFromRemote(script);
  },

  async write(doc, config) {
    const body = {
      name: doc.name,
      description: doc.description,
      path: doc.path,
      content: doc.content,
      revision: doc.revision,
    };
    const { json } = await api(`/api/scripts/${encodeURIComponent(doc.id)}`, {
      method: 'PUT',
      body,
      config,
      ifMatch: doc.revision,
    });
    const script = json.script as Record<string, unknown>;
    return metaFromRemote(script || { ...doc, revision: doc.revision });
  },

  async remove(id, config) {
    await api(`/api/scripts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      config,
    });
  },

  async saveDraft(doc, config) {
    await api('/api/scripts/_draft', {
      method: 'PUT',
      body: { content: doc.content, name: doc.name },
      config,
    });
  },

  async loadDraft(config) {
    const { json } = await api('/api/scripts/_draft', { config });
    const draft = json.draft as { content?: string; name?: string } | null;
    if (!draft || draft.content == null) return null;
    return { content: String(draft.content), name: draft.name };
  },

  async listVersions(id, opts): Promise<ScriptVersion[]> {
    const { json } = await api(`/api/scripts/${encodeURIComponent(id)}/versions`, {
      config: opts?.config,
    });
    const rows = (json.versions as Record<string, unknown>[]) || [];
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 40));
    return rows.slice(0, limit).map(versionFromRemote);
  },

  async readAtRevision(id, rev, config): Promise<ScriptDocument> {
    const { json } = await api(
      `/api/scripts/${encodeURIComponent(id)}/versions/${encodeURIComponent(rev)}`,
      { config },
    );
    const script = json.script as Record<string, unknown>;
    if (!script) throw new Error(`Version not found: ${id}@${rev}`);
    return docFromRemote(script);
  },

  async getStatus(config): Promise<StorageStatus> {
    try {
      const cfg = resolveCloudConfig(config);
      if (!cfg.apiKey) {
        return {
          connected: false,
          error: 'API key not set — add it in Settings → Script storage',
          remote: cfg.endpoint,
        };
      }
      const res = await fetch(`${cfg.endpoint}/health`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        return { connected: false, error: `HTTP ${res.status}`, remote: cfg.endpoint };
      }
      try {
        await api('/api/scripts', { config: cfg });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { connected: false, error: msg, remote: cfg.endpoint };
      }
      return { connected: true, remote: cfg.endpoint, lastSyncAt: Date.now() };
    } catch (e: unknown) {
      return {
        connected: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

function versionFromRemote(r: Record<string, unknown>): ScriptVersion {
  const sha = String(r.sha || r.revision || '');
  const committedAt = Number(r.committedAt ?? r.created_at ?? r.createdAt ?? Date.now());
  return {
    sha,
    shortSha: String(r.shortSha || sha.slice(0, 7)),
    message: String(r.message || `Save ${r.name || 'script'}`),
    author: r.author ? String(r.author) : undefined,
    committedAt: Number.isFinite(committedAt) ? committedAt : Date.now(),
    url: r.url ? String(r.url) : undefined,
  };
}

/**
 * Probe Worker health + `/api/scripts` with the given (or stored) config.
 * Used by Settings "Test connection".
 */
export async function probeCloudStorage(
  config?: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  const cfg = resolveCloudConfig(config);
  if (!cfg.apiKey) {
    return { ok: false, message: 'API key not set' };
  }
  const st = await cloudStoragePlugin.getStatus?.(cfg);
  if (!st?.connected) {
    return { ok: false, message: st?.error || 'Worker unreachable' };
  }
  return { ok: true, message: `Connected · ${cfg.endpoint}` };
}
