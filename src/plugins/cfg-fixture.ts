// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Overlay a plugin `configSchema` with a cfg file.
 *
 * Edit {@link pluginCfgFile} (`src/plugins/fixtures/plugin-cfg.json`).
 * Each key is `kind:id` (for example `source:binance-rest`) or a kind
 * group (`{ "source": { "binance-rest": { … } } }`).
 *
 * A plugin block may:
 * - `hide` — keep the field as a fetch default, omit it from settings
 * - `disable` — show the field locked; stored overrides do not win
 * - `add` — insert or overload fields (new options included)
 * - `fields` — same overload, plus the shorthands `"hide"` and `"disable"`
 *
 * Unknown hide/disable names are ignored so a renamed field does not crash boot.
 *
 * @module plugins/cfg-fixture
 */

import type { ConfigSchema, FieldSchema, PluginKind } from './types';
import pluginCfgFile from './fixtures/plugin-cfg.json';

const FIELD_TYPES = new Set<FieldSchema['type']>([
  'string',
  'number',
  'boolean',
  'select',
  'password',
]);

const SPEC_KEYS = new Set(['hide', 'disable', 'add', 'fields']);

/** One field overload. A string shorthand only hides or disables an existing field. */
export type CfgFieldPatch = 'hide' | 'disable' | Partial<FieldSchema>;

/**
 * Overlays for one plugin.
 * `hide` / `disable` name existing fields. `add` and `fields` insert or replace.
 */
export type CfgPluginSpec = {
  hide?: string[];
  disable?: string[];
  add?: ConfigSchema;
  fields?: Record<string, CfgFieldPatch>;
};

/** Whole cfg file: `kind:id` entries, or nested `{ kind: { id: spec } }`. */
export type CfgFixtureFile = Record<string, CfgPluginSpec | Record<string, CfgPluginSpec>>;

