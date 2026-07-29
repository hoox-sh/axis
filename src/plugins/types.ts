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
 * Unified **plugin contracts** for AXIS.
 *
 * All kinds share {@link PluginBase}. Active selection lives in the Solid store
 * (`source` / `live.streamId` / `engine` / `activePlugins.*`); resolve at runtime
 * via `plugins/active`. Built-ins register through catalogs under
 * `sources/`, `streams/`, `engines/`, `storage/`.
 *
 * | Kind | Required method | Role |
 * |------|-----------------|------|
 * | `source` | `fetchHistorical` | Historical OHLCV |
 * | `stream` | `start` → `stop` | Live bars |
 * | `engine` | `isReady` + `run` | Pine evaluation |
 * | `storage` | `list`/`read`/`write`/`remove` | Script library |
 * | `component` | `mount` | UI slot (phase 2) |
 *
 * Dynamic URL plugins (`plugins/loader`) may install source/stream/engine only.
 *
 * @module plugins/types
 */

import type { Bar } from '../store/types';
import type { LogLevel } from '../store/types';

/** Discriminant for registry maps and Settings UI. */
export type PluginKind =
  | 'source'
  | 'stream'
  | 'engine'
  | 'storage'
  | 'component';

/** One settings field in a plugin `configSchema`. */
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: string | number | boolean;
  label?: string;
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

/** Map of field id → schema; defaults merged at call sites. */
export type ConfigSchema = Record<string, FieldSchema>;

/** Capability flags for Connection HUD / offline gating. */
export interface PluginCapabilities {
  offline?: boolean;
  needsAuth?: boolean;
  needsNetwork?: boolean;
  needsProxy?: boolean;
  /** Optional transport hint for Connection HUD (else inferred from id). */
  transport?: 'ws' | 'rest' | 'local' | 'broker';
}

