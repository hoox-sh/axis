// Copyright (C) 2024-2026 jango_blockchained
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
    hint: 'Numba/numpy path — faster; some constructs stay object-mode',
  },
  {
    value: 'auto',
    label: 'Auto',
    hint: 'Try compile first; fall back to interpret on failure',
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
  return (pc[pluginKey('engine', engineId)] || pc[engineId] || {}) as Record<string, unknown>;
}

export function engineNeedsEndpoint(engineId: string): boolean {
  const e = getEngine(engineId);
  return e?.id === 'server' || !!e?.configSchema?.endpoint;
}

export function engineHasExecMode(engineId: string): boolean {
  if (engineId === 'server' || engineId === 'pyodide' || engineId === 'pyne-worker') return true;
  const schema = getEngine(engineId)?.configSchema;
  if (!schema?.mode) return false;
  return schema.mode.type === 'select' || Array.isArray(schema.mode.options);
}

export function engineHasPreferWs(engineId: string): boolean {
  if (engineId === 'server') return true;
  return getEngine(engineId)?.configSchema?.preferWs?.type === 'boolean';
}

export function engineHasApiKey(engineId: string): boolean {
  return getEngine(engineId)?.configSchema?.apiKey?.type === 'string';
}

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

  if (writeEndpoint) setStore('endpoint', String(input.endpoint || '').trim());
  setActivePlugin('engine', engine);

  if (writeEndpoint || writeExecMode || writePreferWs || writeApiKey) {
    const key = pluginKey('engine', engine);
    const prev = readEnginePluginConfig(engine);
    const nextCfg: Record<string, unknown> = { ...prev };
    if (writeEndpoint) nextCfg.endpoint = String(input.endpoint || '').trim();
    if (writeExecMode) nextCfg.mode = input.mode;
    if (writePreferWs) nextCfg.preferWs = input.preferWs;
    if (writeApiKey) nextCfg.apiKey = String(input.apiKey || '').trim();
    setStore('pluginsConfig', key, reconcile(nextCfg));
  }

  flushPersist();
  const modePart = writeExecMode ? ` · mode=${input.mode}` : '';
  setStatus(
    'ready',
    input.statusMessage || `Runtime saved · engine=${engine}${modePart}`,
  );
}
