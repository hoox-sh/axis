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
 * @module editor/pyne-doc-annotations
 */

/** Kind of documented declaration. */
export type PyneDocKind = 'function' | 'type' | 'enum' | 'variable' | 'description' | 'field';

/** One documented symbol extracted from annotation + declaration. */
export interface PyneDocEntry {
  kind: PyneDocKind;
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
const FUNC_DECL = /^(?:export\s+)?(?:method\s+)?([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*=>/;

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

/**
 * Join an annotation tag's first-line payload with its continuation lines.
 *
 * PYNE renders annotation bodies as **verbatim Markdown**: headings, lists,
 * code fences, blockquotes, tables and two-space line breaks must survive.
 * Do not soft-wrap single newlines into spaces (that destroyed fences and
 * headings in the old card). Only trailing blank lines are trimmed, matching
 * PYNE's `"\n".join(...).rstrip("\n")`.
 */
function joinTagText(payload: string, cont: string[]): string {
  const lines: string[] = [];
  // Keep the payload verbatim (trailing two spaces = Markdown line break).
  if (payload.length > 0) lines.push(payload);
  for (const c of cont) lines.push(c);
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n');
}

function parseParamPayload(payload: string): { name: string; description: string } | null {
  // Keep the description verbatim (trailing two spaces = Markdown line break).
  const m = payload.match(/^([A-Za-z_][\w]*)(?:[ \t]+(.*))?$/s);
  if (!m) return null;
  return { name: m[1]!, description: m[2] || '' };
}

/**
 * Collect contiguous `//` annotation lines ending just before `endLine`
 * (0-based exclusive end = declaration line). Returns raw tags in order.
 * Blank source lines break the block (TV: no blank lines between cont lines).
 */
function collectAnnotationBlock(lines: string[], endLine: number): RawTag[] {
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
  kindHint?: PyneDocKind;
  description: string;
  params: Array<{ name: string; description: string }>;
  returns?: string;
  fields: Array<{ name: string; description: string }>;
} {
  let kindHint: PyneDocKind | undefined;
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
export function parsePyneDocAnnotations(source: string): Map<string, PyneDocEntry> {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const byName = new Map<string, PyneDocEntry>();

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
    let kind: PyneDocKind = partial.kindHint ?? 'function';
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
        } else if (
          partial.kindHint === 'description' ||
          tags.some((t) => t.tag === 'description')
        ) {
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

/** Markdown bullet list of `name`/description pairs (PYNE card shape). */
function formatNamedList(
  title: string,
  items: Array<{ name: string; description: string }>,
): string {
  const lines = [`**${title}:**`, ''];
  for (const it of items) {
    lines.push(it.description ? `- \`${it.name}\`: ${it.description}` : `- \`${it.name}\``);
  }
  return lines.join('\n');
}

/**
 * Format a doc entry as markdown for {@link renderHoverMarkdown}.
 *
 * Mirrors PYNE's library-annotation card: fenced signature, the description
 * rendered **verbatim as Markdown**, then `**Fields:**`, `**Parameters:**`
 * and `**Returns:**` sections. Bodies keep headings, lists, code fences,
 * blockquotes, tables, links and two-space line breaks.
 */
export function formatPyneDocMarkdown(entry: PyneDocEntry): string {
  const parts: string[] = [];

  if (entry.signature) {
    parts.push('```pinescript\n' + entry.signature + '\n```');
  }

  if (entry.description) {
    parts.push(entry.description);
  }

  if (entry.fields.length) {
    parts.push(formatNamedList('Fields', entry.fields));
  }

  if (entry.params.length) {
    parts.push(formatNamedList('Parameters', entry.params));
  }

  if (entry.returns) {
    parts.push(`**Returns:** ${entry.returns}`);
  }

  if (parts.length === (entry.signature ? 1 : 0)) {
    parts.push(`User-defined ${entry.kind}.`);
  }

  return parts.filter(Boolean).join('\n\n').trim();
}

/**
 * Look up documentation for a symbol name in `source`.
 * Tries exact name, then bare member after `.`.
 */
export function lookupPyneDoc(source: string, name: string): PyneDocEntry | null {
  if (!name) return null;
  const map = parsePyneDocAnnotations(source);
  if (map.has(name)) return map.get(name)!;
  if (name.includes('.')) {
    const bare = name.split('.').pop()!;
    if (map.has(bare)) return map.get(bare)!;
  }
  return null;
}
