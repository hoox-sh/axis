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
 * Strategy (local-first so a dead Backend URL never blocks UI):
 * 1. **Local doc annotations** in the open buffer (`//@function`, `//@param`, …).
 * 2. **Client metadata** from `data/pyne-builtins.json` (always available).
 * 3. Optional **remote LSP** via pyne Pro API (`POST /lsp/completion`, `/lsp/hover`)
 *    when engine is server/worker, Backend URL is set, and not in failure cooldown.
 *
 * Triggers: typing (`activateOnTyping`), **⌘/Ctrl-Space** (`startCompletion`),
 * and **`,`** inside a call (remaining named parameters).
 *
 * Hover shows parameter lists + examples. A signature-hint tooltip lists
 * every parameter and marks used vs unused vs current.
 *
 * Exports {@link pyneLspExtensions} for mounting on {@link PyneEditor}.
 * Indexes builtins by top-level name, module members (`ta.sma`), and full name
 * for hover tooltips.
 *
 * @module editor/pyne-lsp
 */

import {
  autocompletion,
  completionKeymap,
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { hoverTooltip, keymap, showTooltip, type EditorView, type Tooltip } from '@codemirror/view';
import { Extension, StateField, type EditorState } from '@codemirror/state';
import builtinsJson from './data/pyne-builtins.json';
import { store } from '../store';
import {
  DEFAULT_EDITOR_INTEL,
  readEditorIntel,
  type EditorIntelSettings,
} from './editor-intel';
import {
  fetchRemoteCompletion,
  fetchRemoteHover,
  shouldUseRemoteLsp,
  type RemoteCompletionItem,
} from './pyne-lsp-client';
import {
  formatPyneDocMarkdown,
  lookupPyneDoc,
  parsePyneDocAnnotations,
} from './pyne-doc-annotations';
import {
  namedArgEnumContext,
  pathMatchesEnumPrefixes,
  pineEnumMetas,
  styleNamespaceForCall,
  type PineEnumMeta,
} from './pine-enums';
import {
  classifyParams,
  findCallSite,
  formatCallHoverMarkdown,
  formatParamHoverMarkdown,
  paramCompletions,
  resolveCallSignature,
  type PineCallSig,
} from './pine-call-params';
import {
  declarationTypeFact,
  dottedSegmentAt,
  enclosingStringAt,
  formatColorLiteralMarkdown,
  formatHoverFactMarkdown,
  formatUserSymbolMarkdown,
  hexColorAt,
  inPineLineComment,
  isHexColorToken,
  isNumericLiteral,
  lookupHoverFact,
  lookupUserSymbol,
  userSymbolBadge,
} from './pine-hover-facts';

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

/** @deprecated Use pine-enums catalog — kept as alias for tests. */
export const COMPLETION_STYLE_ENUMS: readonly PineEnumMeta[] = pineEnumMetas().filter((e) =>
  /\.style_/.test(e.path),
);

/** Top-level names (no dots) + module prefixes. */
const TOP_LEVEL: BuiltinMeta[] = [];
/** module → member metas (label without module prefix for insert after `.`) */
const BY_MODULE = new Map<string, BuiltinMeta[]>();
/** full name → meta for hover */
const BY_NAME = new Map<string, BuiltinMeta>();
/** All injected enum full-path metas (label = full path). */
const ENUM_FULL: BuiltinMeta[] = [];
/** Named color constants under color.* (no function parens). */
const COLOR_CONSTANTS: BuiltinMeta[] = [];

/** Color names that are values, not functions. */
const COLOR_VALUE_RE =
  /^(aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|white|yellow)$/i;

/** `color.new` / `color.rgb` / `color.from_gradient` — usual `color=` values. */
const COLOR_CTOR_MEMBERS = new Set(['new', 'rgb', 'from_gradient']);
const COLOR_CTOR_PATHS = ['color.new', 'color.rgb', 'color.from_gradient'] as const;

function isColorCtorLabel(label: string): boolean {
  return COLOR_CTOR_MEMBERS.has(label) || (COLOR_CTOR_PATHS as readonly string[]).includes(label);
}

function isColorNamedArg(arg: string): boolean {
  return arg === 'color' || arg === 'bgcolor' || arg === 'textcolor' || arg === 'border_color';
}

function isColorConstantName(member: string): boolean {
  return COLOR_VALUE_RE.test(member);
}

function injectEnumPath(name: string, meta: BuiltinMeta, modules: Set<string>) {
  // Prefer richer enum meta when builtins already listed a path as a function
  const existing = BY_NAME.get(name);
  if (existing && existing.category === 'enum') return;
  const full: BuiltinMeta = {
    ...meta,
    label: name,
    kind: 'constant',
    snippet: undefined,
    category: meta.category || 'enum',
  };
  BY_NAME.set(name, full);
  ENUM_FULL.push(full);
  if (!name.includes('.')) {
    if (!TOP_LEVEL.some((t) => t.label === name)) TOP_LEVEL.push(full);
    return;
  }
  const [mod, ...rest] = name.split('.');
  const member = rest.join('.');
  modules.add(mod);
  const list = BY_MODULE.get(mod) || [];
  // Replace prior member entry (e.g. color.red wrongly catalogued as function)
  const without = list.filter((m) => m.label !== member);
  without.push({
    ...full,
    label: member,
    kind: 'constant',
    snippet: undefined,
  });
  BY_MODULE.set(mod, without);
}

function initIndex() {
  if (BY_NAME.size) return;
  const modules = new Set<string>();
  for (const [name, meta] of Object.entries(BUILTINS)) {
    // Color value constants: force constant kind (catalog marks them as functions)
    const isColorVal =
      name.startsWith('color.') && isColorConstantName(name.slice('color.'.length));
    const m: BuiltinMeta = isColorVal
      ? {
          ...meta,
          label: meta.label || name,
          kind: 'constant',
          snippet: undefined,
          detail: meta.detail?.includes('(') ? 'color constant' : meta.detail,
          category: 'enum',
        }
      : { ...meta, label: meta.label || name };
    BY_NAME.set(name, m);
    if (name.includes('.')) {
      const [mod, ...rest] = name.split('.');
      const member = rest.join('.');
      modules.add(mod);
      const list = BY_MODULE.get(mod) || [];
      const memberMeta: BuiltinMeta = {
        ...m,
        label: member,
        snippet: isColorVal
          ? undefined
          : m.snippet?.startsWith(`${mod}.`)
            ? m.snippet.slice(mod.length + 1)
            : member.includes('(')
              ? undefined
              : m.snippet?.includes('(')
                ? m.snippet.replace(/^[\w.]+\(/, `${member}(`)
                : m.kind === 'constant' || m.kind === 'variable'
                  ? undefined
                  : `${member}(\${1})`,
      };
      list.push(memberMeta);
      BY_MODULE.set(mod, list);
      if (isColorVal) COLOR_CONSTANTS.push({ ...m, label: name });
    } else {
      TOP_LEVEL.push(m);
    }
  }
  // Full Pine enum catalog (plot.style_*, shape.*, size.*, strategy.*, …)
  for (const e of pineEnumMetas()) {
    injectEnumPath(
      e.path,
      {
        label: e.path,
        kind: 'constant',
        detail: e.detail,
        brief: e.brief,
        documentation: `\`${e.path}\` — ${e.brief}`,
        category: 'enum',
      },
      modules,
    );
  }
  // Module name completions (ta, math, plot, …)
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
  ENUM_FULL.sort((a, b) => a.label.localeCompare(b.label));
  COLOR_CONSTANTS.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Detect `style=` value position and which call namespace to suggest.
 * Accepts multi-line `textBefore` (from doc start or a window through cursor).
 * @deprecated Prefer {@link namedArgEnumContext} — kept for tests / call sites.
 */
export function styleArgContext(
  textBefore: string,
): { namespace: string; prefix: string; fromOffset: number } | null {
  const ctx = namedArgEnumContext(textBefore);
  if (!ctx || ctx.arg !== 'style') return null;
  return {
    namespace: styleNamespaceForCall(ctx.call),
    prefix: ctx.prefix,
    fromOffset: ctx.fromOffset,
  };
}

/** Style enum paths for a call namespace (plot → plot.style_*). */
export function styleEnumsForNamespace(namespace: string): BuiltinMeta[] {
  initIndex();
  return enumsMatchingPrefixes([`${namespace}.style_`]);
}

/** Enums whose full path matches any prefix (or exact path). */
export function enumsMatchingPrefixes(prefixes: string[]): BuiltinMeta[] {
  initIndex();
  const out: BuiltinMeta[] = [];
  const seen = new Set<string>();
  // Prefer injected enums first
  for (const m of ENUM_FULL) {
    if (!pathMatchesEnumPrefixes(m.label, prefixes)) continue;
    if (seen.has(m.label)) continue;
    seen.add(m.label);
    out.push(m);
  }
  // color.* constants live mainly in builtins
  if (prefixes.some((p) => p === 'color.' || p.startsWith('color.'))) {
    for (const m of COLOR_CONSTANTS) {
      if (seen.has(m.label)) continue;
      seen.add(m.label);
      out.push(m);
    }
    // also scan BY_NAME for any color.* constant we marked
    for (const [name, meta] of BY_NAME) {
      if (!name.startsWith('color.')) continue;
      if (!isColorConstantName(name.slice('color.'.length))) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ ...meta, label: name, kind: 'constant', snippet: undefined });
    }
  }
  return out;
}

/** Filter style enums by typed prefix (full path, bare style_*, or member tail). */
export function filterStyleEnums(items: BuiltinMeta[], prefix: string): BuiltinMeta[] {
  if (!prefix) return items;
  const p = prefix.toLowerCase();
  const starts: BuiltinMeta[] = [];
  const memberStarts: BuiltinMeta[] = [];
  const includes: BuiltinMeta[] = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    const member = l.includes('.') ? l.slice(l.lastIndexOf('.') + 1) : l;
    if (l.startsWith(p)) starts.push(it);
    else if (
      member.startsWith(p) ||
      `style_${member}`.startsWith(p) ||
      member.startsWith(p.replace(/^style_/, ''))
    )
      memberStarts.push(it);
    else if (l.includes(p) || member.includes(p)) includes.push(it);
  }
  return [...starts, ...memberStarts, ...includes];
}

