// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared engine / endpoint / exec-mode writes for Runtime and Workers.
 *
 * One persist path: `store.engine` + `store.endpoint` +
 * `store.pluginsConfig[engine:<id>]`. Settings no longer owns these fields.
 *
 * @module ui/runtime/engine-config
 */

import { reconcile } from 'solid-js/store';
import { store, setStore, flushPersist, setStatus, setActivePlugin } from '../../store';
import { getEngine } from '../../engines/catalog';
import { pluginKey } from '../../plugins/types';
import { engineFamilyForId } from '../../plugins/engine-family';
import { getEngineApiKey, setEngineApiKey } from '../../storage/vault';

/** Execution strategy for a server engine: AST interpreter, compiled path, or compile-then-fallback. */
export type EngineExecMode = 'interpret' | 'compile' | 'auto';

/** Select options for {@link EngineExecMode}, in preferred order. */
export const EXEC_MODE_OPTIONS: { value: EngineExecMode; label: string; hint: string }[] = [
  {
    value: 'interpret',
    label: 'Interpreter',
    hint: 'AST walk — full language surface, slower on large history',
  },
  {
    value: 'compile',
    label: 'Compiler',
    hint: 'Numba/numpy path — faster after first JIT; Flask is not prewarmed. Some Pine stays object-mode',
  },
  {
    value: 'auto',
    label: 'Auto',
    hint: 'Try compile first (best default on Server); fall back to interpret on failure',
  },
];

/**
 * Coerce a persisted or form value to a known exec mode.
 *
 * @param raw - Untrusted value from storage or an input.
 * @param fallback - Mode to use when `raw` is not one of the three modes.
 * @returns A valid {@link EngineExecMode}.
 */
export function normalizeExecMode(
  raw: unknown,
  fallback: EngineExecMode = 'interpret',
): EngineExecMode {
  const s = String(raw || fallback);
  if (s === 'compile' || s === 'auto' || s === 'interpret') return s;
  return fallback;
}

/**
 * Read one engine's plugin config, preferring the `pluginKey` entry and falling
 * back to the legacy bare id. The API key is stripped from the durable payload,
 * so the session vault is merged back in for direct readers.
 *
 * @param engineId - Engine id from the catalog.
 * @returns A shallow copy when a vault key is merged, otherwise the stored object.
 */
export function readEnginePluginConfig(engineId: string): Record<string, unknown> {
  const pc = store.pluginsConfig || {};
  const cfg = (pc[pluginKey('engine', engineId)] || pc[engineId] || {}) as Record<string, unknown>;
  // The durable payload strips `apiKey` — merge the session vault so direct
  // readers never see an empty key after a reload.
  try {
    const vaultKey = getEngineApiKey(store.pluginsConfig, engineId);
    if (vaultKey && String(cfg['apiKey'] || '').trim() !== vaultKey) {
      return { ...cfg, apiKey: vaultKey };
    }
  } catch {
    /* vault read must never break config reads */
  }
  return cfg;
}

/**
 * Whether the engine needs an endpoint URL (every server family, or any schema
 * that declares an `endpoint` field).
 *
 * @param engineId - Engine id from the catalog.
 * @returns `true` when the Runtime form should show the endpoint input.
 */
export function engineNeedsEndpoint(engineId: string): boolean {
  const e = getEngine(engineId);
  return e?.family === 'server' || !!e?.configSchema?.['endpoint'];
}

/**
 * Whether the engine exposes an exec-mode choice: all server/worker/Pyodide
 * families, plus any schema with a select-style `mode` field.
 *
 * @param engineId - Engine id from the catalog.
 * @returns `true` when the mode select should render.
 */
export function engineHasExecMode(engineId: string): boolean {
  const family = engineFamilyForId(engineId);
  if (family === 'server' || family === 'pyodide' || family === 'worker') return true;
  const schema = getEngine(engineId)?.configSchema;
  if (!schema?.['mode']) return false;
  return schema['mode'].type === 'select' || Array.isArray(schema['mode'].options);
}

/**
 * Whether the engine can prefer a WebSocket transport (server family, or a
 * boolean `preferWs` schema field).
 *
 * @param engineId - Engine id from the catalog.
 * @returns `true` when the prefer-WS toggle should render.
 */
