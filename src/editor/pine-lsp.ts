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
 * Client-side Pine “LSP-lite” for AXIS CodeMirror:
 * - completion (builtins + modules like ta. / math.)
 * - hover documentation
 *
 * Data is synced from pyne’s langserver builtin_metadata.json
 * (./scripts/sync-pine-builtins.sh). Not a full language server process —
 * works offline in the browser.
 */

import {
  autocompletion,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { hoverTooltip, keymap, type Tooltip } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import builtinsJson from './data/pine-builtins.json';

export type BuiltinMeta = {
  label: string;
  kind?: string;
  detail?: string;
  brief?: string;
  documentation?: string;
  snippet?: string;
  category?: string;
};

const BUILTINS = builtinsJson as Record<string, BuiltinMeta>;

/** Top-level names (no dots) + module prefixes. */
const TOP_LEVEL: BuiltinMeta[] = [];
/** module → member metas (label without module prefix for insert after `.`) */
const BY_MODULE = new Map<string, BuiltinMeta[]>();
/** full name → meta for hover */
const BY_NAME = new Map<string, BuiltinMeta>();

function initIndex() {
  if (BY_NAME.size) return;
  const modules = new Set<string>();
  for (const [name, meta] of Object.entries(BUILTINS)) {
    const m = { ...meta, label: meta.label || name };
    BY_NAME.set(name, m);
    if (name.includes('.')) {
      const [mod, ...rest] = name.split('.');
      const member = rest.join('.');
      modules.add(mod);
      const list = BY_MODULE.get(mod) || [];
      list.push({
        ...m,
        label: member,
        // insert only the member after `mod.`
        snippet: m.snippet?.startsWith(`${mod}.`)
          ? m.snippet.slice(mod.length + 1)
          : member.includes('(')
            ? undefined
            : m.snippet?.includes('(')
              ? m.snippet.replace(/^[\w.]+\(/, `${member}(`)
              : `${member}(\${1})`,
      });
      BY_MODULE.set(mod, list);
    } else {
      TOP_LEVEL.push(m);
    }
  }
  // Module name completions (ta, math, …)
  for (const mod of modules) {
    if (!BY_NAME.has(mod)) {
      const modMeta: BuiltinMeta = {
        label: mod,
        kind: 'module',
        detail: `${mod}.*`,
        brief: `Pine module \`${mod}\``,
        documentation: `Built-in module \`${mod}\`. Type \`${mod}.\` for members.`,
        category: 'module',
      };
      TOP_LEVEL.push(modMeta);
      BY_NAME.set(mod, modMeta);
    }
  }
  TOP_LEVEL.sort((a, b) => a.label.localeCompare(b.label));
  for (const [, list] of BY_MODULE) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
}

function cmType(kind?: string): string {
  switch ((kind || '').toLowerCase()) {
    case 'function':
      return 'function';
    case 'variable':
    case 'constant':
      return 'variable';
    case 'keyword':
      return 'keyword';
    case 'type':
      return 'type';
    case 'module':
      return 'namespace';
    default:
      return 'function';
  }
}

function toCompletion(meta: BuiltinMeta, boost = 0): Completion {
  const label = meta.label;
  const info = meta.documentation || meta.brief || meta.detail || '';
  const base: Completion = {
    label,
    detail: meta.detail || meta.category || undefined,
    type: cmType(meta.kind),
    info: info || undefined,
    boost,
  };
  if (meta.snippet && meta.snippet.includes('${')) {
    return snippetCompletion(meta.snippet, base);
  }
  if (meta.kind === 'function' || (meta.snippet && meta.snippet.includes('('))) {
    const snip = meta.snippet && meta.snippet.includes('${')
      ? meta.snippet
      : `${label}(\${1})`;
    return snippetCompletion(snip, base);
  }
  return base;
}

function filterByPrefix(items: BuiltinMeta[], prefix: string, limit = 80): BuiltinMeta[] {
  const p = prefix.toLowerCase();
  if (!p) return items.slice(0, limit);
  const starts: BuiltinMeta[] = [];
  const includes: BuiltinMeta[] = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    if (l.startsWith(p)) starts.push(it);
    else if (l.includes(p)) includes.push(it);
  }
  return [...starts, ...includes].slice(0, limit);
}

/** Word / qualified name under cursor for hover. */
export function wordAt(
  text: string,
  pos: number,
): { word: string; from: number; to: number } | null {
  if (pos < 0 || pos > text.length) return null;
  const isId = (ch: string) => /[A-Za-z0-9_.]/.test(ch);
  let from = pos;
  let to = pos;
  while (from > 0 && isId(text[from - 1]!)) from--;
  while (to < text.length && isId(text[to]!)) to++;
  if (from === to) return null;
  // trim trailing dots
  let word = text.slice(from, to);
  while (word.endsWith('.')) {
    word = word.slice(0, -1);
    to--;
  }
  while (word.startsWith('.')) {
    word = word.slice(1);
    from++;
  }
  if (!word) return null;
  return { word, from, to };
}

export function lookupBuiltin(name: string): BuiltinMeta | undefined {
  initIndex();
  if (BY_NAME.has(name)) return BY_NAME.get(name);
  // bare member → try common modules
  if (!name.includes('.')) {
    for (const mod of ['ta', 'math', 'str', 'array', 'matrix', 'map', 'input', 'strategy', 'request', 'ticker', 'timeframe', 'barstate', 'syminfo', 'session', 'color', 'line', 'label', 'box', 'table', 'polyline', 'chart']) {
      const full = `${mod}.${name}`;
      if (BY_NAME.has(full)) return BY_NAME.get(full);
    }
  }
  return undefined;
}

export function pineComplete(context: CompletionContext): CompletionResult | null {
  initIndex();
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  // module.member after dot
  const dot = textBefore.match(/([A-Za-z_][\w]*)\.\s*([A-Za-z_][\w]*)?$/);
  if (dot) {
    const mod = dot[1]!;
    const memberPrefix = dot[2] || '';
    const members = BY_MODULE.get(mod);
    if (members?.length) {
      const from =
        context.pos - memberPrefix.length;
      const filtered = filterByPrefix(members, memberPrefix);
      if (!filtered.length && !context.explicit) return null;
      return {
        from,
        options: filtered.map((m, i) => toCompletion(m, 99 - Math.min(i, 20))),
        validFor: /^[\w]*$/,
      };
    }
  }

  // top-level / bare word
  const word = context.matchBefore(/[A-Za-z_][\w]*/);
  if (!word && !context.explicit) return null;
  const prefix = word?.text || '';
  if (prefix.length < 1 && !context.explicit) return null;

  const filtered = filterByPrefix(TOP_LEVEL, prefix);
  // also offer full dotted names that start with prefix (ta.sm…)
  if (prefix.includes('.') || prefix.length >= 2) {
    for (const [name, meta] of BY_NAME) {
      if (name.includes('.') && name.toLowerCase().startsWith(prefix.toLowerCase())) {
        if (!filtered.some((f) => f.label === meta.label && f.category === meta.category)) {
          filtered.push({ ...meta, label: name });
        }
      }
    }
  }

  if (!filtered.length) return null;
  return {
    from: word ? word.from : context.pos,
    options: filtered.slice(0, 80).map((m, i) => toCompletion(m, 80 - Math.min(i, 30))),
    validFor: /^[\w.]*$/,
  };
}

function hoverDocs(meta: BuiltinMeta): string {
  const parts: string[] = [];
  if (meta.detail) parts.push(meta.detail);
  if (meta.brief) parts.push(meta.brief);
  if (meta.documentation && meta.documentation !== meta.brief) {
    parts.push(meta.documentation);
  }
  if (meta.category) parts.push(`[${meta.category}]`);
  return parts.filter(Boolean).join('\n\n') || meta.label;
}

export function pineHover(view: { state: { doc: { sliceString: (a: number, b: number) => string; length: number } } }, pos: number): Tooltip | null {
  initIndex();
  const doc = view.state.doc;
  const text = doc.sliceString(0, doc.length);
  const hit = wordAt(text, pos);
  if (!hit) return null;

  // Prefer longest qualified name: ta.sma
  let meta = lookupBuiltin(hit.word);
  if (!meta && hit.word.includes('.')) {
    meta = lookupBuiltin(hit.word.split('.').pop() || '');
  }
  if (!meta) return null;

  const body = hoverDocs(meta);
  return {
    pos: hit.from,
    end: hit.to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-pine-hover';
      dom.style.cssText =
        'padding:8px 10px;max-width:360px;font-size:12px;line-height:1.45;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;';
      const title = document.createElement('div');
      title.style.cssText = 'color:#939fff;font-weight:600;margin-bottom:4px;';
      title.textContent = meta!.label + (meta!.detail ? '' : '');
      dom.appendChild(title);
      if (meta!.detail) {
        const d = document.createElement('div');
        d.style.cssText = 'color:#a7b4ff;margin-bottom:6px;';
        d.textContent = meta!.detail;
        dom.appendChild(d);
      }
      const p = document.createElement('div');
      p.style.cssText = 'color:#c8cad4;';
      p.textContent = body;
      dom.appendChild(p);
      return { dom };
    },
  };
}

/** CodeMirror extensions: autocomplete + hover. */
export function pineLspExtensions(): Extension[] {
  initIndex();
  return [
    autocompletion({
      override: [pineComplete],
      activateOnTyping: true,
      maxRenderedOptions: 64,
      defaultKeymap: true,
      icons: true,
    }),
    keymap.of(completionKeymap),
    hoverTooltip(
      (view, pos) => pineHover(view as never, pos),
      { hideOnChange: true },
    ),
  ];
}

/** Test helper — count indexed builtins. */
export function pineBuiltinCount(): number {
  initIndex();
  return BY_NAME.size;
}