/**
 * Source text from document start through cursor (multi-line named-arg context).
 * Caps lookback so huge files stay cheap.
 */
function textBeforeCursor(context: CompletionContext, maxChars = 4000): string {
  const pos = context.pos;
  const from = Math.max(0, pos - maxChars);
  return context.state.doc.sliceString(from, pos);
}

/** Completion for named-arg enums across any Pine call (`style=`, `shape=`, …). */
export function completeNamedArgEnum(
  context: CompletionContext,
): CompletionResult | null {
  initIndex();
  const before = textBeforeCursor(context);
  const ctx = namedArgEnumContext(before);
  if (!ctx) return null;

  // Absolute from in the document = (pos - before.length) + fromOffset
  const windowStart = context.pos - before.length;
  const absFrom = windowStart + ctx.fromOffset;

  // After `plot.` / `shape.` inside the value — member-only insert
  const dotInValue = ctx.prefix.match(/^([A-Za-z_][\w]*)\.\s*([A-Za-z_][\w.]*)?$/);
  if (dotInValue) {
    const mod = dotInValue[1]!;
    const memberPrefix = dotInValue[2] || '';
    const members = BY_MODULE.get(mod);
    if (members?.length) {
      // Prefer enum/constant members for named-arg values
      let filtered = filterByPrefix(members, memberPrefix);
      if (ctx.arg === 'style') {
        filtered = filtered.filter(
          (m) => m.label.startsWith('style_') || m.category === 'enum' || m.kind === 'constant',
        );
        if (!filtered.length) filtered = filterByPrefix(members, memberPrefix);
      }
      if (isColorNamedArg(ctx.arg)) {
        filtered = filtered.filter(
          (m) =>
            m.kind === 'constant' ||
            m.category === 'enum' ||
            isColorConstantName(m.label) ||
            isColorCtorLabel(m.label),
        );
        if (!filtered.length) filtered = filterByPrefix(members, memberPrefix);
      }
      if (filtered.length || context.explicit || memberPrefix === '') {
        return {
          from: context.pos - memberPrefix.length,
          options: filtered.map((m, i) =>
            toCompletion(
              isColorCtorLabel(m.label)
                ? m
                : { ...m, kind: 'constant', snippet: undefined },
              isColorCtorLabel(m.label) ? 110 : 100 - Math.min(i, 20),
            ),
          ),
          validFor: /^[\w.]*$/,
        };
      }
    }
  }

  const enums = enumsMatchingPrefixes(ctx.prefixes);
  if (isColorNamedArg(ctx.arg)) {
    for (const path of COLOR_CTOR_PATHS) {
      const meta = BY_NAME.get(path);
      if (!meta) continue;
      if (enums.some((m) => m.label === path)) continue;
      enums.unshift({ ...meta, label: path });
    }
  }
  const filtered = filterStyleEnums(enums, ctx.prefix);
  const list = filtered.length ? filtered : context.explicit || ctx.prefix === '' ? enums : [];
  if (!list.length) return null;
  return {
    from: absFrom,
    options: list.slice(0, 80).map((m, i) =>
      toCompletion(
        isColorCtorLabel(m.label)
          ? { ...m, label: m.label }
          : { ...m, label: m.label, kind: 'constant', snippet: undefined },
        isColorCtorLabel(m.label) ? 110 : 100 - Math.min(i, 20),
      ),
    ),
    validFor: /^[\w.]*$/,
  };
}