/** Shared fields on every plugin kind. */
export interface PluginBase {
  id: string;
  name: string;
  kind: PluginKind;
  description?: string;
  version?: string;
  builtIn?: boolean;
  configSchema?: ConfigSchema;
  capabilities?: PluginCapabilities;
  init?(ctx: PluginContext): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

/** Optional host context for future `init` hooks. */
export interface PluginContext {
  getConfig(): Record<string, unknown>;
  setStatus(msg: string, level?: LogLevel): void;
  host: {
    fetch?: typeof fetch;
  };
}

/** Registry / config key: `${kind}:${id}`. */
export function pluginKey(kind: PluginKind, id: string): string {
  return `${kind}:${id}`;
}

// --- Source ---

/** Arguments to {@link SourcePlugin.fetchHistorical}. */
export interface SourceOpts {
  symbol: string;
  interval: string;
  limit?: number;
  config?: Record<string, unknown>;
}

/**
 * Historical data provider.
 * Returns bars with `time` in unix seconds (callers may re-normalize).
 */
export interface SourcePlugin extends PluginBase {
  kind: 'source';
  fetchHistorical(opts: SourceOpts): Promise<Bar[]>;
  searchSymbols?(query: string, config?: Record<string, unknown>): Promise<string[]>;
}

// --- Stream ---

/**
 * Live stream start options.
 * `start` must return a `stop()` cleanup; reconnect is plugin-internal.
 */
export interface StreamOpts {
  symbol: string;
  interval: string;
  config?: Record<string, unknown>;
  lastBar?: Bar | null;
  onBar: (b: Bar) => void;
  onError: (e: Error) => void;
  onStatus: (s: { state: 'open' | 'closed' | 'reconnecting' | string; url?: string; detail?: string }) => void;
}

/** Live OHLCV (or synthetic) feed. */
export interface StreamPlugin extends PluginBase {
  kind: 'stream';
  /** @returns stop/cleanup function */
  start(opts: StreamOpts): () => void;
}

// --- Engine ---

/**
 * Unified Pine evaluation result (server WS/REST, Pyodide, dynamic engines).
 *
 * Success payloads typically include `series` (named plots), optional
 * `events` (strategy), `drawings` (line/box/label), and `meta.plot_meta`.
 */
export interface RunResult {
  status: 'success' | 'error';
  plots: (number | null)[];
  series?: Record<string, (number | null)[]>;
  events: Array<{
    time: number;
    type: string;
    id?: string;
    price?: number;
    dir?: string;
    [k: string]: unknown;
  }>;
  /** Pine line/label/box objects from interpret runtime */
  drawings?: Array<Record<string, unknown>>;
  /** Pine input.* declarations from last run (engine-exported) */
  inputs?: Array<Record<string, unknown>> | unknown;
  error?: string;
  meta?: {
    mode?: string;
    script_id?: string;
    run_id?: string;
    ms?: number;
    count?: number;
    overlay?: boolean;
    script_name?: string;
    /** transport used: `ws` | `rest` | `local` */
    transport?: string;
    plot_meta?: Record<string, unknown>;
    inputs?: unknown;
    [k: string]: unknown;
  };
}

/** Arguments to {@link EnginePlugin.run}. */
export interface EngineOpts {
  script: string;
  bars: Bar[];
  config?: Record<string, unknown>;
  /** Pine input.* overrides keyed by title */
  inputs?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Pine calculation backend.
 * `run` should never throw for script errors — return `status: 'error'`.
 */
export interface EnginePlugin extends PluginBase {
  kind: 'engine';
  isReady(): Promise<boolean>;
  run(opts: EngineOpts): Promise<RunResult>;
}

// --- Storage (PR2 — interface reserved) ---

export interface ScriptMeta {
  id: string;
  name: string;
  description?: string;
  path?: string;
  updatedAt: number;
  createdAt?: number;
  revision?: string;
  tags?: string[];
}

export interface ScriptDocument extends ScriptMeta {
  content: string;
}

export interface SyncResult {
  ok: boolean;
  message?: string;
  revision?: string;
  conflicts?: Array<{ id: string; localRev?: string; remoteRev?: string }>;
}

export interface StorageStatus {
  connected: boolean;
  dirty?: boolean;
  lastSyncAt?: number;
  branch?: string;
  remote?: string;
  error?: string;
}

export interface StoragePlugin extends PluginBase {
  kind: 'storage';
  list(opts?: { prefix?: string; config?: Record<string, unknown> }): Promise<ScriptMeta[]>;
  read(id: string, config?: Record<string, unknown>): Promise<ScriptDocument>;
  write(doc: ScriptDocument, config?: Record<string, unknown>): Promise<ScriptMeta>;
  remove(id: string, config?: Record<string, unknown>): Promise<void>;
  saveDraft?(doc: { content: string; name?: string }, config?: Record<string, unknown>): Promise<void>;
  loadDraft?(config?: Record<string, unknown>): Promise<{ content: string; name?: string } | null>;
  sync?(direction: 'push' | 'pull' | 'both', config?: Record<string, unknown>): Promise<SyncResult>;
  getStatus?(config?: Record<string, unknown>): Promise<StorageStatus>;
}

// --- Component (phase 2 — reserved) ---

export interface ComponentPlugin extends PluginBase {
  kind: 'component';
  slots: Array<'manager-tab' | 'results-tab' | 'topbar-action' | 'settings-section'>;
  mount(slot: string, el: HTMLElement, api: Record<string, unknown>): () => void;
}

export type AnyPlugin =
  | SourcePlugin
  | StreamPlugin
  | EnginePlugin
  | StoragePlugin
  | ComponentPlugin;

export interface PluginSummaryItem {
  id: string;
  name: string;
  description: string;
  builtIn?: boolean;
}

export interface RegistrySummary {
  sources: PluginSummaryItem[];
  streams: PluginSummaryItem[];
  engines: PluginSummaryItem[];
  storages: PluginSummaryItem[];
}
