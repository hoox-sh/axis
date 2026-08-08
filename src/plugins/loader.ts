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
 * **Dynamic plugin loader** — install source/stream/engine/dataset plugins from URL.
 *
 * Dynamic-imports ES modules from a URL (Vite-ignored). Persists the installed
 * list under `localStorage` key {@link PLUGINS_KEY}. On boot, call
 * {@link restoreInstalledPlugins} to re-import saved URLs.
 *
 * Supported kinds: `source`, `stream`, `engine`, `dataset`. Storage/component
 * via URL are not supported yet. Rejects dangerous schemes (`javascript:`,
 * HTML `data:` URLs, etc.). Maps legacy `/src/plugins/…` paths to `/plugins/…`
 * for production.
 *
 * Example plugins: `example-coingecko-source.js`, `example-cf-do-stream.js`,
 * `example-tiny-pyne-engine.js`.
 *
 * @module plugins/loader
 */

import { registerDynamicSource, unregisterDynamicSource, listDynamicSourceIds } from '../sources/catalog';
import { registerDynamicStream, unregisterDynamicStream } from '../streams/catalog';
import { registerDynamicEngine, unregisterDynamicEngine } from '../engines/catalog';
import { registerDynamicDataset, unregisterDynamicDataset } from '../onchain/catalog';
import { ensureBuiltins } from './bootstrap';
import { appendLog } from '../store';
import type { DatasetPlugin, EnginePlugin, SourcePlugin, StreamPlugin } from './types';

/** localStorage key for installed plugin URL list. */
export const PLUGINS_KEY = 'pynescript.axis.plugins.v1';

/** One entry in the persisted install list. */
export type InstalledPlugin = {
  url: string;
  id: string;
  name: string;
  kind: string;
  description?: string;
};

/** Schemes never allowed for dynamic plugin import. */
const BLOCKED_SCHEMES = new Set(['javascript', 'vbscript', 'livescript', 'mocha']);

/** JS module MIME types permitted for `data:` plugin URLs (tests / inline). */
const ALLOWED_DATA_JS_MIMES = new Set([
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'module',
]);

/**
 * Strip BOM / C0 controls / zero-width chars that can obfuscate schemes
 * (e.g. `java\u0000script:` → `javascript:`).
 */
function normalizeForSchemeCheck(href: string): string {
  return href
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .trim();
}

function isInstalledPlugin(x: unknown): x is InstalledPlugin {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.url === 'string' &&
    o.url.trim() !== '' &&
    typeof o.id === 'string' &&
    o.id.trim() !== '' &&
    typeof o.kind === 'string' &&
    o.kind.trim() !== ''
  );
}

function sanitizeInstalledEntry(p: InstalledPlugin): InstalledPlugin {
  return {
    url: String(p.url).trim(),
    id: String(p.id).trim(),
    name: String(p.name || p.id).trim() || String(p.id).trim(),
    kind: String(p.kind).trim(),
    description: p.description != null ? String(p.description) : undefined,
  };
}

function readInstalled(): InstalledPlugin[] {
  try {
    const raw = localStorage.getItem(PLUGINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isInstalledPlugin).map(sanitizeInstalledEntry);
  } catch {
    return [];
  }
}