function sigForCall(name: string, source: string): PineCallSig | null {
  const meta = lookupBuiltin(name);
  const local = lookupPyneDoc(source, name);
  return resolveCallSignature(name, {
    documentation: meta?.documentation,
    detail: meta?.detail,
    brief: meta?.brief,
    snippet: meta?.snippet,
    localParams: local?.params,
    localDescription: local?.description,
  });
}

/**
 * Named-parameter completions inside a call — unused first, then already used.
 * Opens after `(` / `,` and while typing a param name (`ti` → `title=`).
 */
export function completeCallParams(
  context: CompletionContext,
): CompletionResult | null {
  if (!readEditorIntel(store.editorIntel).paramCompletions) return null;
  const text = context.state.doc.toString();
  const site = findCallSite(text, context.pos);
  if (!site) return null;
  const sig = sigForCall(site.name, text);
  if (!sig?.params.length) return null;
  const items = paramCompletions(sig, site);
  if (!items.length) return null;
  // Don't steal `style=` / `color=` value completion
  if (site.prefix.includes('=')) return null;
  const before = text.slice(0, site.argFrom).trimEnd();
  const afterComma = before.endsWith(',');
  const afterParen = before.endsWith('(');
  const typingName = /^[A-Za-z_][\w]*$/.test(site.prefix);
  const looksLikeValue =
    /^(close|high|low|open|volume|time|hl2|hlc3|ohlc4|true|false|na|color|ta|math|str|input|strategy|bar_index|syminfo|request)$/i.test(
      site.prefix,
    );
  const nameHit = typingName && items.some((p) => p.name.toLowerCase().startsWith(site.prefix.toLowerCase()));
  if (!context.explicit) {
    if (afterComma) {
      // always offer remaining params after `,`
    } else if (afterParen && nameHit && !looksLikeValue) {
      // `input.int(14, min` — named param, not a series token
    } else if (afterParen && !site.prefix) {
      // empty first slot: only on explicit trigger (Cmd-Space)
      return null;
    } else {
      return null;
    }
  }

  const options = items.map((p, i) => ({
    label: p.insert,
    type: 'keyword' as const,
    detail: p.used ? 'used' : 'param',
    info: p.description || `Parameter of ${sig.name}`,
    apply: p.insert,
    boost: p.used ? 10 - Math.min(i, 8) : 92 - Math.min(i, 30),
    section: p.used
      ? { name: 'Already used', rank: 2 }
      : { name: 'Parameters', rank: 1 },
  }));
  const leadWs = /^\s*/.exec(text.slice(site.argFrom, context.pos))?.[0].length || 0;
  return {
    from: site.argFrom + leadWs,
    options,
    validFor: /^[\w]*$/,
  };
}

