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
 * Pine **language intelligence** for AXIS CodeMirror (completions + hover).
 *
 * Strategy:
 * 1. Prefer **remote LSP** via pyne Pro API (`POST /lsp/completion`, `/lsp/hover`)
 *    when engine=`server` and Backend URL is set (local or VPS).
 * 2. Fall back to **local doc annotations** in the open buffer
 *    (`//@function`, `//@param`, `//@returns`, `//@type`, …) rendered as markdown.
 * 3. Fall back to **client metadata** from `data/pine-builtins.json` for
 *    pyodide / offline / remote failure.
 *
 * Exports {@link pineLspExtensions} for mounting on {@link PyneEditor}.
 * Indexes builtins by top-level name, module members (`ta.sma`), and full name
 * for hover tooltips.
 *
 * @module editor/pine-lsp
 */

import {
  autocompletion,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { hoverTooltip, keymap, type EditorView, type Tooltip } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import builtinsJson from './data/pine-builtins.json';
import {
  fetchRemoteCompletion,
  fetchRemoteHover,
  shouldUseRemoteLsp,
  type RemoteCompletionItem,
} from './pine-lsp-client';
import {
  formatPineDocMarkdown,
  lookupPineDoc,
  parsePineDocAnnotations,
} from './pine-doc-annotations';

/** One entry from the local Pine builtins catalog. */
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

/** Local (metadata) completion — always available offline. */
export function pineCompleteLocal(context: CompletionContext): CompletionResult | null {
  initIndex();
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const fullSource = context.state.doc.toString();

  // module.member after dot
  const dot = textBefore.match(/([A-Za-z_][\w]*)\.\s*([A-Za-z_][\w]*)?$/);
  if (dot) {
    const mod = dot[1]!;
    const memberPrefix = dot[2] || '';
    const members = BY_MODULE.get(mod);
    if (members?.length) {
      const from = context.pos - memberPrefix.length;
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
  if (prefix.includes('.') || prefix.length >= 2) {
    for (const [name, meta] of BY_NAME) {
      if (name.includes('.') && name.toLowerCase().startsWith(prefix.toLowerCase())) {
        if (!filtered.some((f) => f.label === meta.label && f.category === meta.category)) {
          filtered.push({ ...meta, label: name });
        }
      }
    }
  }

  // User-defined symbols with //@function etc. in this buffer
  const localDocs = parsePineDocAnnotations(fullSource);
  for (const [name, entry] of localDocs) {
    if (entry.kind === 'description') continue;
    if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    if (filtered.some((f) => f.label === name)) continue;
    filtered.unshift({
      label: name,
      kind: entry.kind === 'function' ? 'function' : entry.kind === 'type' ? 'type' : 'variable',
      detail: entry.signature || entry.kind,
      brief: entry.description.slice(0, 120),
      documentation: formatPineDocMarkdown(entry),
      snippet: entry.kind === 'function' ? `${name}(\${1})` : undefined,
      category: 'local',
    });
  }

  if (!filtered.length) return null;
  return {
    from: word ? word.from : context.pos,
    options: filtered.slice(0, 80).map((m, i) => toCompletion(m, 80 - Math.min(i, 30))),
    validFor: /^[\w.]*$/,
  };
}

function remoteItemToCompletion(item: RemoteCompletionItem, boost: number): Completion {
  const label = item.label;
  const insert = item.insertText || label;
  const base: Completion = {
    label,
    detail: item.detail ? `${item.detail} · lsp` : 'lsp',
    type: cmType(item.kind),
    info: item.documentation || item.detail || undefined,
    boost,
  };
  if (item.insertTextFormat === 'snippet' || insert.includes('${')) {
    return snippetCompletion(insert, base);
  }
  if (insert.endsWith('(') || insert.includes('(')) {
    return snippetCompletion(insert.includes('${') ? insert : `${label}(\${1})`, base);
  }
  return { ...base, apply: insert };
}

function completionFromPos(
  context: CompletionContext,
  options: Completion[],
): CompletionResult | null {
  if (!options.length) return null;
  const word = context.matchBefore(/[A-Za-z_][\w.]*/);
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const afterDot = /[A-Za-z_][\w]*\.\s*([A-Za-z_][\w]*)?$/.exec(textBefore);
  let from = context.pos;
  if (afterDot) {
    const member = afterDot[1] || '';
    from = context.pos - member.length;
  } else if (word) {
    from = word.from;
  }
  return { from, options, validFor: /^[\w.]*$/ };
}

/** Async completion: remote LSP first, then local metadata. */
export async function pineComplete(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  if (shouldUseRemoteLsp() && !context.aborted) {
    const line = context.state.doc.lineAt(context.pos);
    const source = context.state.doc.toString();
    const lineNo = line.number - 1; // CM is 1-based line.number
    const character = context.pos - line.from;
    // CompletionContext has .aborted + abort listeners, not AbortSignal
    const ac = new AbortController();
    const timeoutMs = 4_000;
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    context.addEventListener('abort', () => ac.abort());
    let remote: Awaited<ReturnType<typeof fetchRemoteCompletion>>;
    try {
      remote = await fetchRemoteCompletion({
        source,
        line: lineNo,
        character,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (remote?.length) {
      // After module prefix, server may return full "ta.sma" labels — strip for apply after dot
      const textBefore = line.text.slice(0, context.pos - line.from);
      const afterDot = /([A-Za-z_][\w]*)\.\s*([A-Za-z_][\w]*)?$/.exec(textBefore);
      const options = remote.slice(0, 80).map((item, i) => {
        let it = item;
        if (afterDot && item.label.startsWith(`${afterDot[1]}.`)) {
          const member = item.label.slice(afterDot[1]!.length + 1);
          it = {
            ...item,
            label: member,
            insertText: item.insertText?.startsWith(`${afterDot[1]}.`)
              ? item.insertText.slice(afterDot[1]!.length + 1)
              : member.includes('(')
                ? item.insertText
                : item.insertTextFormat === 'snippet'
                  ? item.insertText
                  : `${member}(\${1})`,
          };
        }
        return remoteItemToCompletion(it, 100 - Math.min(i, 40));
      });
      return completionFromPos(context, options);
    }
  }
  return pineCompleteLocal(context);
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

/** True when body looks like markdown (fences, bold, hr, lists). */
export function looksLikeMarkdown(s: string): boolean {
  return /```|\*\*[^*]+\*\*|^\s*---\s*$|^\s*#{1,3}\s|`[^`]+`/m.test(s);
}

/**
 * Peel a leading single-line ```signature``` fence (common LSP hover shape).
 * Multi-line fences stay in the body as examples.
 */
export function peelLeadingSignature(md: string): { signature: string | null; rest: string } {
  const m = md.match(/^```(?:[\w.-]+)?[ \t]*\r?\n([^\r\n]+)\r?\n```[ \t]*\r?\n?/);
  if (!m) return { signature: null, rest: md };
  return { signature: m[1]!.trim(), rest: md.slice(m[0].length) };
}

/** Append text with light inline markdown: `code` and **bold**. */
export function appendInlineMarkdown(parent: HTMLElement, text: string): void {
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    }
    const tok = m[1]!;
    if (tok.startsWith('**') && tok.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.className = 'cm-pine-hover-strong';
      strong.textContent = tok.slice(2, -2);
      parent.appendChild(strong);
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'cm-pine-hover-code-inline';
      code.textContent = tok.slice(1, -1);
      parent.appendChild(code);
    } else {
      parent.appendChild(document.createTextNode(tok));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

/**
 * Render a subset of markdown used by pyne LSP hovers into `root`.
 * Handles: fenced code, paragraphs, `---` rules, **bold**, inline `code`.
 * Does **not** run HTML — all content is textContent-based (XSS-safe).
 */
export function renderHoverMarkdown(root: HTMLElement, md: string): void {
  const src = md.replace(/\r\n/g, '\n').trim();
  if (!src) return;

  // Tokenize into blocks: fences vs prose
  const fenceRe = /```([\w.-]*)[ \t]*\n([\s\S]*?)```/g;
  type Block =
    | { kind: 'code'; lang: string; code: string }
    | { kind: 'prose'; text: string };
  const blocks: Block[] = [];
  let cursor = 0;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(src)) !== null) {
    if (fm.index > cursor) {
      blocks.push({ kind: 'prose', text: src.slice(cursor, fm.index) });
    }
    blocks.push({ kind: 'code', lang: fm[1] || '', code: fm[2]!.replace(/\n$/, '') });
    cursor = fm.index + fm[0].length;
  }
  if (cursor < src.length) {
    blocks.push({ kind: 'prose', text: src.slice(cursor) });
  }

  for (const block of blocks) {
    if (block.kind === 'code') {
      const pre = document.createElement('pre');
      pre.className = 'cm-pine-hover-pre';
      if (block.lang) pre.dataset.lang = block.lang;
      const code = document.createElement('code');
      code.className = 'cm-pine-hover-code-block';
      code.textContent = block.code;
      pre.appendChild(code);
      root.appendChild(pre);
      continue;
    }

    // Prose: split on blank lines / horizontal rules
    const chunks = block.text.split(/\n{2,}/);
    for (const chunk of chunks) {
      const lines = chunk.split('\n').map((l) => l.trimEnd());
      const nonEmpty = lines.filter((l) => l.trim().length > 0);
      if (!nonEmpty.length) continue;

      // Pure HR
      if (nonEmpty.every((l) => /^---+$/.test(l.trim()))) {
        const hr = document.createElement('hr');
        hr.className = 'cm-pine-hover-hr';
        root.appendChild(hr);
        continue;
      }

      // Leading HR line then text
      let start = 0;
      if (/^---+$/.test(nonEmpty[0]!.trim())) {
        const hr = document.createElement('hr');
        hr.className = 'cm-pine-hover-hr';
        root.appendChild(hr);
        start = 1;
      }
      const rest = nonEmpty.slice(start);
      if (!rest.length) continue;

      // Headings (# Title)
      if (/^#{1,3}\s+/.test(rest[0]!)) {
        const h = document.createElement('div');
        h.className = 'cm-pine-hover-heading';
        appendInlineMarkdown(h, rest[0]!.replace(/^#{1,3}\s+/, ''));
        root.appendChild(h);
        if (rest.length > 1) {
          const p = document.createElement('p');
          p.className = 'cm-pine-hover-p';
          appendInlineMarkdown(p, rest.slice(1).join(' '));
          root.appendChild(p);
        }
        continue;
      }

      // Bullet / numbered lists (library doc @param blocks, etc.)
      if (rest.every((l) => /^([-*+]|\d+\.)\s+/.test(l.trim()))) {
        const ul = document.createElement('ul');
        ul.className = 'cm-pine-hover-list';
        for (const l of rest) {
          const li = document.createElement('li');
          li.className = 'cm-pine-hover-li';
          appendInlineMarkdown(li, l.trim().replace(/^([-*+]|\d+\.)\s+/, ''));
          ul.appendChild(li);
        }
        root.appendChild(ul);
        continue;
      }

      const p = document.createElement('p');
      p.className = 'cm-pine-hover-p';
      // Soft-wrap single newlines inside a paragraph as spaces
      appendInlineMarkdown(p, rest.join(' ').replace(/[ \t]+/g, ' ').trim());
      root.appendChild(p);
    }
  }
}

function makeHoverTooltip(
  from: number,
  to: number,
  title: string,
  body: string,
  badge?: string,
  opts?: { markdown?: boolean },
): Tooltip {
  const asMarkdown = opts?.markdown ?? looksLikeMarkdown(body);
  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-pine-hover';

      if (badge) {
        const b = document.createElement('div');
        b.className = 'cm-pine-hover-badge';
        b.textContent = badge;
        dom.appendChild(b);
      }

      let signature: string | null = null;
      let bodyMd = body;
      if (asMarkdown) {
        const peeled = peelLeadingSignature(body);
        signature = peeled.signature;
        bodyMd = peeled.rest;
      }

      // Prefer LSP signature fence; fall back to symbol title
      const headerText = signature || title;
      if (headerText) {
        const t = document.createElement('div');
        t.className = signature ? 'cm-pine-hover-sig' : 'cm-pine-hover-title';
        t.textContent = headerText;
        dom.appendChild(t);
      }

      if (bodyMd.trim()) {
        const content = document.createElement('div');
        content.className = 'cm-pine-hover-body';
        if (asMarkdown) {
          renderHoverMarkdown(content, bodyMd);
        } else {
          // Plain docs: preserve paragraph breaks
          for (const para of bodyMd.split(/\n{2,}/)) {
            const text = para.trim();
            if (!text) continue;
            const p = document.createElement('p');
            p.className = 'cm-pine-hover-p';
            p.textContent = text;
            content.appendChild(p);
          }
        }
        if (content.childNodes.length) dom.appendChild(content);
      }

      return { dom };
    },
  };
}

export function pineHoverLocal(
  view: { state: { doc: { sliceString: (a: number, b: number) => string; length: number } } },
  pos: number,
): Tooltip | null {
  initIndex();
  const doc = view.state.doc;
  const text = doc.sliceString(0, doc.length);
  const hit = wordAt(text, pos);
  if (!hit) return null;

  // User / library annotations in the open document (//@function, //@param, …)
  const localDoc = lookupPineDoc(text, hit.word);
  if (localDoc && localDoc.kind !== 'description') {
    const md = formatPineDocMarkdown(localDoc);
    if (md) {
      return makeHoverTooltip(
        hit.from,
        hit.to,
        localDoc.signature || localDoc.name,
        md,
        'doc annotations',
        { markdown: true },
      );
    }
  }

  let meta = lookupBuiltin(hit.word);
  if (!meta && hit.word.includes('.')) {
    meta = lookupBuiltin(hit.word.split('.').pop() || '');
  }
  if (!meta) return null;

  return makeHoverTooltip(hit.from, hit.to, meta.label, hoverDocs(meta), 'local metadata');
}

/** Async hover: remote LSP markdown first, then local. */
export async function pineHover(view: EditorView, pos: number): Promise<Tooltip | null> {
  const doc = view.state.doc;
  const text = doc.toString();
  const hit = wordAt(text, pos);
  if (!hit) return null;

  if (shouldUseRemoteLsp()) {
    const line = doc.lineAt(pos);
    const remote = await fetchRemoteHover({
      source: text,
      line: line.number - 1,
      character: pos - line.from,
    });
    if (remote?.contents) {
      const from = remote.range
        ? doc.line(remote.range.start.line + 1).from + remote.range.start.character
        : hit.from;
      const to = remote.range
        ? doc.line(remote.range.end.line + 1).from + remote.range.end.character
        : hit.to;
      return makeHoverTooltip(
        Math.max(0, from),
        Math.min(doc.length, to),
        hit.word,
        remote.contents,
        'pyne lsp',
        { markdown: true },
      );
    }
  }
  return pineHoverLocal(view, pos);
}

/** CodeMirror extensions: autocomplete + hover (remote LSP + local fallback). */
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
    hoverTooltip((view, pos) => pineHover(view, pos), { hideOnChange: true }),
  ];
}

/** Test helper — count indexed builtins. */
export function pineBuiltinCount(): number {
  initIndex();
  return BY_NAME.size;
}