function writeInstalled(list: InstalledPlugin[]) {
  try {
    localStorage.setItem(PLUGINS_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / private mode */
  }
}

function unregisterByKind(kind: string, id: string): void {
  if (kind === 'source') unregisterDynamicSource(id);
  else if (kind === 'stream') unregisterDynamicStream(id);
  else if (kind === 'engine') unregisterDynamicEngine(id);
  else if (kind === 'dataset') unregisterDynamicDataset(id);
  else {
    unregisterDynamicSource(id);
    unregisterDynamicStream(id);
    unregisterDynamicEngine(id);
    unregisterDynamicDataset(id);
  }
}

export function getInstalledPlugins(): InstalledPlugin[] {
  return readInstalled();
}

function asPlugin(mod: unknown): Record<string, unknown> | null {
  if (!mod || typeof mod !== 'object') return null;
  const m = mod as Record<string, unknown>;
  const p = (m.default || m.plugin || m) as Record<string, unknown>;
  if (!p || typeof p !== 'object') return null;
  return p;
}

/** Map legacy Vite-dev paths to production static paths under public/plugins/. */
export function normalizePluginUrl(url: string): string {
  if (typeof url !== 'string') return '';
  let href = url.trim();
  if (!href) return href;
  // /src/plugins/foo.js → /plugins/foo.js (dev-only path never ships in dist)
  href = href.replace(/(^|\/)src\/plugins\//, '$1plugins/');
  return href;
}

/**
 * Reject clearly dangerous URL schemes for dynamic import.
 * Allows relative / https / http / file / blob paths and `data:` only when the
 * MIME type is a JavaScript module type (used in tests for inline fixtures).
 */
export function assertSafePluginUrl(href: string): void {
  if (typeof href !== 'string') throw new Error('URL required');
  const trimmed = href.trim();
  if (!trimmed) throw new Error('URL required');

  const lower = normalizeForSchemeCheck(trimmed);
  if (!lower) throw new Error('URL required');

  const schemeMatch = /^([a-z][a-z0-9+.-]*)\s*:/.exec(lower);
  if (!schemeMatch) {
    // Relative path or protocol-relative — no executable scheme
    return;
  }

  const scheme = schemeMatch[1];
  if (BLOCKED_SCHEMES.has(scheme)) {
    throw new Error('Plugin URL scheme not allowed');
  }

  if (scheme === 'data') {
    // data:[mime][;params][;base64],payload — only JS module mimes
    const payload = lower.slice(schemeMatch[0].length).replace(/^\s+/, '');
    const mime = (payload.split(/[;,]/, 1)[0] ?? '').trim();
    if (!ALLOWED_DATA_JS_MIMES.has(mime)) {
      throw new Error('Plugin URL scheme not allowed');
    }
  }
}

export async function loadPluginFromUrl(url: string): Promise<InstalledPlugin> {
  ensureBuiltins();
  const href = normalizePluginUrl(typeof url === 'string' ? url : '');
  if (!href) throw new Error('URL required');
  assertSafePluginUrl(href);

  const mod = await import(/* @vite-ignore */ href);
  const p = asPlugin(mod);
  if (!p) throw new Error('Module did not export a plugin object');

  const id = String(p.id || '').trim();
  const name = String(p.name || id).trim() || id;
  const kind = String(p.kind || '').trim();
  const description = p.description ? String(p.description) : '';

  if (!id || !kind) throw new Error('Plugin needs id and kind');

  // Validate before registering so a reject never leaves a half-registered plugin
  if (kind === 'source') {
    if (typeof p.fetchHistorical !== 'function') {
      throw new Error('Source plugin needs fetchHistorical()');
    }
  } else if (kind === 'stream') {
    if (typeof p.start !== 'function') throw new Error('Stream plugin needs start()');
  } else if (kind === 'engine') {
    if (typeof p.run !== 'function') throw new Error('Engine plugin needs run()');
  } else if (kind === 'dataset') {
    if (typeof p.fetchDataset !== 'function') throw new Error('Dataset plugin needs fetchDataset()');
  } else if (kind === 'storage') {
    throw new Error('Custom storage plugins via URL are not supported yet (use built-in local/cloud)');
  } else {
    throw new Error(`Unknown plugin kind: ${kind}`);
  }

  let registered = false;
  try {
    if (kind === 'source') {
      registerDynamicSource(p as unknown as SourcePlugin);
    } else if (kind === 'stream') {
      registerDynamicStream(p as unknown as StreamPlugin);
    } else if (kind === 'engine') {
      registerDynamicEngine(p as unknown as EnginePlugin);
    } else if (kind === 'dataset') {
      registerDynamicDataset(p as unknown as DatasetPlugin);
    }
    registered = true;

    const entry: InstalledPlugin = { url: href, id, name, kind, description };
    const list = readInstalled().filter((x) => x.url !== href && !(x.kind === kind && x.id === id));
    list.push(entry);
    writeInstalled(list);
    appendLog('ok', `Loaded plugin ${name} (${kind})`, 'plugins');
    return entry;
  } catch (e) {
    // Roll back registry if register or post-register work failed
    if (registered) {
      try {
        unregisterByKind(kind, id);
      } catch {
        /* best-effort cleanup */
      }
    }
    throw e;
  }
}

export function removePlugin(id: string, kind?: string) {
  const list = readInstalled();
  const entry = kind
    ? list.find((x) => x.id === id && x.kind === kind)
    : list.find((x) => x.id === id);
  const resolvedKind = kind || entry?.kind;

  if (resolvedKind) unregisterByKind(resolvedKind, id);
  else unregisterByKind('', id);

  writeInstalled(list.filter((x) => !(x.id === id && (!kind || x.kind === kind))));
  appendLog('info', `Removed plugin ${id}`, 'plugins');
}

/**
 * Re-import all saved plugin URLs (call on app boot).
 * Never throws: corrupt storage, invalid entries, and failed imports are logged.
 */
export async function restoreInstalledPlugins(): Promise<void> {
  try {
    ensureBuiltins();
    const list = readInstalled();
    for (const item of list) {
      try {
        if (!item?.url || typeof item.url !== 'string') {
          appendLog('error', 'Skipping invalid install entry (missing url)', 'plugins');
          continue;
        }
        await loadPluginFromUrl(item.url);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const label = item && typeof item === 'object' && 'url' in item ? String(item.url) : '?';
        appendLog('error', `Failed to restore ${label}: ${msg}`, 'plugins');
      }
    }
    if (list.length) {
      appendLog(
        'info',
        `Restored ${list.length} installed plugin URL(s) (${listDynamicSourceIds().length} dynamic sources)`,
        'plugins',
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendLog('error', `restoreInstalledPlugins aborted: ${msg}`, 'plugins');
  }
}