export function engineHasPreferWs(engineId: string): boolean {
  if (engineFamilyForId(engineId) === 'server') return true;
  return getEngine(engineId)?.configSchema?.['preferWs']?.type === 'boolean';
}

/**
 * Whether the engine stores an API key (schema declares a string `apiKey`).
 *
 * @param engineId - Engine id from the catalog.
 * @returns `true` when the API-key field should render.
 */
export function engineHasApiKey(engineId: string): boolean {
  return getEngine(engineId)?.configSchema?.['apiKey']?.type === 'string';
}

/**
 * Whether the engine can warm its compiler over HTTP (`POST /compile/prewarm`).
 *
 * Only the `server` engine targets a PYNE host that exposes the route; the edge
 * worker and Pyodide have no Numba pass to warm.
 */
export function engineHasAutoPrewarm(engineId: string): boolean {
  return engineFamilyForId(engineId) === 'server';
}

/** Plugin-config key holding the auto-prewarm opt-in. */
export const AUTO_PREWARM_FIELD = 'autoPrewarm';

/**
 * Exec-mode options narrowed to what the engine's schema accepts, falling back
 * to the full list when the schema declares none or none match.
 *
 * @param engineId - Engine id from the catalog.
 * @returns Options to render in the mode select.
 */
export function execModeOptionsFor(
  engineId: string,
): { value: EngineExecMode; label: string; hint: string }[] {
  const opts = getEngine(engineId)?.configSchema?.['mode']?.options;
  if (!opts?.length) return EXEC_MODE_OPTIONS;
  const filtered = EXEC_MODE_OPTIONS.filter((o) => opts.includes(o.value));
  return filtered.length ? filtered : EXEC_MODE_OPTIONS;
}

/** Form payload for {@link saveEngineConfig}; fields are written only when the engine supports them. */
export type SaveEngineConfigInput = {
  engine: string;
  endpoint?: string;
  mode?: EngineExecMode;
  preferWs?: boolean;
  apiKey?: string;
  /** Warm applied scripts after save (`server` engine only). */
  autoPrewarm?: boolean;
  /** Status-bar suffix; default describes the engine write. */
  statusMessage?: string;
};

/**
 * Activate an engine and merge plugin config. Callers snapshot form fields
 * before invoking so a mid-save store update cannot clobber local state.
 */
export function saveEngineConfig(input: SaveEngineConfigInput): void {
  const engine = input.engine;
  const writeEndpoint = engineNeedsEndpoint(engine) && input.endpoint !== undefined;
  const writeExecMode = engineHasExecMode(engine) && input.mode !== undefined;
  const writePreferWs = engineHasPreferWs(engine) && input.preferWs !== undefined;
  const writeApiKey = engineHasApiKey(engine) && input.apiKey !== undefined;
  const writeAutoPrewarm = engineHasAutoPrewarm(engine) && input.autoPrewarm !== undefined;

  if (writeEndpoint) setStore('endpoint', String(input.endpoint || '').trim());
  setActivePlugin('engine', engine);

  if (writeEndpoint || writeExecMode || writePreferWs || writeApiKey || writeAutoPrewarm) {
    const key = pluginKey('engine', engine);
    const prev = readEnginePluginConfig(engine);
    const nextCfg: Record<string, unknown> = { ...prev };
    if (writeEndpoint) nextCfg['endpoint'] = String(input.endpoint || '').trim();
    if (writeExecMode) nextCfg['mode'] = input.mode;
    if (writePreferWs) nextCfg['preferWs'] = input.preferWs;
    if (writeApiKey) nextCfg['apiKey'] = String(input.apiKey || '').trim();
    if (writeAutoPrewarm) nextCfg[AUTO_PREWARM_FIELD] = !!input.autoPrewarm;
    setStore('pluginsConfig', key, reconcile(nextCfg));
  }

  // Mirror the key into the secret vault (durable local + session; the
  // durable payload never carries it).
  if (writeApiKey) setEngineApiKey(engine, String(input.apiKey || ''));

  flushPersist();
  const modePart = writeExecMode ? ` · mode=${input.mode}` : '';
  setStatus('ready', input.statusMessage || `Runtime saved · engine=${engine}${modePart}`);
}
