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
 * CodeMirror 6 **stream language** for Pine Script™ syntax highlighting.
 *
 * Stateful tokenizer: line comments, `/* *​/` blocks, quoted strings that
 * continue across lines (while typing / rare sources), `\\n` escapes, hex
 * colors, namespaces (`ta.`), types, control/definition keywords, and
 * function names before `(`.
 *
 * Series builtins (`close`, `bar_index`) are `variableName.standard`;
 * `import … as alias` names and members after them (`m.easing`) are
 * `variableName.special` / `propertyName.special` so the theme can color
 * library exports apart from user variables and built-in namespaces.
 * Built-in types (`int` / `float` / …), `series` / `simple` in qualifier
 * position, imported UDTs (`m.Easing.linear`), and declared UDTs / enums
 * are `typeName` (theme: warm + bold).
 *
 * Completions/hover live in `pyne-lsp`.
 *
 * @module editor/pyne-language
 */

import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';

export type PineHighlightState = {
  inBlockComment: boolean;
  /** Unclosed quote — string continues on the next line (`"` / `'` / `"""` / `'''`). */
  stringQuote: '"' | "'" | '"""' | "'''" | null;
  /** Last token was `.` — next ident is a property / method. */
  afterDot: boolean;
  /** Last ident was an `import … as` alias — next `.member` is a library export. */
  afterLibAlias: boolean;
  /** After `export` — next user ident is a library export name. */
  afterExport: boolean;
  /** Inside an `import ns/Name/ver [as alias]` line. */
  inImport: boolean;
  /** Last token was `as` inside an import. */
  afterAs: boolean;
  /** Last path segment of the current import (default alias when `as` omitted). */
  importName: string | null;
  /** Import aliases seen so far in this buffer (`m`, `motion`, …). */
  importAliases: string[];
  /** After `type` / `enum` — next ident is the declared name. */
  afterTypeDecl: boolean;
  /** User-defined type / enum names seen so far (`Point`, `Easing`, …). */
  userTypes: string[];
};

export function defaultPineHighlightState(): PineHighlightState {
  return {
    inBlockComment: false,
    stringQuote: null,
    afterDot: false,
    afterLibAlias: false,
    afterExport: false,
    inImport: false,
    afterAs: false,
    importName: null,
    importAliases: [],
    afterTypeDecl: false,
    userTypes: [],
  };
}

function ensureState(state: PineHighlightState): PineHighlightState {
  if (!state.importAliases) state.importAliases = [];
  if (state.afterLibAlias == null) state.afterLibAlias = false;
  if (state.afterExport == null) state.afterExport = false;
  if (state.inImport == null) state.inImport = false;
  if (state.afterAs == null) state.afterAs = false;
  if (state.importName === undefined) state.importName = null;
  if (state.afterTypeDecl == null) state.afterTypeDecl = false;
  if (!state.userTypes) state.userTypes = [];
  return state;
}

const KEYWORDS = new Set([
  'indicator',
  'strategy',
  'library',
  'plot',
  'hline',
  'fill',
  'bgcolor',
  'barcolor',
  'plotshape',
  'plotchar',
  'plotarrow',
  'alertcondition',
  'alert',
]);

const CONTROL = new Set([
  'if',
  'else',
  'for',
  'in',
  'to',
  'by',
  'while',
  'switch',
  'break',
  'continue',
  'and',
  'or',
  'not',
]);

const DEFS = new Set([
  'var',
  'varip',
  'export',
  'import',
  'type',
  'method',
  'enum',
  'as',
  'const',
]);

const TYPES = new Set([
  'int',
  'float',
  'bool',
  'string',
  'color',
  'line',
  'label',
  'box',
  'table',
  'array',
  'matrix',
  'map',
  'polyline',
  'linefill',
  'chart.point',
]);

/** Type1 qualifiers — not reserved; only `typeName` before a real type. */
const TYPE_QUALIFIERS = new Set(['series', 'simple']);

const NAMESPACES = new Set([
  'ta',
  'math',
  'str',
  'request',
  'input',
  'strategy',
  'color',
  'label',
  'line',
  'box',
  'table',
  'array',
  'matrix',
  'map',
  'chart',
  'timeframe',
  'ticker',
  'syminfo',
  'barstate',
  'session',
  'runtime',
  'polyline',
  'linefill',
  'plot',
  'hline',
  'alert',
  'log',
  'display',
  'format',
  'xloc',
  'yloc',
  'extend',
  'size',
  'shape',
  'location',
  'scale',
  'font',
  'order',
  'barmerge',
  'adjustment',
  'dayofweek',
  'position',
  'text',
]);

