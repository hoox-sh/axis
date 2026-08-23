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
 * Parse Pine `input.*` declarations for the Script Settings modal.
 *
 * Prefer **engine-exported** `inputs` from the last run when present (more
 * accurate defaults / types). Fall back to lightweight source regex parse for
 * offline / pre-run UI.
 *
 * Supports `input.int|float|bool|string|color|source|timeframe|symbol|session|price|enum|text_area`
 * and bare `input(...)`. Emits {@link ScriptInputDef} with stable `id` = title.
 * Layout meta: `group`, `inline`, `tooltip` (`\\n`), `active` / `active=<ident>`,
 * plus LHS `varName` for active resolution. String consts like
 * `string GRP = "Moving Average"` resolve in `group=GRP`.
 *
 * **Source recovery:** bare `input(close, "Source")` and engine rows that
 * mis-type series defvals as float (resolved bar price) are coerced to
 * `type: 'source'` with {@link DEFAULT_SOURCE_OPTIONS}. See
 * {@link recoverSourceType} (client guard until pyne exports series inputs
 * as `source`).
 *
 * **Enum recovery:** `input.enum(m.Easing.linear)` (library alias) and local
 * `enum Easing` members become dropdowns. Values normalize to `Type.member`
 * so the form never shows Python/import-qualified tokens like
 * `m.Easing.linear`. See {@link recoverEnumType}.
 *
 * @module results/script-inputs
 */

export type ScriptInputType =
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  | 'color'
  | 'source'
  | 'timeframe'
  | 'symbol'
  | 'session'
  | 'price'
  | 'enum'
  | 'text'
  | 'unknown';

/**
 * Default dropdown for `input.source` (Pine Script™ / TradingView® parity).
 * Used when the script does not pass an explicit `options=` list and when the
 * engine export omits options.
 */
export const DEFAULT_SOURCE_OPTIONS = [
  'open',
  'high',
  'low',
  'close',
  'hl2',
  'hlc3',
  'ohlc4',
] as const;

/** Built-in series tokens accepted as `input.source` defval (case-insensitive). */
const SOURCE_SERIES_TOKENS = new Set<string>([
  ...DEFAULT_SOURCE_OPTIONS,
  'volume',
]);

export interface ScriptInputDef {
  /** Stable key = title when set, else generated id */
  id: string;
  title: string;
  type: ScriptInputType;
  default: unknown;
  value?: unknown;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: string[];
  /** Display labels for option values (enum member titles, plot refs). */
  optionLabels?: Record<string, string>;
  /** Pine `group=` — section heading in Settings (case-sensitive). */
  group?: string | null;
  /** Pine `tooltip=` — hover help; may contain `\n` line breaks. */
  tooltip?: string | null;
  /**
   * Pine `inline=` — same string places fields on one row (case-sensitive).
   * The identifier itself is not shown.
   */
  inline?: string | null;
  /**
   * Static enable flag from `active=true|false`. When {@link activeRef} is set,
   * the modal resolves enablement from the referenced input’s current value.
   */
  active?: boolean;
  /**
   * Pine `active=<ident>` — LHS var of another input (e.g. `active=showMA`).
   * Resolved at form-render time against {@link varName} of peer fields.
   */
  activeRef?: string | null;
  /**
   * LHS identifier of `name = input.*(...)` when parseable from source.
   * Used to resolve `active=<ident>` dependencies.
   */
  varName?: string | null;
}

/** One visual row in the Inputs tab (single field or an `inline` cluster). */
export type InputFormRow =
  | { kind: 'single'; field: ScriptInputDef }
  | { kind: 'inline'; key: string; fields: ScriptInputDef[] };

/** Grouped rows for the Script Settings modal (declaration order preserved). */
export interface InputFormGroup {
  group: string;
  rows: InputFormRow[];
}

/** True when `v` is a built-in OHLC/series source name (not a bar price). */
export function isSourceSeriesToken(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return SOURCE_SERIES_TOKENS.has(v.trim().toLowerCase());
}

/** True when value looks like a resolved bar number (e.g. engine sent close as "63210"). */
function isResolvedNumeric(v: unknown): boolean {
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  if (typeof v === 'string') {
    const s = v.trim();
    return s !== '' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s);
  }
  return false;
}

/**
 * Titles that typically label a series source selector in Pine.
 * Avoids false positives like "Source Length" (period/int inputs).
 */