function fail(message: string): never {
  throw new Error(`cfg fixture: ${message}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isSpec(v: unknown): v is CfgPluginSpec {
  if (!isRecord(v)) return false;
  return Object.keys(v).every((k) => SPEC_KEYS.has(k));
}

function stringList(v: unknown, label: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string' || !item.trim())) {
    fail(`${label} must be an array of field names`);
  }
  return v.map((item) => item.trim());
}

function asField(v: unknown, key: string): FieldSchema {
  if (!isRecord(v) || typeof v['type'] !== 'string' || !FIELD_TYPES.has(v['type'] as FieldSchema['type'])) {
    fail(`add "${key}" needs type string|number|boolean|select|password`);
  }
  return v as unknown as FieldSchema;
}

function asPatch(v: unknown, key: string): CfgFieldPatch {
  if (v === 'hide' || v === 'disable') return v;
  if (!isRecord(v)) fail(`fields.${key} must be "hide", "disable", or a field object`);
  if (v['type'] !== undefined && !FIELD_TYPES.has(v['type'] as FieldSchema['type'])) {
    fail(`fields.${key} has an unknown type`);
  }
  return v as unknown as Partial<FieldSchema>;
}

function normalizeSpec(raw: unknown, label: string): CfgPluginSpec {
  if (!isSpec(raw)) fail(`${label} must use hide, disable, add, and fields`);
  return {
    hide: stringList(raw.hide, `${label}.hide`),
    disable: stringList(raw.disable, `${label}.disable`),
    add: raw.add ? normalizeAdd(raw.add, label) : undefined,
    fields: raw.fields ? normalizeFields(raw.fields, label) : undefined,
  };
}

function normalizeAdd(v: unknown, label: string): ConfigSchema {
  if (!isRecord(v)) fail(`${label}.add must be an object of fields`);
  const out: ConfigSchema = {};
  for (const [key, field] of Object.entries(v)) out[key] = asField(field, key);
  return out;
}

function normalizeFields(v: unknown, label: string): Record<string, CfgFieldPatch> {
  if (!isRecord(v)) fail(`${label}.fields must be an object`);
  const out: Record<string, CfgFieldPatch> = {};
  for (const [key, patch] of Object.entries(v)) out[key] = asPatch(patch, key);
  return out;
}

/**
 * Parse a cfg file. Accepts a JSON string or an already-parsed object.
 * Throws a `cfg fixture:` error on a bad shape.
 */
export function parseCfgFixture(file: string | unknown): CfgFixtureFile {
  const raw = typeof file === 'string' ? parseJson(file) : file;
  if (!isRecord(raw)) fail('file must be a JSON object');
  const out: CfgFixtureFile = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isSpec(value)) {
      out[key] = normalizeSpec(value, key);
      continue;
    }
    if (!isRecord(value)) fail(`${key} must be a plugin block or a kind group`);
    const group: Record<string, CfgPluginSpec> = {};
    for (const [id, spec] of Object.entries(value)) {
      group[id] = normalizeSpec(spec, `${key}.${id}`);
    }
    out[key] = group;
  }
  return out;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(err instanceof Error ? err.message : 'invalid JSON');
  }
}

/** Spec for one plugin, from either `kind:id` or `{ kind: { id } }`. */
export function cfgSpecFor(
  file: CfgFixtureFile,
  kind: PluginKind,
  id: string,
): CfgPluginSpec | undefined {
  const flat = file[`${kind}:${id}`];
  if (isSpec(flat)) return flat;
  const group = file[kind];
  if (group && !isSpec(group) && isSpec(group[id])) return group[id];
  return undefined;
}

function cloneField(field: FieldSchema): FieldSchema {
  return { ...field, options: field.options ? [...field.options] : field.options };
}

function cloneSchema(schema: ConfigSchema | undefined): ConfigSchema {
  const out: ConfigSchema = {};
  for (const [key, field] of Object.entries(schema || {})) {
    if (field) out[key] = cloneField(field);
  }
  return out;
}

/**
 * Return a new schema with the fixture applied.
 * `hide` sets `hidden`. `disable` sets `disabled`. `add` / `fields` overload.
 */
export function applyCfgFixture(
  schema: ConfigSchema | undefined,
  spec: CfgPluginSpec | undefined,
): ConfigSchema {
  const out = cloneSchema(schema);
  if (!spec) return out;

  for (const [key, patch] of Object.entries(spec.fields || {})) {
    if (patch === 'hide') {
      if (out[key]) out[key] = { ...out[key], hidden: true };
      continue;
    }
    if (patch === 'disable') {
      if (out[key]) out[key] = { ...out[key], disabled: true };
      continue;
    }
    const prev = out[key];
    if (!prev && patch.type === undefined) fail(`fields.${key} needs a type to add a field`);
    const options = patch.options ? [...patch.options] : prev?.options ? [...prev.options] : undefined;
    out[key] = { ...(prev || { type: 'string' }), ...patch, options };
  }

  for (const key of spec.hide || []) {
    if (out[key]) out[key] = { ...out[key], hidden: true };
  }
  for (const key of spec.disable || []) {
    if (out[key]) out[key] = { ...out[key], disabled: true };
  }
  for (const [key, field] of Object.entries(spec.add || {})) {
    const prev = out[key];
    const options = field.options ? [...field.options] : prev?.options ? [...prev.options] : undefined;
    out[key] = { ...(prev || {}), ...cloneField(field), options };
  }
  return out;
}

/** Shipped cfg file. Edit the JSON; an empty object changes nothing. */
export function shippedCfgFixture(): CfgFixtureFile {
  return parseCfgFixture(pluginCfgFile);
}

/**
 * Schema a plugin should register with. Uses the shipped cfg file.
 * Plugins with no block are returned unchanged (still cloned only when a spec exists).
 */
export function overlayConfigSchema(
  kind: PluginKind,
  id: string,
  schema: ConfigSchema | undefined,
  file: CfgFixtureFile = shippedCfgFixture(),
): ConfigSchema | undefined {
  const spec = cfgSpecFor(file, kind, id);
  if (!spec) return schema;
  return applyCfgFixture(schema, spec);
}

/**
 * Merge stored values over schema defaults.
 * A `disabled` field keeps its schema default so a fixture lock holds.
 */
export function mergeSchemaConfig(
  schema: ConfigSchema | undefined,
  stored?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema || {})) {
    out[key] = field && 'default' in field ? field.default : undefined;
  }
  for (const [key, value] of Object.entries(stored || {})) {
    if (value === undefined) continue;
    if (schema?.[key]?.disabled) continue;
    out[key] = value;
  }
  return out;
}