/** Built-in series / time idents — highlighted apart from user variables. */
const SERIES = new Set([
  'open',
  'high',
  'low',
  'close',
  'volume',
  'time',
  'time_close',
  'timenow',
  'bar_index',
  'last_bar_index',
  'last_bar_time',
  'hl2',
  'hlc3',
  'ohlc4',
  'hlcc4',
  'year',
  'month',
  'weekofyear',
  'dayofmonth',
  'dayofweek',
  'hour',
  'minute',
  'second',
]);

const EXPORT_KINDS = new Set(['enum', 'type', 'method', 'var', 'varip', 'const']);

function isImportAlias(state: PineHighlightState, word: string): boolean {
  return state.importAliases.includes(word);
}

function addImportAlias(state: PineHighlightState, word: string) {
  if (word && !state.importAliases.includes(word)) state.importAliases.push(word);
}

function isUserType(state: PineHighlightState, word: string): boolean {
  return state.userTypes.includes(word);
}

function addUserType(state: PineHighlightState, word: string) {
  if (word && !state.userTypes.includes(word)) state.userTypes.push(word);
}

function isTypeIdent(state: PineHighlightState, word: string): boolean {
  return TYPES.has(word) || isUserType(state, word);
}

/** `series float x` / `ma(series float src)` — not `series = close` / `plot(series)`. */
function isTypeQualifier(state: PineHighlightState, word: string, stream: StringStream): boolean {
  if (!TYPE_QUALIFIERS.has(word)) return false;
  const ahead = stream.match(/^\s+([A-Za-z_][\w]*)/, false);
  if (!ahead || typeof ahead === 'boolean') return false;
  return isTypeIdent(state, ahead[1] ?? '');
}

/** Imported UDT / enum (`m.Easing`) — not `m.SuperTrend(` or ALLCAPS `m.RSI`. */
function isImportedTypeMember(word: string, stream: StringStream): boolean {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(word)) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(word)) return false;
  if (stream.match(/^\s*\(/, false)) return false;
  return true;
}

const OP_RE = /^(?:=>|\?\?|:=|\+=|-=|\*=|\/=|%=|==|!=|<=|>=|[+\-*/%=<>!?:])/;