export function titleLooksLikeSourceSelector(title: string, id = ''): boolean {
  for (const raw of [title, id]) {
    const c = raw.trim().toLowerCase().replace(/_/g, ' ');
    if (!c) continue;
    if (c === 'source' || c === 'src' || c === 'price source' || c === 'pricesource') {
      return true;
    }
    // "MA Source", "RSI Source", "src" — not "Source Length" / "source period"
    if (/(^|[\s])source$/.test(c) && !/\b(length|period|mult|factor|size|count|offset)\b/.test(c)) {
      return true;
    }
    if (/(^|[\s])src$/.test(c) && !/\b(length|period)\b/.test(c)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize a source pick: keep series tokens / plot refs; reject bar prices.
 */
function coerceSourcePick(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return fallback;
    // Cross-indicator plot refs from plot-sources (keep as-is)
    if (s.startsWith('plot:')) return s;
    const lower = s.toLowerCase();
    if (SOURCE_SERIES_TOKENS.has(lower)) return lower;
    // Custom options may be free-form strings (not pure numbers)
    if (!isResolvedNumeric(s)) return s;
  }
  if (isResolvedNumeric(v)) return fallback;
  if (v == null || v === '') return fallback;
  return fallback;
}

/** Ensure `source` inputs always expose the standard OHLC enum dropdown. */
function withSourceDefaults(def: ScriptInputDef): ScriptInputDef {
  if (def.type !== 'source') return def;
  const options =
    def.options?.length ? def.options : [...DEFAULT_SOURCE_OPTIONS];
  const fallback = 'close';
  const defaultVal = coerceSourcePick(def.default, fallback);
  const value = coerceSourcePick(
    def.value != null && def.value !== '' ? def.value : defaultVal,
    defaultVal,
  );
  return {
    ...def,
    options,
    default: defaultVal,
    value,
    min: null,
    max: null,
    step: null,
  };
}

/**
 * Recover `type: 'source'` when the engine mis-types bare `input(close, "Source")`
 * as float with a resolved bar value (e.g. default/value `"63210"`).
 *
 * Prefer engine `type: "source"` when pyne exports it correctly. This client
 * guard covers untyped `input(series, title)` until pyne classifies series
 * defvals as source (coordinate with pyne backend `inputs` meta).
 */
export function recoverSourceType(def: ScriptInputDef): ScriptInputDef {
  if (def.type === 'source') return withSourceDefaults(def);

  const defToken = isSourceSeriesToken(def.default);
  const valToken = isSourceSeriesToken(def.value);

  // Wrong type but series token preserved (open/high/low/close/…)
  if (defToken || valToken) {
    const token = String(defToken ? def.default : def.value)
      .trim()
      .toLowerCase();
    return withSourceDefaults({
      ...def,
      type: 'source',
      default: token,
      value: valToken ? String(def.value).trim().toLowerCase() : token,
    });
  }

  // float/int + Source-like title + numeric bar value (classic mis-export)
  const numericish =
    isResolvedNumeric(def.default) || isResolvedNumeric(def.value);
  const scalarType =
    def.type === 'float' ||
    def.type === 'int' ||
    def.type === 'unknown' ||
    def.type === 'price';
  if (
    scalarType &&
    numericish &&
    titleLooksLikeSourceSelector(def.title, def.id)
  ) {
    return withSourceDefaults({
      ...def,
      type: 'source',
      default: 'close',
      value: 'close',
    });
  }

  return def;
}

/** One member of a user-defined Pine `enum`. */
export interface PineEnumMember {
  name: string;
  /** `member = "Title"` display string, else the field name. */
  title: string;
}

/** Parsed `enum Name` declaration. */
export interface PineEnumDef {
  name: string;
  members: PineEnumMember[];
}

/**
 * Built-in Pine namespaces that must not be stripped as import aliases.
 * (`strategy.fixed`, `font.family_monospace`, `plot.style_line`, …)
 */
const BUILTIN_ENUM_NS = new Set([
  'adjustment',
  'alert',
  'barmerge',
  'box',
  'color',
  'dayofweek',
  'display',
  'extend',
  'font',
  'format',
  'hline',
  'label',
  'line',
  'location',
  'order',
  'plot',
  'polyline',
  'scale',
  'session',
  'shape',
  'size',
  'strategy',
  'table',
  'text',
  'xloc',
  'yloc',
]);

const IMPORT_ALIAS_RE =
  /^\s*import\s+([A-Za-z_]\w*)\/([A-Za-z_]\w*)\/\d+(?:\s+as\s+([A-Za-z_]\w*))?/gm;

/** Import aliases (`import ns/Lib/1 as m` → `m`) plus default lib names. */
export function collectImportAliases(source: string): Set<string> {
  const out = new Set<string>();
  if (!source) return out;
  IMPORT_ALIAS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_ALIAS_RE.exec(source)) !== null) {
    out.add(m[3] || m[2]!);
  }
  return out;
}

