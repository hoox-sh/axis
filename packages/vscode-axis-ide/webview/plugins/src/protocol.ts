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
 * Plugins studio host↔webview codec (axis.webview.v1 + flat JSON).
 * Host sibling encodes `plugins.init` / `plugins.state`; this view posts
 * `plugins.ready` and `plugins.activate`. Never throws on hostile input.
 */

export const PROTOCOL_VERSION = 1 as const;

export const HOST_TO_VIEW = {
  Init: 'plugins.init',
  State: 'plugins.state',
} as const;

export const VIEW_TO_HOST = {
  Ready: 'plugins.ready',
  Activate: 'plugins.activate',
} as const;

const HOST_TYPES = new Set<string>([HOST_TO_VIEW.Init, HOST_TO_VIEW.State]);

export type PluginKind =
  | 'source'
  | 'stream'
  | 'engine'
  | 'storage'
  | 'dataset'
  | 'component';

export const PLUGIN_KINDS: readonly PluginKind[] = [
  'source',
  'stream',
  'engine',
  'storage',
  'dataset',
  'component',
] as const;

export type KindTab = 'all' | PluginKind;

export const KIND_TABS: readonly KindTab[] = ['all', ...PLUGIN_KINDS] as const;

export type PluginExtra = {
  role?: string;
  live?: string | boolean;
  pyodide?: string | boolean;
  storage?: string | boolean;
  onChain?: string | boolean;
  noSolid?: string | boolean;
  flagOff?: boolean;
};

export type PluginCard = {
  id: string;
  name: string;
  kind: PluginKind;
  builtIn: boolean;
  description: string;
  extra: PluginExtra;
};

export type ActivePluginsMap = {
  source?: string;
  stream?: string;
  engine?: string;
  storage?: string;
  dataset?: string;
  component?: string;
};

export type PluginsFlags = {
  allowPyodide?: boolean;
};

export type WebviewDecodeOk = {
  ok: true;
  type: string;
  payload: Record<string, unknown>;
};
export type WebviewDecodeErr = { ok: false; error: string };
export type WebviewDecodeResult = WebviewDecodeOk | WebviewDecodeErr;

export type PluginsActivateMessage = {
  v: typeof PROTOCOL_VERSION;
  type: typeof VIEW_TO_HOST.Activate;
  kind: PluginKind;
  id: string;
  payload: { kind: PluginKind; id: string };
  ts: number;
};

export type PluginsReadyMessage = {
  v: typeof PROTOCOL_VERSION;
  type: typeof VIEW_TO_HOST.Ready;
  payload: Record<string, never>;
  ts: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPluginKind(value: unknown): value is PluginKind {
  return typeof value === 'string' && (PLUGIN_KINDS as readonly string[]).includes(value);
}

export function isKindTab(value: unknown): value is KindTab {
  return value === 'all' || isPluginKind(value);
}

function extraString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : undefined;
  }
  return undefined;
}

function extraBoolOrString(value: unknown): string | boolean | undefined {
  if (typeof value === 'boolean') return value;
  return extraString(value);
}

/** Normalize one catalog card; skip entries missing id/kind. */
export function normalizePluginCard(raw: unknown): PluginCard | null {
  try {
    if (!isPlainObject(raw)) return null;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || !isPluginKind(raw.kind)) return null;
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
    const description =
      typeof raw.description === 'string' ? raw.description.trim() : '';
    const extraRaw = isPlainObject(raw.extra) ? raw.extra : {};
    const extra: PluginExtra = {};
    const role = extraString(extraRaw.role);
    if (role) extra.role = role;
    const live = extraBoolOrString(extraRaw.live);
    if (live !== undefined) extra.live = live;
    const pyodide = extraBoolOrString(extraRaw.pyodide);
    if (pyodide !== undefined) extra.pyodide = pyodide;
    const storage = extraBoolOrString(extraRaw.storage);
    if (storage !== undefined) extra.storage = storage;
    const onChain = extraBoolOrString(extraRaw.onChain ?? extraRaw['on-chain']);
    if (onChain !== undefined) extra.onChain = onChain;
    const noSolid = extraBoolOrString(extraRaw.noSolid ?? extraRaw['no-solid']);
    if (noSolid !== undefined) extra.noSolid = noSolid;
    if (extraRaw.flagOff === true) extra.flagOff = true;
    return {
      id,
      name,
      kind: raw.kind,
      builtIn: raw.builtIn === true,
      description,
      extra,
    };
  } catch {
    return null;
  }
}

export function normalizePlugins(raw: unknown): PluginCard[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: PluginCard[] = [];
    for (const entry of raw) {
      const card = normalizePluginCard(entry);
      if (card) out.push(card);
    }
    return out;
  } catch {
    return [];
  }
}

export function normalizeActive(raw: unknown): ActivePluginsMap {
  const out: ActivePluginsMap = {};
  try {
    if (!isPlainObject(raw)) return out;
    for (const kind of PLUGIN_KINDS) {
      const id = raw[kind];
      if (typeof id === 'string' && id.trim()) out[kind] = id.trim();
    }
  } catch {
    return out;
  }
  return out;
}

export function normalizeFlags(raw: unknown): PluginsFlags {
  const out: PluginsFlags = {};
  try {
    if (!isPlainObject(raw)) return out;
    if (typeof raw.allowPyodide === 'boolean') out.allowPyodide = raw.allowPyodide;
  } catch {
    return out;
  }
  return out;
}

/** Never-throw decode of untrusted host postMessage data. */
export function decodeHostMessage(raw: unknown): WebviewDecodeResult {
  try {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'envelope must be a non-null object' };
    }
    if ('v' in raw && raw.v !== PROTOCOL_VERSION) {
      return { ok: false, error: `unsupported protocol version: ${String(raw.v)}` };
    }
    if (typeof raw.type !== 'string' || raw.type.length === 0) {
      return { ok: false, error: 'type must be a non-empty string' };
    }
    if (!HOST_TYPES.has(raw.type)) {
      return { ok: false, error: `unexpected or view→host type: ${raw.type}` };
    }
    if ('ts' in raw && (typeof raw.ts !== 'number' || !Number.isFinite(raw.ts))) {
      return { ok: false, error: 'ts must be a finite number' };
    }
    const payload = isPlainObject(raw.payload) ? raw.payload : raw;
    return { ok: true, type: raw.type, payload };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `decode failed: ${message}` };
  }
}

export function encodePluginsReady(ts = Date.now()): PluginsReadyMessage {
  return {
    v: PROTOCOL_VERSION,
    type: VIEW_TO_HOST.Ready,
    payload: {},
    ts,
  };
}

/** View → host activate. Invalid kind/id returns null (caller must not post). */
export function encodePluginsActivate(
  kind: unknown,
  id: unknown,
  ts = Date.now(),
): PluginsActivateMessage | null {
  try {
    if (!isPluginKind(kind)) return null;
    if (typeof id !== 'string') return null;
    const trimmed = id.trim();
    if (!trimmed) return null;
    return {
      v: PROTOCOL_VERSION,
      type: VIEW_TO_HOST.Activate,
      kind,
      id: trimmed,
      payload: { kind, id: trimmed },
      ts,
    };
  } catch {
    return null;
  }
}