function eatString(stream: StringStream, state: PineHighlightState): string {
  const q = state.stringQuote;
  if (!q) return 'string';
  if (q.length === 3) {
    if (stream.match(q)) {
      state.stringQuote = null;
      return 'string';
    }
    stream.next();
    while (!stream.eol() && !stream.match(q, false)) stream.next();
    return 'string';
  }
  if (stream.match(/\\[ntr"'\\]/)) return 'atom';
  if (stream.match(/\\u[0-9a-fA-F]{4}/) || stream.match(/\\x[0-9a-fA-F]{2}/)) {
    return 'atom';
  }
  if (stream.eat('\\')) {
    stream.next();
    return 'atom';
  }
  if (stream.eat(q)) {
    state.stringQuote = null;
    return 'string';
  }
  while (!stream.eol()) {
    const ch = stream.peek();
    if (ch === '\\' || ch === q) break;
    stream.next();
  }
  return 'string';
}

const pyneParser: StreamParser<PineHighlightState> = {
  startState: () => defaultPineHighlightState(),
  copyState: (s) => ({
    inBlockComment: s.inBlockComment,
    stringQuote: s.stringQuote,
    afterDot: s.afterDot,
    afterLibAlias: !!s.afterLibAlias,
    afterExport: !!s.afterExport,
    inImport: !!s.inImport,
    afterAs: !!s.afterAs,
    importName: s.importName ?? null,
    importAliases: s.importAliases ? s.importAliases.slice() : [],
    afterTypeDecl: !!s.afterTypeDecl,
    userTypes: s.userTypes ? s.userTypes.slice() : [],
  }),
  token(stream, state) {
    ensureState(state);
    if (stream.sol()) {
      // `type Name` / `enum Name` are same-line; do not steal the next line's `float`.
      state.afterTypeDecl = false;
      if (state.inImport && !state.afterAs) {
        // `import ns/Lib/1` with no `as` — default alias is the library name
        if (state.importName) addImportAlias(state, state.importName);
        state.inImport = false;
        state.importName = null;
      }
    }

    if (state.stringQuote) return eatString(stream, state);

    if (state.inBlockComment) {
      if (stream.match('*/')) {
        state.inBlockComment = false;
        return 'comment';
      }
      stream.next();
      while (!stream.eol() && !stream.match('*/', false)) stream.next();
      return 'comment';
    }

    if (stream.eatSpace()) return null;

    if (stream.sol() && stream.match(/^\/\/@[A-Za-z_][\w.]*/)) {
      stream.skipToEnd();
      return 'meta';
    }
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }

    if (stream.match('"""')) {
      state.stringQuote = '"""';
      return eatString(stream, state);
    }
    if (stream.match("'''")) {
      state.stringQuote = "'''";
      return eatString(stream, state);
    }
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      state.stringQuote = quote;
      return eatString(stream, state);
    }

    if (stream.match(/#[0-9a-fA-F]{8}\b/) || stream.match(/#[0-9a-fA-F]{6}\b/)) {
      return 'atom';
    }

    if (stream.match(/\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';

    if (stream.match(OP_RE)) {
      state.afterDot = false;
      state.afterLibAlias = false;
      state.afterTypeDecl = false;
      return 'operator';
    }

    if (stream.match('.')) {
      state.afterDot = true;
      state.afterTypeDecl = false;
      return 'punctuation';
    }

    if (stream.match(/[{}()\[\],;]/)) {
      const ch = stream.current();
      state.afterDot = false;
      state.afterLibAlias = false;
      state.afterTypeDecl = false;
      if (ch === ';' && state.inImport) {
        if (state.importName && !state.afterAs) addImportAlias(state, state.importName);
        state.inImport = false;
        state.afterAs = false;
        state.importName = null;
      }
      return 'punctuation';
    }

    if (stream.match(/[A-Za-z_][\w]*/)) {
      const word = stream.current();
      if (state.afterDot) {
        const libMember = state.afterLibAlias;
        state.afterDot = false;
        // Keep the lib chain alive for `m.Easing.linear`
        if (!libMember) state.afterLibAlias = false;
        // UDT / enum (`m.Easing.linear`, `m.Point.new`) — not `m.SuperTrend(` / `m.RSI`.
        if (libMember && isImportedTypeMember(word, stream)) return 'typeName';
        return libMember ? 'propertyName.special' : 'propertyName';
      }
      if (KEYWORDS.has(word)) {
        state.afterExport = false;
        return 'keyword';
      }
      if (CONTROL.has(word)) {
        state.afterExport = false;
        return 'controlKeyword';
      }
      if (DEFS.has(word)) {
        if (word === 'import') {
          state.inImport = true;
          state.afterAs = false;
          state.importName = null;
          state.afterExport = false;
          state.afterTypeDecl = false;
        } else if (word === 'as' && state.inImport) {
          state.afterAs = true;
        } else if (word === 'export') {
          state.afterExport = true;
          state.afterTypeDecl = false;
        } else if (word === 'type' || word === 'enum') {
          state.afterTypeDecl = true;
          state.afterExport = false;
        } else if (state.afterExport && EXPORT_KINDS.has(word)) {
          // export method/const/var — name comes next
          state.afterExport = true;
          state.afterTypeDecl = false;
        } else {
          state.afterExport = false;
          state.afterTypeDecl = false;
        }
        return 'definitionKeyword';
      }
      if (word === 'true' || word === 'false') {
        state.afterExport = false;
        return 'bool';
      }
      if (word === 'na') {
        state.afterExport = false;
        return 'null';
      }

      if (state.inImport && state.afterAs) {
        addImportAlias(state, word);
        state.inImport = false;
        state.afterAs = false;
        state.importName = null;
        state.afterExport = false;
        return 'variableName.special';
      }
      if (state.inImport) {
        state.importName = word;
        state.afterExport = false;
        return 'namespace';
      }

      if (state.afterTypeDecl) {
        addUserType(state, word);
        state.afterTypeDecl = false;
        state.afterExport = false;
        return 'typeName';
      }

      const dotted = !!stream.match(/^\s*\./, false);
      if (dotted && isImportAlias(state, word)) {
        state.afterLibAlias = true;
        state.afterExport = false;
        return 'variableName.special';
      }
      if (dotted && isUserType(state, word)) {
        state.afterExport = false;
        return 'typeName';
      }
      if (dotted && (NAMESPACES.has(word) || TYPES.has(word))) {
        state.afterExport = false;
        return 'namespace';
      }
      if (state.afterExport) {
        state.afterExport = false;
        if (stream.match(/^\s*\(/, false)) return 'variableName.special';
        return isTypeIdent(state, word) ? 'typeName' : 'variableName.special';
      }
      if (isTypeQualifier(state, word, stream) || isTypeIdent(state, word)) return 'typeName';
      if (NAMESPACES.has(word)) return 'namespace';
      if (SERIES.has(word)) return 'variableName.standard';
      if (isImportAlias(state, word)) return 'variableName.special';
      if (stream.match(/^\s*\(/, false)) return 'def';
      if (/^[A-Z][A-Z0-9_]+$/.test(word)) return 'atom';
      return 'variableName';
    }
    state.afterDot = false;
    state.afterLibAlias = false;
    state.afterTypeDecl = false;

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"'] },
    indentOnInput: /^\s*(?:else|else\s+if)\b/,
  },
};

/** CodeMirror language support for Pine (`//@version=…`, plots, ta.*, …). */
export const pyneScript = StreamLanguage.define(pyneParser);

export type PineToken = { text: string; type: string | null };

/**
 * Tokenize a full buffer (tests + format). Walks every line so multiline
 * strings / block comments keep state.
 */
export function tokenizePine(source: string): PineToken[] {
  const state: PineHighlightState = defaultPineHighlightState();
  const out: PineToken[] = [];
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const stream = makeLineStream(line);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const before = stream.pos;
      const type = pyneParser.token(stream, state);
      const text = line.slice(before, stream.pos);
      if (text.length) out.push({ text, type });
      else stream.next();
    }
    if (i < lines.length - 1) out.push({ text: '\n', type: null });
  }
  return out;
}

/** True when a source offset is inside a string or block/line comment. */
export function pineOffsetInLiteral(
  source: string,
  offset: number,
): { inString: boolean; inComment: boolean } {
  const tokens = tokenizePine(source);
  let pos = 0;
  for (const tok of tokens) {
    const next = pos + tok.text.length;
    if (offset >= pos && offset < next) {
      return {
        inString: tok.type === 'string' || (tok.type === 'atom' && /^\\/.test(tok.text)),
        inComment: tok.type === 'comment',
      };
    }
    pos = next;
  }
  return { inString: false, inComment: false };
}

/** Scan state after consuming `line` (used by the formatter). */
export function advancePineLineState(
  line: string,
  state: PineHighlightState,
): PineHighlightState {
  const next: PineHighlightState = {
    ...defaultPineHighlightState(),
    ...state,
    importAliases: state.importAliases ? state.importAliases.slice() : [],
    userTypes: state.userTypes ? state.userTypes.slice() : [],
  };
  const stream = makeLineStream(line);
  while (!stream.eol()) {
    stream.start = stream.pos;
    const before = stream.pos;
    pyneParser.token(stream, next);
    if (stream.pos === before) stream.next();
  }
  return next;
}

type MiniStream = StringStream & { pos: number; start: number };

function makeLineStream(line: string): MiniStream {
  let pos = 0;
  let start = 0;
  const stream = {
    get pos() {
      return pos;
    },
    set pos(v: number) {
      pos = v;
    },
    get start() {
      return start;
    },
    set start(v: number) {
      start = v;
    },
    eol: () => pos >= line.length,
    sol: () => pos === 0,
    peek: () => (pos < line.length ? line[pos] : undefined),
    next: () => (pos < line.length ? line[pos++] : undefined),
    eat: (m: string | RegExp | ((ch: string) => boolean)) => {
      const ch = line[pos];
      if (ch == null) return undefined;
      const ok =
        typeof m === 'string'
          ? ch === m
          : typeof m === 'function'
            ? m(ch)
            : m.test(ch);
      if (ok) {
        pos += 1;
        return ch;
      }
      return undefined;
    },
    eatSpace: () => {
      const start = pos;
      while (pos < line.length && /[ \t]/.test(line[pos]!)) pos += 1;
      return pos > start;
    },
    eatWhile: (m: string | RegExp | ((ch: string) => boolean)) => {
      const start = pos;
      while (pos < line.length) {
        const ch = line[pos]!;
        const ok =
          typeof m === 'string'
            ? ch === m
            : typeof m === 'function'
              ? m(ch)
              : m.test(ch);
        if (!ok) break;
        pos += 1;
      }
      return pos > start;
    },
    skipToEnd: () => {
      pos = line.length;
    },
    skipTo: (ch: string) => {
      const i = line.indexOf(ch, pos);
      if (i < 0) return false;
      pos = i;
      return true;
    },
    backUp: (n: number) => {
      pos = Math.max(0, pos - n);
    },
    column: () => pos,
    indentation: () => {
      let n = 0;
      while (n < line.length && line[n] === ' ') n += 1;
      return n;
    },
    match: (
      pat: string | RegExp,
      consume?: boolean,
      caseFold?: boolean,
    ): boolean | RegExpMatchArray | null => {
      const eat = consume !== false;
      if (typeof pat === 'string') {
        const slice = line.slice(pos, pos + pat.length);
        const ok = caseFold ? slice.toLowerCase() === pat.toLowerCase() : slice === pat;
        if (ok && eat) pos += pat.length;
        return ok;
      }
      const m = line.slice(pos).match(pat);
      if (!m || m.index !== 0) return null;
      if (eat) pos += m[0].length;
      return m;
    },
    current: () => line.slice(start, pos),
  };
  return stream as MiniStream;
}