function stripLineComment(line: string): string {
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

const ENUM_HEADER_RE = /^(?:export\s+)?enum\s+([A-Za-z_]\w*)\b/;
const ENUM_MEMBER_RE =
  /^([A-Za-z_]\w*)(?:\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'))?$/;

/**
 * Parse user-defined `enum Name` declarations (optional `export`).
 * Members may have a display title: `linear = "Linear"`.
 */
export function parsePineEnums(source: string): Map<string, PineEnumDef> {
  const map = new Map<string, PineEnumDef>();
  if (!source) return map;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = stripLineComment(lines[i]!).trim();
    const hm = head.match(ENUM_HEADER_RE);
    if (!hm) continue;
    const name = hm[1]!;
    const members: PineEnumMember[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const trimmed = stripLineComment(lines[j]!).trim();
      if (!trimmed) {
        j++;
        continue;
      }
      const mm = trimmed.match(ENUM_MEMBER_RE);
      if (!mm) break;
      const memName = mm[1]!;
      const title = mm[2] ?? mm[3] ?? memName;
      members.push({ name: memName, title });
      j++;
    }
    if (members.length) map.set(name, { name, members });
    i = j - 1;
  }
  return map;
}

/** Merge enum maps; first source wins on name collision. */
export function mergePineEnums(
  ...maps: Array<Map<string, PineEnumDef> | undefined>
): Map<string, PineEnumDef> {
  const out = new Map<string, PineEnumDef>();
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of m) {
      if (!out.has(k)) out.set(k, v);
    }
  }
  return out;
}

export function collectPineEnumsFromSources(
  sources: readonly string[],
): Map<string, PineEnumDef> {
  const out = new Map<string, PineEnumDef>();
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of parsePineEnums(src)) {
      if (!out.has(k)) out.set(k, v);
    }
  }
  return out;
}

function isImportAliasLike(ident: string): boolean {
  return /^[a-z][A-Za-z0-9_]*$/.test(ident) && !BUILTIN_ENUM_NS.has(ident);
}

function isTypeNameLike(ident: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(ident);
}

/**
 * Canonical Pine enum token: `Type.member`.
 * Strips library aliases (`m.Easing.linear` → `Easing.linear`) but never
 * built-in namespaces (`strategy.percent_of_equity`).
 */
export function normalizeEnumToken(
  raw: unknown,
  aliases?: ReadonlySet<string>,
): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const parts = s.split('.');
  if (parts.length === 3) {
    const [a, t, mem] = parts as [string, string, string];
    const strip =
      !BUILTIN_ENUM_NS.has(a) &&
      (aliases?.has(a) || (isImportAliasLike(a) && isTypeNameLike(t)));
    if (strip) return `${t}.${mem}`;
    return s;
  }
  return s;
}

/** `Type.member` → `{ type, member }` after alias strip. */
export function splitEnumToken(
  raw: unknown,
  aliases?: ReadonlySet<string>,
): { type: string; member: string } | null {
  const tok = normalizeEnumToken(raw, aliases);
  const i = tok.lastIndexOf('.');
  if (i <= 0 || i === tok.length - 1) return null;
  const type = tok.slice(0, i);
  const member = tok.slice(i + 1);
  if (!/^[A-Za-z_]\w*$/.test(member)) return null;
  // Drop leftover alias if still present (`m.Easing` as type)
  const bits = type.split('.');
  const typeName = bits[bits.length - 1]!;
  if (!/^[A-Za-z_]\w*$/.test(typeName)) return null;
  return { type: typeName, member };
}

function looksLikeUserEnumToken(
  raw: unknown,
  aliases?: ReadonlySet<string>,
): boolean {
  const parts = String(raw ?? '')
    .trim()
    .split('.');
  if (parts.length === 2) {
    return isTypeNameLike(parts[0]!) && !BUILTIN_ENUM_NS.has(parts[0]!);
  }
  if (parts.length === 3) {
    const [a, t] = parts;
    return (
      !BUILTIN_ENUM_NS.has(a!) &&
      (aliases?.has(a!) || isImportAliasLike(a!)) &&
      isTypeNameLike(t!)
    );
  }
  return false;
}

