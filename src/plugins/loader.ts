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
 * **Dynamic plugin loader** — install source/stream/engine/dataset/component
 * plugins from URL.
 *
 * Dynamic-imports ES modules from a URL (Vite-ignored). Persists the installed
 * list under `localStorage` key {@link PLUGINS_KEY}. On boot, call
 * {@link restoreInstalledPlugins} to re-import saved URLs.
 *
 * Supported kinds: `source`, `stream`, `engine`, `dataset`, `component`.
 * Storage via URL is not supported yet. Rejects dangerous schemes
 * (`javascript:`, HTML `data:` URLs, etc.). Maps legacy `/src/plugins/…`
 * paths to `/plugins/…` for production.
 *
 * Example plugins: `example-coingecko-source.js`, `example-cf-do-stream.js`,
 * `example-tiny-pyne-engine.js`, PYNE Agent (`…/plugin/axis-pine-agent.js`).
 *
 * @module plugins/loader
 */

import { registerDynamicSource, unregisterDynamicSource, listDynamicSourceIds } from '../sources/catalog';
import { registerDynamicStream, unregisterDynamicStream } from '../streams/catalog';
import { registerDynamicEngine, unregisterDynamicEngine } from '../engines/catalog';
import { registerDynamicDataset, unregisterDynamicDataset } from '../onchain/catalog';
import { ensureBuiltins } from './bootstrap';
import { appendLog, store, setStore } from '../store';
import { registry } from './registry';
import { pluginKey, type ComponentPlugin, type DatasetPlugin, type EnginePlugin, type SourcePlugin, type StreamPlugin } from './types';

/**
 * Same-origin copy of the PYNE Agent component plugin (avoids cross-origin
 * module CORS / CSP issues). API traffic still goes to {@link DEFAULT_PYNE_AGENT_ENDPOINT}.
 */
export const DEFAULT_PYNE_AGENT_PLUGIN_URL = '/plugins/axis-pine-agent.js';

/** Production agent Worker origin (NL → Pine). Seeded into plugin config. */
export const DEFAULT_PYNE_AGENT_ENDPOINT =
  'https://pyne-agent-worker.cryptolinx.workers.dev';

/** Legacy remote plugin URL — migrated to same-origin on restore. */
export const LEGACY_PYNE_AGENT_PLUGIN_URL =
  'https://pyne-agent-worker.cryptolinx.workers.dev/plugin/axis-pine-agent.js';

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
  else if (kind === 'component') {
    try {
      registry.unregister('component', id, { allowBuiltIn: true });
    } catch {
      /* ignore */
    }
  } else {
    unregisterDynamicSource(id);
    unregisterDynamicStream(id);
    unregisterDynamicEngine(id);
    unregisterDynamicDataset(id);
    try {
      registry.unregister('component', id, { allowBuiltIn: true });
    } catch {
      /* ignore */
    }
  }
}

function componentConfig(id: string): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  return {
    ...(configs[pluginKey('component', id)] || {}),
    ...(configs[id] || {}),
  };
}

/** Seed default agent API endpoint when installing the PYNE Agent plugin. */
function seedPyneAgentConfig(pluginId: string, href: string): void {
  if (pluginId !== 'pyne-agent' && !href.includes('axis-pine-agent.js')) return;
  const key = pluginKey('component', 'pyne-agent');
  const prev = (store.pluginsConfig?.[key] || {}) as Record<string, unknown>;
  if (prev.endpoint && String(prev.endpoint).trim()) return;
  // Prefer the known agent Worker origin — same-origin `/plugins/…` is only the module.
  let endpoint = DEFAULT_PYNE_AGENT_ENDPOINT;
  try {
    const u = new URL(href, typeof location !== 'undefined' ? location.origin : 'https://axis.local');
    if (
      u.hostname === 'pyne-agent-worker.cryptolinx.workers.dev' ||
      u.hostname.endsWith('.pyne-agent-worker.cryptolinx.workers.dev')
    ) {
      endpoint = u.origin;
    }
  } catch {
    /* keep default */
  }
  setStore('pluginsConfig', {
    ...(store.pluginsConfig || {}),
    [key]: { ...prev, endpoint },
  });
}

