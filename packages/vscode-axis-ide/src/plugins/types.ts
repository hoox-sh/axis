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
 * Host-side plugin contracts (id metadata only — no Solid, no runtime fetch).
 *
 * Kinds mirror AXIS PWA `src/plugins/types.ts`:
 * `source` | `stream` | `engine` | `storage` | `dataset` | `component`.
 */

/** Discriminant for registry maps and Plugins TreeView. */
export type PluginKind =
  | 'source'
  | 'stream'
  | 'engine'
  | 'storage'
  | 'dataset'
  | 'component';

/** Ordered kind list for UI / iteration. */
export const PLUGIN_KINDS: readonly PluginKind[] = [
  'source',
  'stream',
  'engine',
  'storage',
  'dataset',
  'component',
] as const;

/** Registry / config key: `${kind}:${id}`. */
export function pluginKey(kind: PluginKind, id: string): string {
  return `${kind}:${id}`;
}

/** Built-in or dynamic plugin descriptor (metadata only). */
export type PluginDescriptor = {
  id: string;
  name: string;
  kind: PluginKind;
  builtIn?: boolean;
  description?: string;
};

/**
 * `globalState` key for installed dynamic plugin metadata.
 * Mirrors PWA `pynescript.axis.plugins.v1` intent — metadata only, no secrets.
 */
export const PLUGINS_GLOBAL_STATE_KEY = 'axis.plugins.v1';

/**
 * One installed dynamic plugin entry persisted under {@link PLUGINS_GLOBAL_STATE_KEY}.
 *
 * ## globalState shape (`axis.plugins.v1`)
 *
 * Value is a JSON array of {@link InstalledPluginMeta}:
 * ```json
 * [
 *   { "url": "https://…/plugin.js", "id": "my-source", "name": "My Source", "kind": "source", "description": "…" }
 * ]
 * ```
 *
 * Forbidden in stored JSON: `apiKey`, `password`, `token`, `secret`, Bearer strings,
 * or any other credential field — those live only in SecretStorage.
 */
export type InstalledPluginMeta = {
  url: string;
  id: string;
  name: string;
  kind: PluginKind | string;
  description?: string;
};

/** Documented empty default for `axis.plugins.v1`. */
export const EMPTY_PLUGINS_V1: readonly InstalledPluginMeta[] = [];

/**
 * Minimal Memento surface so unit tests inject a Map without loading `vscode`.
 * Extension wiring binds `context.globalState` (get/update).
 */
export type GlobalStateHelpers = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | void | Promise<void>;
};