function optionsForEnum(
  typeName: string,
  enums: Map<string, PineEnumDef>,
): { options: string[]; labels: Record<string, string> } | null {
  const def = enums.get(typeName);
  if (!def?.members.length) return null;
  const options: string[] = [];
  const labels: Record<string, string> = {};
  for (const mem of def.members) {
    const tok = `${def.name}.${mem.name}`;
    options.push(tok);
    labels[tok] = mem.title || mem.name;
  }
  return { options, labels };
}

/**
 * Pick the option that matches `v` after alias/member normalization.
 */
export function matchEnumOption(
  v: unknown,
  options: readonly string[] | undefined,
  aliases?: ReadonlySet<string>,
): string | null {
  if (v == null || v === '') return null;
  const raw = String(v).trim();
  const norm = normalizeEnumToken(raw, aliases);
  const member = splitEnumToken(norm, aliases)?.member ?? norm;
  if (options?.length) {
    for (const opt of options) {
      if (opt === raw || opt === norm) return opt;
      const on = normalizeEnumToken(opt, aliases);
      if (on === norm || on === raw) return opt;
      if ((splitEnumToken(on, aliases)?.member ?? on) === member) return opt;
    }
  }
  return norm || raw;
}

/**
 * Recover `type: 'enum'` + `Type.member` options from local / imported enums.
 *
 * Engine and source often leak `m.Easing.linear` (import alias / Python
 * module path). Settings must show and submit `Easing.linear`.
 */
export function recoverEnumType(
  def: ScriptInputDef,
  enums: Map<string, PineEnumDef>,
  aliases?: ReadonlySet<string>,
): ScriptInputDef {
  const aliasSet = aliases ?? new Set<string>();
  const defLooks = looksLikeUserEnumToken(def.default, aliasSet);
  const valLooks = looksLikeUserEnumToken(def.value, aliasSet);
  const isEnum = def.type === 'enum' || defLooks || valLooks;
  if (!isEnum) return def;

  const split =
    splitEnumToken(def.default, aliasSet) ||
    splitEnumToken(def.value, aliasSet);
  const inferred = split ? optionsForEnum(split.type, enums) : null;

  const rawOpts = def.options?.length
    ? def.options.map((o) => normalizeEnumToken(o, aliasSet) || String(o))
    : inferred?.options;
  const options = rawOpts?.length ? [...new Set(rawOpts)] : undefined;

  const labels: Record<string, string> = { ...(def.optionLabels || {}) };
  if (inferred) Object.assign(labels, inferred.labels);
  if (options) {
    for (const o of options) {
      if (!labels[o]) {
        labels[o] = splitEnumToken(o, aliasSet)?.member || o;
      }
    }
  }

  const defaultTok =
    matchEnumOption(def.default, options, aliasSet) ??
    normalizeEnumToken(def.default, aliasSet) ??
    def.default;
  const valueTok =
    matchEnumOption(
      def.value != null && def.value !== '' ? def.value : defaultTok,
      options,
      aliasSet,
    ) ?? defaultTok;

  return {
    ...def,
    type: 'enum',
    default: defaultTok,
    value: valueTok,
    options,
    optionLabels: Object.keys(labels).length ? labels : def.optionLabels,
  };
}

const CALL_RE =
  /(?:input\.(int|float|bool|string|color|source|timeframe|symbol|session|price|enum|text_area)|(?<![\w.])input)\s*\(/g;

function findMatchingParen(src: string, openIdx: number): number {
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let cur = '';
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (inStr) {
      cur += c;
      if (c === '\\') {
        i++;
        if (i < inner.length) cur += inner[i];
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      cur += c;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (!s) return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'na' || s === 'None' || s === 'null') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return unquote(s);
  }
  // color.red / color.new(...) → keep string token for UI color inputs
  if (s.startsWith('color.') || s.startsWith('#')) return s;
  return s;
}

function kw(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  for (const a of args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length).trim();
  }
  return undefined;
}

function pos(args: string[], index: number): string | undefined {
  let pi = 0;
  for (const a of args) {
    if (a.includes('=') && !/^[^=]+==/.test(a) && !a.startsWith('==')) {
      // keyword arg — skip for positional count
      if (/^\w+\s*=/.test(a)) continue;
    }
    if (pi === index) return a;
    pi++;
  }
  return undefined;
}

function parseOptions(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!(s.startsWith('[') && s.endsWith(']'))) return undefined;
  const inner = s.slice(1, -1);
  const parts = splitTopLevelArgs(inner);
  if (!parts.length) return undefined;
  return parts.map((p) => String(parseLiteral(p) ?? unquote(p)));
}

