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
 * Parse Pine Script™ library / doc compiler annotations from source and
 * format them as markdown for CodeMirror hover tooltips.
 *
 * Supported tags (TradingView-compatible):
 * - `//@description` — library script description
 * - `//@function` / `//@param` / `//@returns` — functions & methods
 * - `//@type` / `//@field` — user-defined types
 * - `//@enum` / `//@field` — enums
 * - `//@variable` — variables
 *
 * Multi-line annotations: consecutive `//` comment lines continue the current
 * tag. An empty `//` line inserts a blank paragraph (same as the Pine Editor).
 * Spaces after `//` before `@` are allowed (`// @function`).
 *
 * @module editor/pine-doc-annotations
 */

/** Kind of documented declaration. */
export type PineDocKind =
  | 'function'
  | 'type'
  | 'enum'
  | 'variable'
  | 'description'
  | 'field';

/** One documented symbol extracted from annotation + declaration. */
export interface PineDocEntry {
  kind: PineDocKind;
  /** Identifier (function name, type name, variable name, …). */
  name: string;
  /** Optional signature line from the declaration (functions). */
  signature?: string;
  /** Main description (`@function` / `@type` / `@enum` / `@variable` / `@description`). */
  description: string;
  /** Parameter name → description (`@param`). */
  params: Array<{ name: string; description: string }>;
  /** Return description (`@returns`). */
  returns?: string;
  /** Field name → description (`@field`). */
  fields: Array<{ name: string; description: string }>;
  /** 0-based line of the declaration (or description header for library). */
  line: number;
}

const COMMENT_LINE = /^\/\/(.*)$/;

/** Function / method header: optional export/method, name, params, => */
const FUNC_DECL =
  /^(?:export\s+)?(?:method\s+)?([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*=>/;

const TYPE_DECL = /^(?:export\s+)?type\s+([A-Za-z_][\w]*)\b/;
const ENUM_DECL = /^(?:export\s+)?enum\s+([A-Za-z_][\w]*)\b/;

/** Variable declaration heuristics (typed or bare assign). */
const VAR_DECL =
  /^(?:(?:var|varip)\s+)?(?:(?:simple|series|const)\s+)?(?:(?:int|float|bool|string|color|label|line|box|table|array|matrix|map|polyline|chart\.point)\s+)?([A-Za-z_][\w]*)\s*(?::[^=]+)?=/;

type RawTag = {
  tag: string;
  /** First-line payload after the tag (may include param/field name). */
  payload: string;
  /** Continuation lines (including empty for paragraph breaks). */
  cont: string[];
};

function joinTagText(payload: string, cont: string[]): string {
  const parts: string[] = [];
  if (payload.trim()) parts.push(payload.trimEnd());
  for (const c of cont) {
    if (c.trim() === '') {
      parts.push('');
    } else {
      parts.push(c.trimEnd());
    }
  }
  // Join single newlines as soft wrap (space); blank lines stay as \n\n
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      out.push(buf.join(' ').replace(/[ \t]+/g, ' ').trim());
      buf = [];
    }
  };
  for (const p of parts) {
    if (p === '') {
      flush();
      out.push('');
    } else {
      buf.push(p);
    }
  }
  flush();
  // Collapse multiple empties, join paragraphs with \n\n
  const paras = out.filter((p, i, a) => p !== '' || (i > 0 && a[i - 1] !== ''));
  return paras.join('\n\n').trim();
}

function parseParamPayload(payload: string): { name: string; description: string } | null {
  const m = payload.match(/^([A-Za-z_][\w]*)\s*(.*)$/s);
  if (!m) return null;
  return { name: m[1]!, description: (m[2] || '').trim() };
}

/**
 * Collect contiguous `//` annotation lines ending just before `endLine`
 * (0-based exclusive end = declaration line). Returns raw tags in order.
 * Blank source lines break the block (TV: no blank lines between cont lines).
 */
function collectAnnotationBlock(
  lines: string[],
  endLine: number,
): RawTag[] {
  // Walk upward over pure // comment lines only
  let start = endLine;
  while (start > 0) {
    const prev = lines[start - 1] ?? '';
    if (prev.trim() === '') break;
    if (!COMMENT_LINE.test(prev)) break;
    start--;
  }

  const block: string[] = [];
  for (let i = start; i < endLine; i++) {
    const raw = lines[i] ?? '';
    const cm = raw.match(COMMENT_LINE);
    if (!cm) break;
    block.push(cm[1] ?? '');
  }
  if (!block.length) return [];

  // Must contain at least one @tag
  const hasTag = block.some((b) => /^\s*@\w+/.test(b));
  if (!hasTag) return [];

  const tags: RawTag[] = [];
  let current: RawTag | null = null;

  for (const body of block) {
    // body is text after //
    const tagged = body.match(
      /^\s*@(function|param|returns|description|type|enum|field|variable|strategy_alert_message)\b\s*(.*)$/i,
    );
    if (tagged) {
      current = {
        tag: tagged[1]!.toLowerCase(),
        payload: tagged[2] ?? '',
        cont: [],
      };
      tags.push(current);
      continue;
    }
    // Continuation of previous tag
    if (current) {
      const cont = body.replace(/^\s?/, '');
      current.cont.push(cont);
    }
  }
  return tags;
}

