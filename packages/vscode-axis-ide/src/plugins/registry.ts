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
 * Extension-host plugin registry — metadata maps per kind (no Solid).
 */

import { BUILTIN_PLUGIN_DESCRIPTORS, builtinIdsForKind } from './builtins';
import {
  PLUGIN_KINDS,
  type PluginDescriptor,
  type PluginKind,
  pluginKey,
} from './types';

/** Host registry keyed by kind → id → descriptor. */
export class HostPluginRegistry {
  private readonly maps = new Map<PluginKind, Map<string, PluginDescriptor>>();

  constructor() {
    for (const kind of PLUGIN_KINDS) {
      this.maps.set(kind, new Map());
    }
  }

  /** Register or replace a descriptor. */
  register(plugin: PluginDescriptor): void {
    const id = String(plugin.id || '').trim();
    const kind = plugin.kind;
    if (!id || !PLUGIN_KINDS.includes(kind)) return;
    const bucket = this.maps.get(kind);
    if (!bucket) return;
    bucket.set(id, {
      id,
      name: String(plugin.name || id).trim() || id,
      kind,
      builtIn: plugin.builtIn === true,
      description:
        plugin.description != null ? String(plugin.description) : undefined,
    });
  }

  get(kind: PluginKind, id: string): PluginDescriptor | undefined {
    return this.maps.get(kind)?.get(id);
  }

  list(kind: PluginKind): PluginDescriptor[] {
    const bucket = this.maps.get(kind);
    return bucket ? [...bucket.values()] : [];
  }

  listAll(): PluginDescriptor[] {
    const out: PluginDescriptor[] = [];
    for (const kind of PLUGIN_KINDS) {
      out.push(...this.list(kind));
    }
    return out;
  }

  /** Builtin ids currently registered for a kind (acceptance helper). */
  listBuiltinIds(kind: PluginKind): string[] {
    return this.list(kind)
      .filter((p) => p.builtIn)
      .map((p) => p.id);
  }

  has(kind: PluginKind, id: string): boolean {
    return this.maps.get(kind)?.has(id) === true;
  }

  clear(): void {
    for (const kind of PLUGIN_KINDS) {
      this.maps.get(kind)?.clear();
    }
  }
}

let shared: HostPluginRegistry | null = null;

/** Process-wide registry (idempotent builtins). */
export function getHostPluginRegistry(): HostPluginRegistry {
  if (!shared) shared = new HostPluginRegistry();
  ensureBuiltinsRegistered(shared);
  return shared;
}

/** Idempotent registration of builtin engine/source/(other) id lists. */
export function ensureBuiltinsRegistered(
  registry?: HostPluginRegistry,
): HostPluginRegistry {
  const reg = registry ?? shared ?? new HostPluginRegistry();
  if (!shared) shared = reg;
  for (const d of BUILTIN_PLUGIN_DESCRIPTORS) {
    if (!reg.has(d.kind, d.id)) {
      reg.register(d);
    }
  }
  return reg;
}

/** @internal Reset for unit tests. */
export function _resetHostPluginRegistryForTests(): void {
  shared = null;
}

export { builtinIdsForKind, pluginKey, PLUGIN_KINDS };