/**
 * Best-effort LHS of `name = input.*(` immediately before `callStart`.
 * Skips type prefixes (`int length = input.int(...)`).
 */
export function findLhsIdent(src: string, callStart: number): string | null {
  let i = callStart - 1;
  while (i >= 0 && /[\s\u00a0]/.test(src[i]!)) i--;
  if (i < 0 || src[i] !== '=') return null;
  i--;
  while (i >= 0 && /[\s\u00a0]/.test(src[i]!)) i--;
  if (i < 0 || !/[\w]/.test(src[i]!)) return null;
  const end = i;
  while (i >= 0 && /[\w]/.test(src[i]!)) i--;
  const ident = src.slice(i + 1, end + 1);
  if (!/^[A-Za-z_]\w*$/.test(ident)) return null;
  // Reject common type keywords mistaken as names
  if (
    /^(int|float|bool|string|color|source|series|simple|const|var|varip)$/i.test(
      ident,
    )
  ) {
    return null;
  }
  return ident;
}

/** Normalize Pine tooltip escapes (`\\n` → newline). */
export function normalizeTooltip(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw);
  if (!s) return null;
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * Whether a field should be editable given current form values.
 * Resolves Pine `active=<ident>` against peer {@link ScriptInputDef.varName}.
 */
export function isInputActive(
  field: ScriptInputDef,
  all: readonly ScriptInputDef[],
): boolean {
  if (field.activeRef) {
    const dep = all.find(
      (f) => f.varName === field.activeRef || f.id === field.activeRef,
    );
    if (dep) {
      const v = dep.value ?? dep.default;
      return !!v;
    }
    // Unresolved ref — leave enabled so the user can still edit
    return true;
  }
  return field.active !== false;
}

/**
 * Layout fields into group → rows, clustering consecutive same-`inline` keys.
 * Matches TradingView Settings: `group` sections, `inline` shared rows.
 */
export function layoutInputRows(
  fields: readonly ScriptInputDef[],
): InputFormGroup[] {
  const groups: InputFormGroup[] = [];
  const groupIndex = new Map<string, number>();

  const ensureGroup = (name: string): InputFormGroup => {
    const existing = groupIndex.get(name);
    if (existing != null) return groups[existing]!;
    const g: InputFormGroup = { group: name, rows: [] };
    groupIndex.set(name, groups.length);
    groups.push(g);
    return g;
  };

  // Track open inline clusters per group so non-consecutive same keys don't merge
  const openInline = new Map<string, { key: string; row: Extract<InputFormRow, { kind: 'inline' }> }>();

  for (const f of fields) {
    const gName = f.group?.trim() || 'Inputs';
    const g = ensureGroup(gName);
    const inlineKey = f.inline?.trim() || '';
    if (!inlineKey) {
      openInline.delete(gName);
      g.rows.push({ kind: 'single', field: f });
      continue;
    }
    const open = openInline.get(gName);
    if (open && open.key === inlineKey) {
      open.row.fields.push(f);
      continue;
    }
    const row: Extract<InputFormRow, { kind: 'inline' }> = {
      kind: 'inline',
      key: inlineKey,
      fields: [f],
    };
    g.rows.push(row);
    openInline.set(gName, { key: inlineKey, row });
  }

  return groups;
}

function mapType(kind: string | undefined): ScriptInputType {
  switch (kind) {
    case 'int':
      return 'int';
    case 'float':
    case 'price':
      return 'float';
    case 'bool':
      return 'bool';
    case 'string':
    case 'symbol':
    case 'session':
    case 'timeframe':
    case 'source':
      return kind as ScriptInputType;
    case 'color':
      return 'color';
    case 'enum':
      return 'enum';
    case 'text_area':
      return 'text';
    default:
      return 'unknown';
  }
}

/**
 * Collect simple string constants for resolving `group=GRP` / `inline=ROW`
 * when authors use `string GRP = "Moving Average"` (common Pine style).
 */
export function collectStringConsts(source: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!source) return map;
  const re =
    /(?:^|[\n;])\s*(?:string\s+)?([A-Za-z_]\w*)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1]!;
    const lit = parseLiteral(m[2]!);
    if (typeof lit === 'string') map.set(name, lit);
  }
  return map;
}