/** Map legacy remote agent plugin URL → same-origin static copy. */
export function migratePyneAgentPluginUrl(url: string): string {
  const href = normalizePluginUrl(typeof url === 'string' ? url : '');
  if (!href) return href;
  try {
    const base =
      typeof location !== 'undefined' && location?.origin
        ? location.origin
        : 'https://axis.local';
    const u = new URL(href, base);
    if (
      u.pathname.endsWith('/plugin/axis-pine-agent.js') ||
      u.pathname.endsWith('/plugins/axis-pine-agent.js') ||
      href === LEGACY_PYNE_AGENT_PLUGIN_URL
    ) {
      // Remote cryptolinx host → ship same-origin module
      if (
        u.hostname === 'pyne-agent-worker.cryptolinx.workers.dev' ||
        href === LEGACY_PYNE_AGENT_PLUGIN_URL
      ) {
        return DEFAULT_PYNE_AGENT_PLUGIN_URL;
      }
    }
  } catch {
    if (href === LEGACY_PYNE_AGENT_PLUGIN_URL) return DEFAULT_PYNE_AGENT_PLUGIN_URL;
  }
  return href;
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

/**
 * Hostnames allowed for **remote** plugins in production builds.
 * Same-origin `/plugins/*`, relative paths, and `data:` fixtures stay unrestricted.
 * Override with `VITE_ALLOW_REMOTE_PLUGINS=1` (or add hosts via
 * `VITE_PLUGIN_REMOTE_ALLOW` comma list).
 */
export const DEFAULT_REMOTE_PLUGIN_HOSTS = [
  'pyne-agent-worker.cryptolinx.workers.dev',
] as const;

function isProdBuild(override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  try {
    return Boolean(import.meta.env?.PROD);
  } catch {
    return false;
  }
}

function remoteAllowHostsFromEnv(): string[] {
  const extra: string[] = [];
  try {
    const raw = String(import.meta.env?.VITE_PLUGIN_REMOTE_ALLOW || '').trim();
    if (raw) {
      for (const part of raw.split(',')) {
        const h = part.trim().toLowerCase();
        if (h) extra.push(h);
      }
    }
  } catch {
    /* no env */
  }
  return extra;
}

function envAllowsAnyRemote(): boolean {
  try {
    const v = String(import.meta.env?.VITE_ALLOW_REMOTE_PLUGINS || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  } catch {
    return false;
  }
}

/** True when `href` targets a non-same-origin http(s) host (not data/blob/relative). */
export function isRemoteHttpPluginUrl(href: string): boolean {
  const trimmed = String(href || '').trim();
  if (!trimmed) return false;
  const lower = normalizeForSchemeCheck(trimmed);
  if (lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('file:')) {
    return false;
  }
  // Relative / root-absolute path — not remote
  if (!/^[a-z][a-z0-9+.-]*:/.test(lower) && !lower.startsWith('//')) {
    return false;
  }
  try {
    const base =
      typeof location !== 'undefined' && location?.origin
        ? location.origin
        : 'https://axis.local';
    const u = new URL(trimmed, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (typeof location !== 'undefined' && location?.origin && u.origin === location.origin) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const a of allow) {
    const needle = a.toLowerCase();
    if (h === needle || h.endsWith(`.${needle}`)) return true;
  }
  return false;
}

/**
 * Production default-deny for remote plugin modules (full-origin RCE surface).
 * Dev builds stay open (after scheme checks). Tests pass `{ prod: true }`.
 */
export function assertPluginRemoteAllowed(
  href: string,
  opts?: { prod?: boolean; allowHosts?: readonly string[] },
): void {
  assertSafePluginUrl(href);
  if (!isProdBuild(opts?.prod)) return;
  if (envAllowsAnyRemote()) return;
  if (!isRemoteHttpPluginUrl(href)) return;

  const base =
    typeof location !== 'undefined' && location?.origin
      ? location.origin
      : 'https://axis.local';
  let host = '';
  try {
    host = new URL(href, base).hostname;
  } catch {
    throw new Error('Remote plugin URL is invalid');
  }
  const allow = [
    ...DEFAULT_REMOTE_PLUGIN_HOSTS,
    ...remoteAllowHostsFromEnv(),
    ...(opts?.allowHosts || []),
  ];
  if (!hostAllowed(host, allow)) {
    throw new Error(
      'Remote plugin hosts are blocked in production (allowlist only). ' +
        'Use same-origin /plugins/…, set VITE_ALLOW_REMOTE_PLUGINS=1, or add the host to VITE_PLUGIN_REMOTE_ALLOW.',
    );
  }
}

/**
 * Dynamic-import an ES module plugin URL.
 * Cross-origin modules require CORS (`Access-Control-Allow-Origin`).
 * On failure, try fetch+blob (same CORS requirements, clearer errors).
 */
async function importPluginModule(href: string): Promise<unknown> {
  try {
    return await import(/* @vite-ignore */ href);
  } catch (directErr: unknown) {
    // Fallback: fetch as text → blob URL (helps some hosts / MIME edge cases).
    // Still requires CORS on the GET; surface a clearer message if missing.
    let res: Response;
    try {
      res = await fetch(href, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: { Accept: 'text/javascript, application/javascript, */*' },
      });
    } catch (fetchErr: unknown) {
      const d =
        directErr instanceof Error ? directErr.message : String(directErr);
      const f = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      throw new Error(
        `Failed to load plugin module (CORS or network). ` +
          `The host must send Access-Control-Allow-Origin for dynamic import(). ` +
          `import: ${d} · fetch: ${f}`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `Plugin URL HTTP ${res.status} ${res.statusText || ''}`.trim(),
      );
    }
    const text = await res.text();
    if (!text.trim()) throw new Error('Plugin URL returned an empty body');
    if (/^\s*</.test(text)) {
      throw new Error(
        'Plugin URL returned HTML (not JavaScript) — check the path and deploy',
      );
    }
    const blob = new Blob([text], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await import(/* @vite-ignore */ blobUrl);
    } finally {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        /* ignore */
      }
    }
  }
}

export async function loadPluginFromUrl(url: string): Promise<InstalledPlugin> {
  ensureBuiltins();
  const href = migratePyneAgentPluginUrl(
    normalizePluginUrl(typeof url === 'string' ? url : ''),
  );
  if (!href) throw new Error('URL required');
  assertPluginRemoteAllowed(href);

  const mod = await importPluginModule(href);
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
  } else if (kind === 'component') {
    if (typeof p.mount !== 'function') throw new Error('Component plugin needs mount()');
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
    } else if (kind === 'component') {
      const component = p as unknown as ComponentPlugin;
      registry.registerComponent(component);
      seedPyneAgentConfig(id, href);
      // Phase-2 host may not mount slots yet — call init so floating UI can attach.
      if (typeof component.init === 'function') {
        try {
          await component.init({
            getConfig: () => componentConfig(id),
            setStatus: (msg, level) => appendLog(level || 'info', msg, 'plugins'),
            host: { fetch },
          });
        } catch (err) {
          appendLog(
            'warn',
            `Component init failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
            'plugins',
          );
        }
      }
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
