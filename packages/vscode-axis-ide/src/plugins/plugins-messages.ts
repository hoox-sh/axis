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
 * Plugins studio webview messages (`axis.plugins` channel).
 * Never throws — hostile getters / arrays-where-objects return defaults or null.
 */

import { parseActivePluginsV1 } from './active';
import {
  PLUGIN_KINDS,
  type ActivePluginsV1,
  type PluginKind,
} from './types';

export type PluginsFlags = {
  allowPyodide: boolean;
  liveEnabled: boolean;
  allowUrlInstall: boolean;
};

export type PluginCardExtra = Record<string, string | boolean | number | null>;

export type PluginCard = {
  id: string;
  name: string;
  kind: PluginKind;
  builtIn: boolean;
  description?: string;
  extra?: PluginCardExtra;
};

export type PluginsHostToWeb =
  | {
      type: 'plugins.init';
      plugins: PluginCard[];
      active: ActivePluginsV1;
      flags: PluginsFlags;
    }
  | {
      type: 'plugins.state';
      active: ActivePluginsV1;
      flags: PluginsFlags;
    };

export type PluginsWebToHost =
  | { type: 'plugins.ready' }
  | { type: 'plugins.activate'; kind: PluginKind; id: string };

export const DEFAULT_PLUGINS_FLAGS: PluginsFlags = {
  allowPyodide: false,
  liveEnabled: false,
  allowUrlInstall: false,
};

export const PLUGIN_KIND_ROLES: Record<PluginKind, string> = {
  source: 'Historical OHLCV',
  stream: 'Live bars',
  engine: 'Pine runtime',
  storage: 'Script library backend',
  dataset: 'On-chain dataset',
  component: 'Host contribution (no Solid mount)',
};

const PYODIDE_ENGINE_ID = 'pyodide';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPluginKind(raw: unknown): raw is PluginKind {
  return typeof raw === 'string' && (PLUGIN_KINDS as readonly string[]).includes(raw);
}

function copyFlags(): PluginsFlags {
  return {
    allowPyodide: false,
    liveEnabled: false,
    allowUrlInstall: false,
  };
}

function readBoolFlag(raw: Record<string, unknown>, key: string): boolean {
  try {
    return raw[key] === true;
  } catch {
    return false;
  }
}

/** Parse flags object (never throws). Arrays / non-objects → defaults. */
export function parsePluginsFlags(raw: unknown): PluginsFlags {
  if (!isPlainObject(raw)) return copyFlags();
  return {
    allowPyodide: readBoolFlag(raw, 'allowPyodide'),
    liveEnabled: readBoolFlag(raw, 'liveEnabled'),
    allowUrlInstall: readBoolFlag(raw, 'allowUrlInstall'),
  };
}