/** Resolve a keyword value that may be a quoted string or a string const ident. */
function resolveStringish(
  raw: string | undefined,
  consts: Map<string, string>,
): string | null {
  if (raw == null) return null;
  const lit = parseLiteral(raw);
  if (typeof lit === 'string') {
    // Bare ident that matches a const
    if (/^[A-Za-z_]\w*$/.test(lit) && consts.has(lit)) {
      return consts.get(lit)!;
    }
    // Quoted string or other token
    if (
      (raw.trim().startsWith('"') || raw.trim().startsWith("'")) &&
      typeof lit === 'string'
    ) {
      return lit;
    }
    if (consts.has(String(lit))) return consts.get(String(lit))!;
    // Unquoted non-const ident — keep as-is (group label = "GRP")
    return lit;
  }
  if (typeof lit === 'number' || typeof lit === 'boolean') return String(lit);
  const ident = raw.trim();
  if (/^[A-Za-z_]\w*$/.test(ident) && consts.has(ident)) {
    return consts.get(ident)!;
  }
  return ident || null;
}

/**
 * Parse `input.*` / `input()` calls from Pine source into field defs.
 * Prefer {@link resolveScriptInputs} which merges engine-exported inputs.
 */
export function parseScriptInputs(
  source: string,
  extraSources?: readonly string[],
): ScriptInputDef[] {
  if (!source?.trim()) return [];
  const out: ScriptInputDef[] = [];
  const seen = new Set<string>();
  const stringConsts = collectStringConsts(source);
  const aliases = collectImportAliases(source);
  const enums = mergePineEnums(
    parsePineEnums(source),
    extraSources?.length ? collectPineEnumsFromSources(extraSources) : undefined,
  );
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(source)) !== null) {
    const kind = m[1]; // undefined for bare input(
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(source, openIdx);
    if (closeIdx < 0) continue;
    const inner = source.slice(openIdx + 1, closeIdx);
    const args = splitTopLevelArgs(inner);
    if (!args.length) continue;

    const type = mapType(kind);
    const defRaw = kw(args, 'defval') ?? pos(args, 0);
    const titleRaw = kw(args, 'title') ?? pos(args, 1);
    const title = titleRaw ? String(parseLiteral(titleRaw) ?? unquote(titleRaw)) : '';
    const defval =
      defRaw != null
        ? parseLiteral(defRaw)
        : type === 'bool'
          ? false
          : type === 'source'
            ? 'close'
            : 0;

    let min: number | null | undefined;
    let max: number | null | undefined;
    let step: number | null | undefined;
    let options: string[] | undefined;

    if (type === 'int' || type === 'float' || type === 'price') {
      const minR = kw(args, 'minval') ?? pos(args, 2);
      const maxR = kw(args, 'maxval') ?? pos(args, 3);
      const stepR = kw(args, 'step') ?? pos(args, 4);
      if (minR != null) {
        const v = parseLiteral(minR);
        min = typeof v === 'number' ? v : null;
      }
      if (maxR != null) {
        const v = parseLiteral(maxR);
        max = typeof v === 'number' ? v : null;
      }
      if (stepR != null) {
        const v = parseLiteral(stepR);
        step = typeof v === 'number' ? v : null;
      }
    }

    if (type === 'string' || type === 'enum' || type === 'source') {
      options = parseOptions(
        kw(args, 'options') ?? (type === 'enum' ? pos(args, 2) : undefined),
      );
    }

    const groupR = kw(args, 'group');
    const tooltipR = kw(args, 'tooltip');
    const inlineR = kw(args, 'inline');
    const activeR = kw(args, 'active');
    const varName = findLhsIdent(source, m.index);

    let active = true;
    let activeRef: string | null = null;
    if (activeR != null) {
      const lit = parseLiteral(activeR);
      if (typeof lit === 'boolean') {
        active = lit;
      } else {
        // `active=showMA` or bare ident
        const ident = String(lit ?? activeR).trim();
        if (/^[A-Za-z_]\w*$/.test(ident) && ident !== 'true' && ident !== 'false') {
          activeRef = ident;
        }
      }
    }

    const idBase = title || varName || `input_${out.length}`;
    let id = idBase;
    let n = 2;
    while (seen.has(id)) {
      id = `${idBase}_${n++}`;
    }
    seen.add(id);

    let resolvedType: ScriptInputType = type;
    if (type === 'unknown') {
      // Bare `input(close, "Source")` — series token → source (not string/float)
      if (isSourceSeriesToken(defval) || (defRaw != null && isSourceSeriesToken(defRaw))) {
        resolvedType = 'source';
      } else if (typeof defval === 'boolean') {
        resolvedType = 'bool';
      } else if (typeof defval === 'number') {
        resolvedType = Number.isInteger(defval) ? 'int' : 'float';
      } else {
        resolvedType = 'string';
      }
    }

    const finalDefault =
      resolvedType === 'source' && isSourceSeriesToken(defval)
        ? String(defval).trim().toLowerCase()
        : defval;

    if (resolvedType === 'source' && !options?.length) {
      options = parseOptions(kw(args, 'options'));
    }

    const groupVal = groupR ? resolveStringish(groupR, stringConsts) : null;
    const tooltipVal = tooltipR
      ? normalizeTooltip(resolveStringish(tooltipR, stringConsts))
      : null;
    const inlineVal = inlineR ? resolveStringish(inlineR, stringConsts) : null;

    out.push(
      recoverEnumType(
        recoverSourceType({
          id,
          title: title || id,
          type: resolvedType,
          default: finalDefault,
          value: finalDefault,
          min: min ?? null,
          max: max ?? null,
          step: step ?? null,
          options,
          group: groupVal,
          tooltip: tooltipVal,
          inline: inlineVal,
          active,
          activeRef,
          varName,
        }),
        enums,
        aliases,
      ),
    );
  }
  return out;
}

