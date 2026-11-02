// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persist the per-kind active plugin id map under workspaceState
 * `axis.plugins.active.v1`. Secrets are stripped — never written.
 */

import {
  ACTIVE_PLUGINS_WORKSPACE_STATE_KEY,
  DEFAULT_ACTIVE_PLUGINS_V1,
  PLUGIN_KINDS,
  type ActivePluginsV1,
  type PluginKind,
  type WorkspaceStateHelpers,
} from './types';

export {
  ACTIVE_PLUGINS_WORKSPACE_STATE_KEY,
  DEFAULT_ACTIVE_PLUGINS_V1,
};
export type { ActivePluginsV1, WorkspaceStateHelpers };

/** Field names never allowed in persisted active-plugin JSON. */
const SECRET_FIELD_RE =
  /^(api[_-]?key|password|passwd|secret|token|bearer|authorization|auth|credential|private[_-]?key)$/i;

function isPluginKind(raw: unknown): raw is PluginKind {
  return typeof raw === 'string' && (PLUGIN_KINDS as readonly string[]).includes(raw);
}

function copyDefaults(): ActivePluginsV1 {
  return {
    source: DEFAULT_ACTIVE_PLUGINS_V1.source,
    stream: DEFAULT_ACTIVE_PLUGINS_V1.stream,
    engine: DEFAULT_ACTIVE_PLUGINS_V1.engine,
    storage: DEFAULT_ACTIVE_PLUGINS_V1.storage,
  };
}

function stripSecretsFromRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(input);
  for (const k of keys) {
    try {
      if (SECRET_FIELD_RE.test(k)) continue;
      const v = input[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = stripSecretsFromRecord(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    } catch {
      // hostile getter on this key
    }
  }
  return out;
}

/** Parse unknown workspaceState value into active ids (never throws). */
export function parseActivePluginsV1(raw: unknown): ActivePluginsV1 {
  const defaults = copyDefaults();
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }
  let record: Record<string, unknown>;
  try {
    record = stripSecretsFromRecord(raw as Record<string, unknown>);
  } catch {
    record = raw as Record<string, unknown>;
  }
  const out = copyDefaults();
  for (const kind of PLUGIN_KINDS) {
    try {
      const v = record[kind];
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (trimmed) out[kind] = trimmed;
    } catch {
      // hostile getter on this kind
    }
  }
  return out;
}

/** Read `axis.plugins.active.v1` via helpers (never throws; defaults on failure). */
export function readActivePlugins(
  helpers: WorkspaceStateHelpers,
): ActivePluginsV1 {
  try {
    const raw = helpers.get<unknown>(ACTIVE_PLUGINS_WORKSPACE_STATE_KEY);
    return parseActivePluginsV1(raw);
  } catch {
    return copyDefaults();
  }
}

/**
 * Write one kind's active id. Empty id / unknown kind ignored.
 * Never throws — returns false on store failure or ignored write.
 */
export async function writeActivePlugin(
  helpers: WorkspaceStateHelpers,
  kind: PluginKind,
  id: string,
): Promise<boolean> {
  try {
    if (!isPluginKind(kind)) return false;
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed) return false;
    const current = readActivePlugins(helpers);
    const next: ActivePluginsV1 = { ...current };
    next[kind] = trimmed;
    const clean = parseActivePluginsV1(next);
    await Promise.resolve(
      helpers.update(ACTIVE_PLUGINS_WORKSPACE_STATE_KEY, clean),
    );
    return true;
  } catch {
    return false;
  }
}

/** True when `id` is the stored active plugin for `kind` (never throws). */
export function isActivePlugin(
  helpers: WorkspaceStateHelpers,
  kind: PluginKind,
  id: string,
): boolean {
  if (!isPluginKind(kind)) return false;
  if (typeof id !== 'string') return false;
  const want = id.trim();
  if (!want) return false;
  const current = readActivePlugins(helpers);
  return current[kind] === want;
}

/** Bind `context.workspaceState` to {@link WorkspaceStateHelpers}. */
export function workspaceStateFromContext(context: {
  workspaceState: WorkspaceStateHelpers;
}): WorkspaceStateHelpers {
  return {
    get<T>(key: string): T | undefined {
      try {
        return context.workspaceState.get<T>(key);
      } catch {
        return undefined;
      }
    },
    update(key: string, value: unknown) {
      return context.workspaceState.update(key, value);
    },
  };
}

/** In-memory WorkspaceStateHelpers for unit tests (mock Memento). */
export function createMemoryWorkspaceState(
  initial?: Iterable<[string, unknown]>,
): WorkspaceStateHelpers & { readonly map: Map<string, unknown> } {
  const map = new Map<string, unknown>(initial);
  return {
    map,
    get<T>(key: string): T | undefined {
      return map.get(key) as T | undefined;
    },
    update(key: string, value: unknown): void {
      if (value === undefined) map.delete(key);
      else map.set(key, value);
    },
  };
}