function tagsToPartial(tags: RawTag[]): {
  kindHint?: PineDocKind;
  description: string;
  params: Array<{ name: string; description: string }>;
  returns?: string;
  fields: Array<{ name: string; description: string }>;
} {
  let kindHint: PineDocKind | undefined;
  let description = '';
  const params: Array<{ name: string; description: string }> = [];
  let returns: string | undefined;
  const fields: Array<{ name: string; description: string }> = [];
  // Later @function/@returns win; first @param for a name wins (TV rules)
  const seenParams = new Set<string>();

  for (const t of tags) {
    const text = joinTagText(t.payload, t.cont);
    switch (t.tag) {
      case 'function':
        kindHint = 'function';
        description = text;
        break;
      case 'type':
        kindHint = 'type';
        description = text;
        break;
      case 'enum':
        kindHint = 'enum';
        description = text;
        break;
      case 'variable':
        kindHint = 'variable';
        description = text;
        break;
      case 'description':
        kindHint = kindHint ?? 'description';
        description = text;
        break;
      case 'param': {
        const p = parseParamPayload(t.payload);
        if (!p) break;
        const desc = joinTagText(p.description, t.cont);
        if (seenParams.has(p.name)) break;
        seenParams.add(p.name);
        params.push({ name: p.name, description: desc });
        break;
      }
      case 'returns':
        returns = text;
        break;
      case 'field': {
        const f = parseParamPayload(t.payload);
        if (!f) break;
        fields.push({ name: f.name, description: joinTagText(f.description, t.cont) });
        break;
      }
      default:
        break;
    }
  }
  return { kindHint, description, params, returns, fields };
}

/**
 * Parse all documented symbols from Pine source.
 * Returns a map keyed by identifier (last declaration wins for duplicates).
 */
export function parsePineDocAnnotations(source: string): Map<string, PineDocEntry> {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const byName = new Map<string, PineDocEntry>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    const tags = collectAnnotationBlock(lines, i);
    if (!tags.length) continue;

    const partial = tagsToPartial(tags);
    if (
      !partial.description &&
      !partial.params.length &&
      !partial.returns &&
      !partial.fields.length
    ) {
      continue;
    }

    let name: string | null = null;
    let kind: PineDocKind = partial.kindHint ?? 'function';
    let signature: string | undefined;

    const func = trimmed.match(FUNC_DECL);
    if (func) {
      name = func[1]!;
      kind = 'function';
      signature = trimmed.replace(/\s*=>\s*$/, '').trim();
    } else {
      const ty = trimmed.match(TYPE_DECL);
      if (ty) {
        name = ty[1]!;
        kind = 'type';
      } else {
        const en = trimmed.match(ENUM_DECL);
        if (en) {
          name = en[1]!;
          kind = 'enum';
        } else if (partial.kindHint === 'variable' || tags.some((t) => t.tag === 'variable')) {
          const v = trimmed.match(VAR_DECL);
          if (v) {
            name = v[1]!;
            kind = 'variable';
          }
        } else if (partial.kindHint === 'description' || tags.some((t) => t.tag === 'description')) {
          // Library-level //@description — no declaration name; use synthetic key
          name = '__library_description__';
          kind = 'description';
        }
      }
    }

    if (!name) continue;

    byName.set(name, {
      kind,
      name,
      signature,
      description: partial.description,
      params: partial.params,
      returns: partial.returns,
      fields: partial.fields,
      line: i,
    });
  }

  return byName;
}

/**
 * Format a doc entry as markdown for {@link renderHoverMarkdown}.
 * Shape mirrors common LSP / Pine Editor hovers.
 */
export function formatPineDocMarkdown(entry: PineDocEntry): string {
  const parts: string[] = [];

  if (entry.signature) {
    parts.push('```pinescript\n' + entry.signature + '\n```');
  }

  if (entry.description) {
    parts.push(entry.description);
  }

  if (entry.params.length) {
    parts.push('---');
    parts.push('**Parameters**');
    for (const p of entry.params) {
      const d = p.description ? ` — ${p.description}` : '';
      parts.push(`- \`${p.name}\`${d}`);
    }
  }

  if (entry.fields.length) {
    parts.push('---');
    parts.push('**Fields**');
    for (const f of entry.fields) {
      const d = f.description ? ` — ${f.description}` : '';
      parts.push(`- \`${f.name}\`${d}`);
    }
  }

  if (entry.returns) {
    parts.push('---');
    parts.push('**Returns**');
    parts.push(entry.returns);
  }

  return parts.filter(Boolean).join('\n\n').trim();
}

/**
 * Look up documentation for a symbol name in `source`.
 * Tries exact name, then bare member after `.`.
 */
export function lookupPineDoc(
  source: string,
  name: string,
): PineDocEntry | null {
  if (!name) return null;
  const map = parsePineDocAnnotations(source);
  if (map.has(name)) return map.get(name)!;
  if (name.includes('.')) {
    const bare = name.split('.').pop()!;
    if (map.has(bare)) return map.get(bare)!;
  }
  return null;
}