/** Normalize engine-exported input metadata into ScriptInputDef[]. */
export function normalizeEngineInputs(
  raw: unknown,
  extra?: { enums?: Map<string, PineEnumDef>; aliases?: ReadonlySet<string> },
): ScriptInputDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptInputDef[] = [];
  const seen = new Set<string>();
  const enums = extra?.enums ?? new Map<string, PineEnumDef>();
  const aliases = extra?.aliases ?? new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const title = String(r.title ?? r.name ?? r.id ?? `input_${i}`);
    let id = String(r.id ?? title);
    let n = 2;
    while (seen.has(id)) id = `${title}_${n++}`;
    seen.add(id);
    const type = mapType(String(r.type || 'unknown'));
    let active = r.active !== false;
    let activeRef: string | null = null;
    if (typeof r.active === 'string') {
      const ident = r.active.trim();
      if (/^[A-Za-z_]\w*$/.test(ident) && ident !== 'true' && ident !== 'false') {
        activeRef = ident;
        active = true;
      }
    } else if (r.active === false) {
      active = false;
    }
    if (r.activeRef != null && String(r.activeRef).trim()) {
      activeRef = String(r.activeRef).trim();
    }
    out.push(
      recoverEnumType(
        recoverSourceType({
          id,
          title,
          type,
          default: r.default ?? r.defval ?? r.value,
          value: r.value ?? r.default ?? r.defval,
          min: r.min != null ? Number(r.min) : r.minval != null ? Number(r.minval) : null,
          max: r.max != null ? Number(r.max) : r.maxval != null ? Number(r.maxval) : null,
          step: r.step != null ? Number(r.step) : null,
          options: Array.isArray(r.options) ? r.options.map(String) : undefined,
          group: r.group != null ? String(r.group) : null,
          tooltip: r.tooltip != null ? normalizeTooltip(String(r.tooltip)) : null,
          inline: r.inline != null ? String(r.inline) : null,
          active,
          activeRef,
          varName: r.varName != null ? String(r.varName) : r.name != null ? String(r.name) : null,
        }),
        enums,
        aliases,
      ),
    );
  }
  return out;
}

/**
 * Merge source parse + engine export; engine wins on type/min/max when titles match.
 * Source type from either side is preserved when the other side mis-typed a series input.
 */
