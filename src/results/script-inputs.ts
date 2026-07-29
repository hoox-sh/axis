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
  group?: string | null;
  tooltip?: string | null;
  active?: boolean;
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
 * Parse `input.*` / `input()` calls from Pine source into field defs.
 * Prefer {@link resolveScriptInputs} which merges engine-exported inputs.
 */
export function parseScriptInputs(source: string): ScriptInputDef[] {
  if (!source?.trim()) return [];
  const out: ScriptInputDef[] = [];
  const seen = new Set<string>();
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
    const defval = defRaw != null ? parseLiteral(defRaw) : type === 'bool' ? false : 0;

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
      options = parseOptions(kw(args, 'options') ?? (type === 'enum' ? pos(args, 2) : undefined));
    }

    const groupR = kw(args, 'group');
    const tooltipR = kw(args, 'tooltip');
    const idBase = title || `input_${out.length}`;
    let id = idBase;
    let n = 2;
    while (seen.has(id)) {
      id = `${idBase}_${n++}`;
    }
    seen.add(id);

    out.push({
      id,
      title: title || id,
      type: type === 'unknown' && typeof defval === 'boolean'
        ? 'bool'
        : type === 'unknown' && typeof defval === 'number'
          ? Number.isInteger(defval)
            ? 'int'
            : 'float'
          : type === 'unknown'
            ? 'string'
            : type,
      default: defval,
      value: defval,
      min: min ?? null,
      max: max ?? null,
      step: step ?? null,
      options,
      group: groupR ? String(parseLiteral(groupR) ?? unquote(groupR)) : null,
      tooltip: tooltipR ? String(parseLiteral(tooltipR) ?? unquote(tooltipR)) : null,
      active: true,
    });
  }
  return out;
}

/** Normalize engine-exported input metadata into ScriptInputDef[]. */
export function normalizeEngineInputs(raw: unknown): ScriptInputDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptInputDef[] = [];
  const seen = new Set<string>();
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
    out.push({
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
      tooltip: r.tooltip != null ? String(r.tooltip) : null,
      active: r.active !== false,
    });
  }
  return out;
}

/**
 * Merge source parse + engine export; engine wins on type/min/max when titles match.
 */
export function resolveScriptInputs(
  source: string,
  engineInputs?: unknown,
): ScriptInputDef[] {
  const fromSrc = parseScriptInputs(source);
  const fromEng = normalizeEngineInputs(engineInputs);
  if (!fromEng.length) return fromSrc;
  if (!fromSrc.length) return fromEng;
  const byTitle = new Map(fromEng.map((d) => [d.title, d]));
  const merged = fromSrc.map((s) => {
    const e = byTitle.get(s.title);
    if (!e) return s;
    byTitle.delete(s.title);
    return {
      ...s,
      ...e,
      id: s.id,
      title: s.title,
      value: e.value ?? s.value ?? s.default,
    };
  });
  for (const leftover of byTitle.values()) merged.push(leftover);
  return merged;
}

/** Apply override map (keyed by title or id) onto defs for form initial values. */
export function applyInputOverrides(
  defs: ScriptInputDef[],
  overrides?: Record<string, unknown> | null,
): ScriptInputDef[] {
  if (!overrides || !Object.keys(overrides).length) {
    return defs.map((d) => ({ ...d, value: d.value ?? d.default }));
  }
  return defs.map((d) => {
    const v =
      overrides[d.title] !== undefined
        ? overrides[d.title]
        : overrides[d.id] !== undefined
          ? overrides[d.id]
          : d.value ?? d.default;
    return { ...d, value: v };
  });
}

/** Build override payload for engine (title → value). */
export function overridesFromDefs(defs: ScriptInputDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    out[d.title || d.id] = d.value ?? d.default;
  }
  return out;
}
