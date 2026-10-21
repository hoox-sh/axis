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

export type EngineExecMode = 'interpret' | 'compile' | 'auto';

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

export function normalizeExecMode(
  raw: unknown,
  fallback: EngineExecMode = 'interpret',
): EngineExecMode {
  const s = String(raw || fallback);
  if (s === 'compile' || s === 'auto' || s === 'interpret') return s;
  return fallback;
}

export function readEnginePluginConfig(engineId: string): Record<string, unknown> {
  const pc = store.pluginsConfig || {};
  const cfg = (pc[pluginKey('engine', engineId)] || pc[engineId] || {}) as Record<string, unknown>;
  // The durable payload strips `apiKey` — merge the session vault so direct
  // readers never see an empty key after a reload.
  try {
    const vaultKey = getEngineApiKey(store.pluginsConfig, engineId);
    if (vaultKey && String(cfg.apiKey || '').trim() !== vaultKey) {
      return { ...cfg, apiKey: vaultKey };
    }
  } catch {
    /* vault read must never break config reads */
  }
  return cfg;
}

export function engineNeedsEndpoint(engineId: string): boolean {
  const e = getEngine(engineId);
  return e?.family === 'server' || !!e?.configSchema?.endpoint;
}

export function engineHasExecMode(engineId: string): boolean {
  const family = engineFamilyForId(engineId);
  if (family === 'server' || family === 'pyodide' || family === 'worker') return true;
  const schema = getEngine(engineId)?.configSchema;
  if (!schema?.mode) return false;
  return schema.mode.type === 'select' || Array.isArray(schema.mode.options);
}

export function engineHasPreferWs(engineId: string): boolean {
  if (engineFamilyForId(engineId) === 'server') return true;
  return getEngine(engineId)?.configSchema?.preferWs?.type === 'boolean';
}

export function engineHasApiKey(engineId: string): boolean {
  return getEngine(engineId)?.configSchema?.apiKey?.type === 'string';
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

export function execModeOptionsFor(engineId: string) {
  const opts = getEngine(engineId)?.configSchema?.mode?.options;
  if (!opts?.length) return EXEC_MODE_OPTIONS;
  const filtered = EXEC_MODE_OPTIONS.filter((o) => opts.includes(o.value));
  return filtered.length ? filtered : EXEC_MODE_OPTIONS;
}

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
    if (writeEndpoint) nextCfg.endpoint = String(input.endpoint || '').trim();
    if (writeExecMode) nextCfg.mode = input.mode;
    if (writePreferWs) nextCfg.preferWs = input.preferWs;
    if (writeApiKey) nextCfg.apiKey = String(input.apiKey || '').trim();
    if (writeAutoPrewarm) nextCfg[AUTO_PREWARM_FIELD] = !!input.autoPrewarm;
    setStore('pluginsConfig', key, reconcile(nextCfg));
  }

  // Mirror the key into the secret vault (durable local + session; the
  // durable payload never carries it).
  if (writeApiKey) setEngineApiKey(engine, String(input.apiKey || ''));

  flushPersist();
  const modePart = writeExecMode ? ` · mode=${input.mode}` : '';
  setStatus(
    'ready',
    input.statusMessage || `Runtime saved · engine=${engine}${modePart}`,
  );
}