export function resolveScriptInputs(
  source: string,
  engineInputs?: unknown,
  extraSources?: readonly string[],
): ScriptInputDef[] {
  const fromSrc = parseScriptInputs(source, extraSources);
  const aliases = collectImportAliases(source);
  const enums = mergePineEnums(
    parsePineEnums(source),
    extraSources?.length ? collectPineEnumsFromSources(extraSources) : undefined,
  );
  const fromEng = normalizeEngineInputs(engineInputs, { enums, aliases });
  if (!fromEng.length) return fromSrc;
  if (!fromSrc.length) return fromEng;
  const byTitle = new Map(fromEng.map((d) => [d.title, d]));
  const merged = fromSrc.map((s) => {
    const e = byTitle.get(s.title);
    if (!e) return s;
    byTitle.delete(s.title);
    // Prefer non-empty options from either side (engine may omit source enums)
    const options =
      e.options?.length ? e.options : s.options?.length ? s.options : undefined;

    // Engine float + script source (or recovered): keep series selector UX.
    // When neither side is already `source`, the third arm of the || is only
    // reached after TS has narrowed both types away from `'source'` — do not
    // re-check `!== 'source'` there (no-overlap under control-flow analysis).
    const eitherIsSource = s.type === 'source' || e.type === 'source';
    const preferSource =
      eitherIsSource ||
      (titleLooksLikeSourceSelector(s.title, s.id) &&
        (isResolvedNumeric(e.value) || isResolvedNumeric(e.default)));

    if (
      preferSource &&
      (eitherIsSource ||
        isResolvedNumeric(e.value) ||
        isResolvedNumeric(e.default))
    ) {
      const tokenDefault = isSourceSeriesToken(s.default)
        ? String(s.default).toLowerCase()
        : isSourceSeriesToken(e.default)
          ? String(e.default).toLowerCase()
          : 'close';
      const tokenValue = isSourceSeriesToken(e.value)
        ? String(e.value).toLowerCase()
        : isSourceSeriesToken(s.value)
          ? String(s.value).toLowerCase()
          : tokenDefault;
      return recoverEnumType(
        recoverSourceType({
          ...s,
          ...e,
          id: s.id,
          title: s.title,
          type: 'source',
          default: tokenDefault,
          value: tokenValue,
          options,
          min: null,
          max: null,
          step: null,
        }),
        enums,
        aliases,
      );
    }

    const optionLabels = { ...s.optionLabels, ...e.optionLabels };
    const preferEnum = s.type === 'enum' || e.type === 'enum';
    return recoverEnumType(
      recoverSourceType({
        ...s,
        ...e,
        id: s.id,
        title: s.title,
        type: preferEnum ? 'enum' : e.type || s.type,
        options,
        optionLabels: Object.keys(optionLabels).length ? optionLabels : undefined,
        // Prefer source-parse layout meta (inline / activeRef / varName) when engine omits
        group: e.group ?? s.group,
        tooltip: e.tooltip ?? s.tooltip,
        inline: e.inline ?? s.inline,
        active: e.activeRef || s.activeRef ? true : e.active !== false && s.active !== false,
        activeRef: e.activeRef ?? s.activeRef,
        varName: e.varName ?? s.varName,
        value: e.value ?? s.value ?? s.default,
      }),
      enums,
      aliases,
    );
  });
  for (const leftover of byTitle.values()) {
    merged.push(recoverEnumType(recoverSourceType(leftover), enums, aliases));
  }
  return merged.map((d) => recoverEnumType(recoverSourceType(d), enums, aliases));
}

/** True when a form value matches the script declaration default. */
export function sameInputValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (
    (typeof a === 'number' || typeof b === 'number') &&
    a != null &&
    b != null &&
    a !== '' &&
    b !== ''
  ) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return false;
}

function overrideKeys(d: ScriptInputDef): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const k of [d.title, d.id, d.varName]) {
    const s = typeof k === 'string' ? k.trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    keys.push(s);
  }
  return keys;
}

/** Look up a saved override by title, id, or LHS var name. */
export function lookupInputOverride(
  overrides: Record<string, unknown> | null | undefined,
  d: Pick<ScriptInputDef, 'title' | 'id' | 'varName'>,
): unknown {
  if (!overrides) return undefined;
  for (const k of [d.title, d.id, d.varName]) {
    const s = typeof k === 'string' ? k.trim() : '';
    if (s && Object.prototype.hasOwnProperty.call(overrides, s)) return overrides[s];
  }
  return undefined;
}

/** Apply override map (keyed by title, id, or var name) onto defs. */
export function applyInputOverrides(
  defs: ScriptInputDef[],
  overrides?: Record<string, unknown> | null,
): ScriptInputDef[] {
  if (!overrides || !Object.keys(overrides).length) {
    return defs.map((d) => ({ ...d, value: d.value ?? d.default }));
  }
  return defs.map((d) => {
    let v = lookupInputOverride(overrides, d);
    if (v === undefined) v = d.value ?? d.default;
    if (d.type === 'enum') {
      v = matchEnumOption(v, d.options) ?? v;
    }
    return { ...d, value: v };
  });
}

/**
 * Build override payload for the engine and persisted `inputValues`.
 *
 * Default: only values that differ from the script default, keyed by title
 * plus id/varName aliases so PYNE title lookup and untitled `length = input.int(14)`
 * both match. Pass `{ all: true }` for a full snapshot.
 */
export function overridesFromDefs(
  defs: ScriptInputDef[],
  opts?: { all?: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const all = opts?.all === true;
  for (const d of defs) {
    const v = d.value ?? d.default;
    if (!all && sameInputValue(v, d.default)) continue;
    for (const k of overrideKeys(d)) out[k] = v;
  }
  return out;
}