function parseExtra(raw: unknown): PluginCardExtra | undefined {
  try {
    if (!isPlainObject(raw)) return undefined;
    const out: PluginCardExtra = {};
    for (const key of Object.keys(raw)) {
      try {
        const v = raw[key];
        if (v === null || typeof v === 'string' || typeof v === 'boolean') {
          out[key] = v;
          continue;
        }
        if (typeof v === 'number' && Number.isFinite(v)) {
          out[key] = v;
        }
      } catch {
        // hostile extra getter
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Kind-specific `extra` bag for the plugins studio UI. */
export function extraForPluginCard(
  kind: PluginKind,
  id: string,
  flags: PluginsFlags,
): PluginCardExtra {
  try {
    const extra: PluginCardExtra = {
      role: PLUGIN_KIND_ROLES[kind] ?? '',
    };
    if (kind === 'stream') {
      extra.liveEnabled = flags.liveEnabled === true;
      extra.live = flags.liveEnabled === true;
    }
    if (kind === 'engine') {
      const pluginId = typeof id === 'string' ? id.trim() : '';
      if (pluginId === PYODIDE_ENGINE_ID && flags.allowPyodide !== true) {
        extra.flagOff = true;
      }
    }
    return extra;
  } catch {
    return { role: '' };
  }
}

/** Build one card from a registry descriptor (never throws). */
export function pluginCardFromDescriptor(
  raw: unknown,
  flags: PluginsFlags,
): PluginCard | null {
  try {
    if (!isPlainObject(raw)) return null;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const kindRaw = raw.kind;
    if (!id || !isPluginKind(kindRaw)) return null;
    const nameRaw = raw.name;
    const name =
      typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : id;
    const card: PluginCard = {
      id,
      name,
      kind: kindRaw,
      builtIn: raw.builtIn === true,
      extra: extraForPluginCard(kindRaw, id, flags),
    };
    if (raw.description != null) {
      const description = String(raw.description);
      if (description) card.description = description;
    }
    return card;
  } catch {
    return null;
  }
}

/** Map registry.listAll() → PluginCard[] (never throws). */
export function buildPluginCards(
  list: unknown,
  flags: PluginsFlags,
): PluginCard[] {
  try {
    if (!Array.isArray(list)) return [];
    const out: PluginCard[] = [];
    for (const item of list) {
      const card = pluginCardFromDescriptor(item, flags);
      if (card) out.push(card);
    }
    return out;
  } catch {
    return [];
  }
}

function parseCardList(raw: unknown, flags: PluginsFlags): PluginCard[] | null {
  try {
    if (!Array.isArray(raw)) return null;
    const out: PluginCard[] = [];
    for (const item of raw) {
      try {
        if (!isPlainObject(item)) continue;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const kindRaw = item.kind;
        if (!id || !isPluginKind(kindRaw)) continue;
        const nameRaw = item.name;
        const name =
          typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : id;
        const extra = parseExtra(item.extra) ?? extraForPluginCard(kindRaw, id, flags);
        const card: PluginCard = {
          id,
          name,
          kind: kindRaw,
          builtIn: item.builtIn === true,
          extra,
        };
        if (item.description != null) {
          const d = String(item.description);
          if (d) card.description = d;
        }
        out.push(card);
      } catch {
        // skip hostile card
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Encode `plugins.init` (never throws). */
export function encodePluginsInit(
  plugins: unknown,
  active: unknown,
  flags: unknown,
): PluginsHostToWeb {
  const parsedFlags = parsePluginsFlags(flags);
  const cards = Array.isArray(plugins)
    ? buildPluginCards(plugins, parsedFlags)
    : [];
  return {
    type: 'plugins.init',
    plugins: cards,
    active: parseActivePluginsV1(active),
    flags: parsedFlags,
  };
}

/** Encode `plugins.state` (never throws). */
export function encodePluginsState(
  active: unknown,
  flags: unknown,
): PluginsHostToWeb {
  return {
    type: 'plugins.state',
    active: parseActivePluginsV1(active),
    flags: parsePluginsFlags(flags),
  };
}

/** Decode webview → host message (never throws). */
export function decodePluginsWebToHost(raw: unknown): PluginsWebToHost | null {
  try {
    if (!isPlainObject(raw)) return null;
    const type = raw.type;
    if (type === 'plugins.ready') {
      return { type: 'plugins.ready' };
    }
    if (type === 'plugins.activate') {
      const payload = isPlainObject(raw.payload) ? raw.payload : undefined;
      const kindRaw = raw.kind ?? payload?.kind;
      const idRaw = raw.id ?? payload?.id;
      if (typeof kindRaw !== 'string' || typeof idRaw !== 'string') return null;
      const kind = kindRaw.trim();
      const id = idRaw.trim();
      if (!id || !isPluginKind(kind)) return null;
      return { type: 'plugins.activate', kind, id };
    }
    return null;
  } catch {
    return null;
  }
}

/** Decode host → webview message (never throws). */
export function decodePluginsHostToWeb(raw: unknown): PluginsHostToWeb | null {
  try {
    if (!isPlainObject(raw)) return null;
    const type = raw.type;
    if (type === 'plugins.state') {
      const activeRaw = raw.active;
      const flagsRaw = raw.flags;
      if (Array.isArray(activeRaw) || (activeRaw != null && typeof activeRaw !== 'object')) {
        return null;
      }
      if (Array.isArray(flagsRaw) || (flagsRaw != null && typeof flagsRaw !== 'object')) {
        return null;
      }
      return encodePluginsState(activeRaw, flagsRaw);
    }
    if (type === 'plugins.init') {
      const pluginsRaw = raw.plugins;
      const activeRaw = raw.active;
      const flagsRaw = raw.flags;
      if (!Array.isArray(pluginsRaw)) return null;
      if (Array.isArray(activeRaw) || (activeRaw != null && typeof activeRaw !== 'object')) {
        return null;
      }
      if (Array.isArray(flagsRaw) || (flagsRaw != null && typeof flagsRaw !== 'object')) {
        return null;
      }
      const flags = parsePluginsFlags(flagsRaw);
      const plugins = parseCardList(pluginsRaw, flags);
      if (!plugins) return null;
      return {
        type: 'plugins.init',
        plugins,
        active: parseActivePluginsV1(activeRaw),
        flags,
      };
    }
    return null;
  } catch {
    return null;
  }
}