const PARAM_HINT_MAX_ROWS = 14;
/** How many names to keep in the compact signature header. */
const PARAM_HINT_SIG_NAMES = 8;

type ParamHintRow = ReturnType<typeof classifyParams>[number] & {
  type?: string;
};

/** Window of at most `max` rows that always includes the current param. */
function selectParamHintRows(rows: ParamHintRow[], max: number): ParamHintRow[] {
  if (rows.length <= max) return rows;
  const ci = rows.findIndex((p) => p.current);
  if (ci < 0) return rows.slice(0, max);
  let start = Math.max(0, ci - Math.floor((max - 1) / 2));
  let end = start + max;
  if (end > rows.length) {
    end = rows.length;
    start = Math.max(0, end - max);
  }
  return rows.slice(start, end);
}

/**
 * Compact `plot(series, title, color, …)` header with the current name
 * wrapped in `.is-current` so the live hint can emphasize it.
 */
function compactParamHintSig(
  parent: HTMLElement,
  sig: PineCallSig,
  currentName?: string,
): void {
  const names = sig.params.filter((p) => !p.rest).map((p) => p.name);
  let shown = names;
  let leadEllip = false;
  let trailEllip = names.length > PARAM_HINT_SIG_NAMES || sig.params.some((p) => p.rest);
  if (names.length > PARAM_HINT_SIG_NAMES) {
    const ci = Math.max(0, currentName ? names.indexOf(currentName) : 0);
    let start = Math.max(0, ci - Math.floor((PARAM_HINT_SIG_NAMES - 1) / 2));
    let end = start + PARAM_HINT_SIG_NAMES;
    if (end > names.length) {
      end = names.length;
      start = Math.max(0, end - PARAM_HINT_SIG_NAMES);
    }
    shown = names.slice(start, end);
    leadEllip = start > 0;
    trailEllip = end < names.length || sig.params.some((p) => p.rest);
  }

  parent.appendChild(document.createTextNode(`${sig.name}(`));
  if (leadEllip) parent.appendChild(document.createTextNode('…, '));
  for (let i = 0; i < shown.length; i++) {
    if (i > 0) parent.appendChild(document.createTextNode(', '));
    const name = shown[i]!;
    if (currentName && name === currentName) {
      const em = document.createElement('span');
      em.className = 'is-current';
      em.textContent = name;
      parent.appendChild(em);
    } else {
      parent.appendChild(document.createTextNode(name));
    }
  }
  parent.appendChild(document.createTextNode(trailEllip ? ', …)' : ')'));
}

/**
 * Signature-hint tooltip: every parameter marked used / current / unused.
 * Shown below the call while the cursor is inside it (empty selection).
 */
export function buildParamHintTooltip(state: EditorState): Tooltip | null {
  const text = state.doc.toString();
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const pos = sel.head;
  const site = findCallSite(text, pos);
  if (!site) return null;
  const sig = sigForCall(site.name, text);
  if (!sig || sig.params.length < 2) return null;
  const rows = classifyParams(sig, site).filter((p) => !p.rest) as ParamHintRow[];
  if (!rows.length) return null;
  const current = rows.find((p) => p.current);

  return {
    pos: site.openParen,
    above: false,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-pine-param-hint';
      if (current?.name) dom.dataset.current = current.name;

      const sigEl = document.createElement('div');
      sigEl.className = 'cm-pine-param-hint-sig';
      compactParamHintSig(sigEl, sig, current?.name);
      dom.appendChild(sigEl);

      const ul = document.createElement('ul');
      ul.className = 'cm-pine-param-hint-list';

      const shown = selectParamHintRows(rows, PARAM_HINT_MAX_ROWS);
      for (const p of shown) {
        const li = document.createElement('li');
        const kind = p.current ? 'current' : p.used ? 'used' : 'unused';
        li.className = `is-${kind}`;

        const mark = document.createElement('span');
        mark.className = 'cm-pine-param-hint-mark';
        mark.textContent = kind === 'current' ? '●' : kind === 'used' ? '✓' : '○';
        li.appendChild(mark);

        const nameEl = document.createElement('span');
        nameEl.className = 'cm-pine-param-hint-name';
        nameEl.textContent = p.name;
        li.appendChild(nameEl);

        const pType = p.type;
        if (pType) {
          const typeEl = document.createElement('span');
          typeEl.className = 'cm-pine-param-hint-type';
          typeEl.textContent = pType;
          li.appendChild(typeEl);
        }

        const defVal = p.defaultValue;
        if (defVal) {
          const defEl = document.createElement('span');
          defEl.className = 'cm-pine-param-hint-default';
          defEl.textContent = `= ${defVal}`;
          li.appendChild(defEl);
        }

        ul.appendChild(li);
      }
      const hidden = rows.length - shown.length;
      if (hidden > 0) {
        const more = document.createElement('li');
        more.className = 'cm-pine-param-hint-more';
        more.textContent = `+${hidden} more`;
        ul.appendChild(more);
      }

      dom.appendChild(ul);

      const docLine = current?.description?.trim().split(/\n/)[0]?.trim();
      if (docLine) {
        const docEl = document.createElement('div');
        docEl.className = 'cm-pine-param-hint-doc';
        docEl.textContent = docLine;
        dom.appendChild(docEl);
      }

      return { dom };
    },
  };
}

export const pineParamHintField = StateField.define<Tooltip | null>({
  create: (state) => buildParamHintTooltip(state),
  update(tip, tr) {
    if (!tr.docChanged && !tr.selection) return tip;
    return buildParamHintTooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

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
  // Constants / enums never take call parens (plot.style_line, color.red, …)
  const isConst =
    meta.kind === 'constant' ||
    meta.kind === 'variable' ||
    meta.category === 'enum' ||
    /\.style_/.test(label) ||
    (label.startsWith('color.') && isColorConstantName(label.slice('color.'.length)));
  if (isConst) {
    return { ...base, apply: label };
  }
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
  const hex = hexColorAt(text, pos);
  if (hex) return hex;
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
  return undefined;
}

/**
 * Completions only: resolve a bare member via common modules (`sma` → `ta.sma`).
 * Hover / signatures must not use this — it steals language facts (`close` →
 * `strategy.close`, `new` → `array.new`).
 */
export function lookupBuiltinMember(name: string): BuiltinMeta | undefined {
  initIndex();
  if (!name || name.includes('.')) return lookupBuiltin(name);
  for (const mod of [
    'ta',
    'math',
    'str',
    'array',
    'matrix',
    'map',
    'input',
    'strategy',
    'request',
    'ticker',
    'timeframe',
    'barstate',
    'syminfo',
    'session',
    'color',
    'line',
    'label',
    'box',
    'table',
    'polyline',
    'chart',
  ]) {
    const full = `${mod}.${name}`;
    if (BY_NAME.has(full)) return BY_NAME.get(full);
  }
  return undefined;
}

/** Local (metadata) completion — always available offline. */
export function pyneCompleteLocal(context: CompletionContext): CompletionResult | null {
  initIndex();
  const cfg = readEditorIntel(store.editorIntel);
  if (!cfg.autocompleteEnabled) return null;
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const fullSource = context.state.doc.toString();

  // Named-arg enums for any Pine call (style=, shape=, location=, size=, color=, …)
  // Multi-line aware — works for all scripts, not only single-line plot(...).
  const named = cfg.enumCompletions ? completeNamedArgEnum(context) : null;
  if (named) return named;

  // Remaining named parameters after `(` / `,` (`title=`, `minval=`, …)
  const callParams = completeCallParams(context);
  if (callParams) return callParams;

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
  const localDocs = parsePyneDocAnnotations(fullSource);
  for (const [name, entry] of localDocs) {
    if (entry.kind === 'description') continue;
    if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    if (filtered.some((f) => f.label === name)) continue;
    filtered.unshift({
      label: name,
      kind: entry.kind === 'function' ? 'function' : entry.kind === 'type' ? 'type' : 'variable',
      detail: entry.signature || entry.kind,
      brief: entry.description.slice(0, 120),
      documentation: formatPyneDocMarkdown(entry),
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

/**
 * Completion: named-arg enums + local builtins always; optional remote enrich
 * with a short timeout. Dead Backend URLs cool down so typing stays instant.
 */
export async function pyneComplete(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const cfg = readEditorIntel(store.editorIntel);
  if (!cfg.autocompleteEnabled) return null;
  // Named-arg enums (style/shape/size/color/…) are client-owned — remote
  // catalogs often omit plot.style_* and friends. Prefer local for all Pine.
  {
    const named = cfg.enumCompletions ? completeNamedArgEnum(context) : null;
    if (named) return named;
  }
  {
    const callParams = completeCallParams(context);
    if (callParams) return callParams;
  }

  // Local catalog first (instant, 1000+ builtins). Remote Pro API only fills
  // gaps when local has nothing — never blocks typing / Cmd-Space on a dead host.
  const localResult = pyneCompleteLocal(context);
  if (localResult?.options?.length) return localResult;
  if (!shouldUseRemoteLsp() || context.aborted) return localResult;

  const line = context.state.doc.lineAt(context.pos);
  const source = context.state.doc.toString();
  const lineNo = line.number - 1; // CM is 1-based line.number
  const character = context.pos - line.from;
  const ac = new AbortController();
  context.addEventListener('abort', () => ac.abort());
  let remote: Awaited<ReturnType<typeof fetchRemoteCompletion>>;
  try {
    remote = await fetchRemoteCompletion({
      source,
      line: lineNo,
      character,
      signal: ac.signal,
      timeoutMs: context.explicit
        ? Math.min(600, cfg.completionTimeoutMs)
        : cfg.completionTimeoutMs,
    });
  } catch {
    remote = null;
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
  return localResult;
}

function hoverDocs(meta: BuiltinMeta, sig?: PineCallSig | null): string {
  if (sig?.params.length) {
    const merged: PineCallSig = {
      ...sig,
      description: sig.description || meta.brief || undefined,
    };
    let md = formatCallHoverMarkdown(merged);
    const extra = meta.documentation?.trim();
    if (
      extra &&
      extra !== sig.description &&
      extra !== meta.brief &&
      extra !== meta.detail &&
      !extra.startsWith(`${meta.label}(`)
    ) {
      md += '\n\n' + extra;
    }
    return md;
  }
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

const HOVER_SECTION_RE = /^\*\*([^*]+)\*\*:?\s*$/;
const HOVER_PARAM_ITEM_RE = /^([-*+]|\d+\.)\s+`([^`]+)`\s*(.*)$/;
const HOVER_BULLET_RE = /^([-*+]|\d+\.)\s+/;

function isBulletChunk(lines: string[]): boolean {
  return lines.length > 0 && lines.every((l) => HOVER_BULLET_RE.test(l.trim()));
}

/** Merge `\n\n`-split bullet paragraphs (call-hover params) into one list. */
function mergeHoverChunks(raw: string[]): string[] {
  const out: string[] = [];
  for (const chunk of raw) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (isBulletChunk(lines) && out.length) {
      const prevLines = out[out.length - 1]!
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0);
      if (isBulletChunk(prevLines)) {
        out[out.length - 1] = prevLines.concat(lines).join('\n');
        continue;
      }
    }
    out.push(chunk);
  }
  return out;
}

function sectionKey(label: string): string {
  return label.toLowerCase().replace(/:$/, '').trim();
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

  let lastSection = '';

  for (const block of blocks) {
    if (block.kind === 'code') {
      const pre = document.createElement('pre');
      pre.className =
        lastSection === 'example' ? 'cm-pine-hover-pre cm-pine-hover-example' : 'cm-pine-hover-pre';
      if (block.lang) pre.dataset.lang = block.lang;
      const code = document.createElement('code');
      code.className = 'cm-pine-hover-code-block';
      code.textContent = block.code;
      pre.appendChild(code);
      root.appendChild(pre);
      continue;
    }

    // Prose: split on blank lines / horizontal rules, then merge adjacent lists
    const chunks = mergeHoverChunks(block.text.split(/\n{2,}/));
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
        lastSection = sectionKey(rest[0]!.replace(/^#{1,3}\s+/, ''));
        if (rest.length > 1) {
          const p = document.createElement('p');
          p.className = 'cm-pine-hover-p';
          appendInlineMarkdown(p, rest.slice(1).join(' '));
          root.appendChild(p);
        }
        continue;
      }

      // Standalone **Parameters** / **Example** / **Returns** section labels
      if (rest.length === 1) {
        const sec = HOVER_SECTION_RE.exec(rest[0]!.trim());
        if (sec) {
          const h = document.createElement('div');
          h.className = 'cm-pine-hover-heading';
          lastSection = sectionKey(sec[1]!);
          if (lastSection) h.dataset.section = lastSection.replace(/\s+/g, '-');
          appendInlineMarkdown(h, rest[0]!.trim());
          root.appendChild(h);
          continue;
        }
      }

      // Bullet / numbered lists (library doc @param blocks, etc.)
      if (rest.every((l) => HOVER_BULLET_RE.test(l.trim()))) {
        const asParams = rest.every((l) => HOVER_PARAM_ITEM_RE.test(l.trim()));
        if (asParams) {
          const dl = document.createElement('div');
          dl.className = 'cm-pine-hover-dl';
          for (const l of rest) {
            const m = HOVER_PARAM_ITEM_RE.exec(l.trim());
            const row = document.createElement('div');
            row.className = 'cm-pine-hover-di';
            const dt = document.createElement('code');
            dt.className = 'cm-pine-hover-dt cm-pine-hover-code-inline';
            dt.textContent = m?.[2] || '';
            const dd = document.createElement('span');
            dd.className = 'cm-pine-hover-dd';
            if (m?.[3]) appendInlineMarkdown(dd, m[3]);
            row.appendChild(dt);
            row.appendChild(dd);
            dl.appendChild(row);
          }
          root.appendChild(dl);
          continue;
        }
        const ul = document.createElement('ul');
        ul.className = 'cm-pine-hover-list';
        for (const l of rest) {
          const li = document.createElement('li');
          li.className = 'cm-pine-hover-li';
          appendInlineMarkdown(li, l.trim().replace(HOVER_BULLET_RE, ''));
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

function hoverKindAttr(badge: string): string {
  return badge.trim().toLowerCase().replace(/\s+/g, '-');
}

function makeHoverTooltip(
  from: number,
  to: number,
  title: string,
  body: string,
  badge?: string,
  opts?: { markdown?: boolean; category?: string },
): Tooltip {
  const asMarkdown = opts?.markdown ?? looksLikeMarkdown(body);
  const category = opts?.category?.trim();
  return {
    pos: from,
    end: to,
    above: true,
    // Editor chrome is overflow:hidden — default clip hides cards above line 1
    clip: false,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-pine-hover';
      if (badge) dom.dataset.kind = hoverKindAttr(badge);

      const head = document.createElement('div');
      head.className = 'cm-pine-hover-head';

      if (badge || category) {
        if (badge) {
          const b = document.createElement('span');
          b.className = 'cm-pine-hover-badge';
          b.textContent = badge;
          head.appendChild(b);
        }
        if (category) {
          const cat = document.createElement('span');
          cat.className = 'cm-pine-hover-cat';
          cat.textContent = category;
          head.appendChild(cat);
        }
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
        head.appendChild(t);
      }

      if (head.childNodes.length) dom.appendChild(head);

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

/** Generated `ta` / `math` module stub — prefer richer namespace facts. */
function isThinModuleStub(meta: BuiltinMeta): boolean {
  if (meta.kind === 'module' || meta.category === 'module') return true;
  const brief = meta.brief || '';
  return brief.startsWith('Pine module ') || brief === `${meta.label}.*`;
}

function hoverInsideCallParam(
  site: ReturnType<typeof findCallSite>,
  text: string,
  pos: number,
): Tooltip | null {
  if (!site) return null;
  const sig = sigForCall(site.name, text);
  const rows = sig ? classifyParams(sig, site) : [];
  const current = rows.find((p) => p.current) || rows[site.cursorArgIndex];
  if (sig && current) {
    return makeHoverTooltip(
      site.argFrom,
      Math.max(site.argFrom + 1, pos),
      `${sig.name} · ${current.name}`,
      formatParamHoverMarkdown(sig, current),
      'parameter',
      { markdown: true, category: sig.name },
    );
  }
  return null;
}

function hoverFromFact(
  from: number,
  to: number,
  fact: NonNullable<ReturnType<typeof lookupHoverFact>>,
): Tooltip {
  return makeHoverTooltip(
    from,
    to,
    fact.title || fact.name,
    formatHoverFactMarkdown(fact),
    fact.kind,
    { markdown: true, category: fact.kind },
  );
}

export function pyneHoverLocal(
  view: { state: { doc: { sliceString: (a: number, b: number) => string; length: number } } },
  pos: number,
): Tooltip | null {
  initIndex();
  const doc = view.state.doc;
  const text = doc.sliceString(0, doc.length);
  const site = findCallSite(text, pos);

  // Hex color literals (`#939fff`) — even inside strings / calls
  const hex = hexColorAt(text, pos);
  if (hex) {
    return makeHoverTooltip(
      hex.from,
      hex.to,
      hex.word,
      formatColorLiteralMarkdown(hex.word),
      'color',
      { markdown: true, category: 'color' },
    );
  }

  const hit = wordAt(text, pos);

  // 1. Named argument (`title=` inside plot / input.int / …)
  if (site && hit) {
    const sig = sigForCall(site.name, text);
    const param = sig?.params.find((p) => p.name === hit.word);
    const isParamToken =
      !!param &&
      (site.namedUsed.has(hit.word) ||
        /^\s*=/.test(text.slice(hit.to)) ||
        site.args.some((a) => a.name === hit.word));
    if (sig && param && isParamToken) {
      return makeHoverTooltip(
        hit.from,
        hit.to,
        `${sig.name} · ${param.name}`,
        formatParamHoverMarkdown(sig, param),
        'parameter',
        { markdown: true, category: sig.name },
      );
    }
  }

  if (inPineLineComment(text, pos)) return null;

  const inString = enclosingStringAt(text, pos);
  if (inString && (!hit || (hit.from >= inString.from && hit.to <= inString.to))) {
    // `"title"` inside a call stays current-param hover
    return (
      hoverInsideCallParam(site, text, pos) ||
      makeHoverTooltip(inString.from, inString.to, `"${inString.value}"`, 'String literal.')
    );
  }

  if (!hit) {
    return hoverInsideCallParam(site, text, pos);
  }

  if (isHexColorToken(hit.word)) {
    return makeHoverTooltip(
      hit.from,
      hit.to,
      hit.word,
      formatColorLiteralMarkdown(hit.word),
      'color',
      { markdown: true, category: 'color' },
    );
  }

  // 2. User / library annotations in the open document (`//@function`, …)
  const localDoc = lookupPyneDoc(text, hit.word);
  if (localDoc && localDoc.kind !== 'description') {
    const md = formatPyneDocMarkdown(localDoc);
    if (md) {
      return makeHoverTooltip(
        hit.from,
        hit.to,
        localDoc.signature || localDoc.name,
        md,
        'doc annotations',
        { markdown: true, category: 'doc' },
      );
    }
  }

  // Namespace prefix of a qualified name (`ta` in `ta.sma`)
  const seg = dottedSegmentAt(hit.word, hit.from, pos);
  if (seg.count > 1 && seg.index < seg.count - 1) {
    const ns = lookupHoverFact(seg.name, { prefer: 'namespace' });
    if (ns) {
      const prefix = hit.word.split('.').slice(0, seg.index).join('.');
      const nsFrom = hit.from + prefix.length + (seg.index ? 1 : 0);
      return hoverFromFact(nsFrom, nsFrom + seg.name.length, ns);
    }
  }

  // Type / qualifier in declaration position beats cast-function builtins
  const declFact = declarationTypeFact(text, hit);
  if (declFact) return hoverFromFact(hit.from, hit.to, declFact);

  // 3. Facts / keywords / types / series / namespaces (before catalog — `close`
  // is a series builtin, not `strategy.close`)
  const fact =
    lookupHoverFact(hit.word) ||
    (hit.word.includes('.') ? lookupHoverFact(hit.word.split('.').pop() || '') : null) ||
    (seg.count > 1 ? lookupHoverFact(seg.name, { prefer: 'namespace' }) : null);
  if (fact) return hoverFromFact(hit.from, hit.to, fact);

  // 4. Builtins catalog — exact names only (never `Foo.new` → `array.new`)
  const meta = lookupBuiltin(hit.word);
  if (meta && isThinModuleStub(meta)) {
    const ns = lookupHoverFact(meta.label || hit.word, { prefer: 'namespace' });
    if (ns) return hoverFromFact(hit.from, hit.to, ns);
  }
  if (meta && !isThinModuleStub(meta)) {
    const sig = sigForCall(meta.label || hit.word, text);
    return makeHoverTooltip(
      hit.from,
      hit.to,
      meta.label,
      hoverDocs(meta, sig),
      'local metadata',
      {
        markdown: !!sig?.params.length || looksLikeMarkdown(hoverDocs(meta, sig)),
        category: meta.category,
      },
    );
  }

  // 5. User symbols in this buffer
  const user = lookupUserSymbol(text, hit.word);
  if (user) {
    return makeHoverTooltip(
      hit.from,
      hit.to,
      user.name,
      formatUserSymbolMarkdown(user),
      userSymbolBadge(user),
      { markdown: true, category: user.kind },
    );
  }

  // 6. Inside-call current param, then number literals
  const callTip = hoverInsideCallParam(site, text, pos);
  if (callTip) return callTip;
  if (isNumericLiteral(hit.word)) {
    return makeHoverTooltip(hit.from, hit.to, hit.word, 'Numeric literal (int or float).');
  }
  if (meta) {
    const sig = sigForCall(meta.label || hit.word, text);
    return makeHoverTooltip(
      hit.from,
      hit.to,
      meta.label,
      hoverDocs(meta, sig),
      'local metadata',
      {
        markdown: !!sig?.params.length || looksLikeMarkdown(hoverDocs(meta, sig)),
        category: meta.category,
      },
    );
  }
  return null;
}

/**
 * Hover: **local builtins / doc annotations first** (instant), then optional
 * remote Pro API for symbols missing from the client catalog.
 *
 * Previously remote was awaited first with a multi-second timeout whenever
 * engine=`server` + Backend URL was set — a dead `localhost:5002` made hover
 * appear broken (tooltip never showed before the pointer left).
 */
export async function pyneHover(view: EditorView, pos: number): Promise<Tooltip | null> {
  if (!readEditorIntel(store.editorIntel).hoverEnabled) return null;
  const local = pyneHoverLocal(view, pos);
  // Instant path for ta.sma, plot, input.*, named params, inside-call hover
  if (local) return local;

  const doc = view.state.doc;
  const text = doc.toString();
  const hit = wordAt(text, pos);
  // Remote LSP needs a word; local already handled inside-call param hover
  if (!hit || !shouldUseRemoteLsp()) return null;

  try {
    const line = doc.lineAt(pos);
    const remote = await fetchRemoteHover({
      source: text,
      line: line.number - 1,
      character: pos - line.from,
    });
    if (remote?.contents) {
      let from = hit.from;
      let to = hit.to;
      if (remote.range) {
        try {
          const startLine = doc.line(remote.range.start.line + 1);
          const endLine = doc.line(remote.range.end.line + 1);
          from = startLine.from + remote.range.start.character;
          to = endLine.from + remote.range.end.character;
        } catch {
          /* keep wordAt range */
        }
      }
      return makeHoverTooltip(
        Math.max(0, from),
        Math.min(doc.length, to),
        hit.word,
        remote.contents,
        'function',
        { markdown: true, category: 'pyne lsp' },
      );
    }
  } catch {
    /* network / abort */
  }
  return null;
}

/**
 * Extra completion triggers:
 * - **Mod-Space** (⌘/Ctrl-Space) — VS Code style “trigger suggest”
 * - **Ctrl-Space** kept for non-Mod platforms / CM default
 * - **Alt-`** / **Alt-i** already in {@link completionKeymap}
 */
export const pyneCompletionTriggerKeymap = keymap.of([
  { key: 'Mod-Space', run: startCompletion },
  { key: 'Ctrl-Space', run: startCompletion },
]);

/** CodeMirror extensions: autocomplete + hover (remote LSP + local fallback). */
export function pyneLspExtensions(intel?: EditorIntelSettings): Extension[] {
  initIndex();
  const cfg = intel ?? readEditorIntel(store.editorIntel) ?? DEFAULT_EDITOR_INTEL;
  const out: Extension[] = [];
  if (cfg.autocompleteEnabled) {
    out.push(
      autocompletion({
        override: [pyneComplete],
        activateOnTyping: cfg.activateOnTyping,
        activateOnCompletion: (c) => String(c.label || '').endsWith('='),
        maxRenderedOptions: cfg.maxRenderedOptions,
        defaultKeymap: true,
        icons: true,
        closeOnBlur: true,
      }),
      pyneCompletionTriggerKeymap,
      keymap.of(completionKeymap),
    );
  }
  if (cfg.hoverEnabled) {
    out.push(
      hoverTooltip((view, pos) => pyneHover(view, pos), {
        hideOn: (tr) => tr.docChanged,
        hoverTime: cfg.hoverTimeMs,
      }),
    );
  }
  if (cfg.signatureHints) out.push(pineParamHintField);
  return out;
}

/** Test helper — count indexed builtins. */
export function pyneBuiltinCount(): number {
  initIndex();
  return BY_NAME.size;
}
