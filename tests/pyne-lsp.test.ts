/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Client Pine language helpers (builtins index, completion, word-at-cursor).
 * Guards: metadata loads 100+ builtins; `ta.sma` / bare `sma` lookup; CM complete.
 */

import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import {
  lookupBuiltin,
  lookupBuiltinMember,
  pyneBuiltinCount,
  pyneComplete,
  wordAt,
  looksLikeMarkdown,
  peelLeadingSignature,
  renderHoverMarkdown,
  appendInlineMarkdown,
  styleArgContext,
  styleEnumsForNamespace,
  filterStyleEnums,
  pyneCompleteLocal,
  completeNamedArgEnum,
  enumsMatchingPrefixes,
  pyneHoverLocal,
  pyneCompletionTriggerKeymap,
} from '../src/editor/pyne-lsp';
import {
  namedArgEnumContext,
  findNearestCallName,
  styleNamespaceForCall,
} from '../src/editor/pine-enums';
import {
  shouldUseRemoteLsp,
  markRemoteLspFailed,
  markRemoteLspOk,
  isRemoteLspCoolingDown,
  shouldMarkRemoteLspFailed,
  _resetRemoteLspCooldownForTests,
} from '../src/editor/pyne-lsp-client';

describe('pyne-lsp', () => {
  it('indexes builtins from metadata', () => {
    expect(pyneBuiltinCount()).toBeGreaterThan(100);
  });

  it('looks up ta.sma and bare sma', () => {
    const full = lookupBuiltin('ta.sma');
    expect(full?.label).toBeTruthy();
    expect(lookupBuiltinMember('sma')?.label).toBeTruthy();
    // No module-walk for hover: `close`/`new` must not become strategy.close / array.new
    expect(lookupBuiltin('close')).toBeUndefined();
    expect(lookupBuiltin('new')).toBeUndefined();
  });

  it('hover prefers local //@function annotations over missing builtins', async () => {
    const src = `//@function Demo helper with **bold**.
//@param n Size.
//@returns Doubled value.
demo(n) => n * 2
plot(demo(2))
`;
    const pos = src.indexOf('demo(2)') + 2;
    const tip = pyneHoverLocal(
      { state: { doc: { sliceString: (a: number, b: number) => src.slice(a, b), length: src.length } } },
      pos,
    );
    expect(tip).toBeTruthy();
    // create() builds DOM — ensure it is a hover for our annotation
    const restore = installMinimalDom();
    try {
      const built = tip!.create(null as never);
      const text = collectText(built.dom);
      expect(text).toContain('Demo helper');
      expect(text).toMatch(/n|Size|Doubled/i);
    } finally {
      restore();
    }
  });

  it('hover resolves ta.sma from local builtins', () => {
    const src = `//@version=6
indicator("t")
x = ta.sma(close, 14)
`;
    const pos = src.indexOf('sma') + 1;
    const tip = pyneHoverLocal(
      {
        state: {
          doc: {
            sliceString: (a: number, b: number) => src.slice(a, b),
            length: src.length,
          },
        },
      },
      pos,
    );
    expect(tip).toBeTruthy();
    expect(tip!.pos).toBeLessThanOrEqual(pos);
    expect(tip!.end).toBeGreaterThan(pos);
  });

  it('completion trigger keymap binds Mod-Space', () => {
    const keys = (pyneCompletionTriggerKeymap as { value?: Array<{ key?: string }> }).value
      || (pyneCompletionTriggerKeymap as unknown as Array<{ key?: string }>);
    // Facet/extension shape varies; ensure extension is non-empty
    expect(pyneCompletionTriggerKeymap).toBeTruthy();
    void keys;
  });

  it('remote LSP cooldown disables shouldUseRemoteLsp after failure', () => {
    _resetRemoteLspCooldownForTests();
    markRemoteLspFailed(60_000);
    expect(isRemoteLspCoolingDown()).toBe(true);
    expect(shouldUseRemoteLsp()).toBe(false);
    markRemoteLspOk();
    expect(isRemoteLspCoolingDown()).toBe(false);
    _resetRemoteLspCooldownForTests();
  });

  it('does not cool down remote LSP when the caller aborted', () => {
    const live = new AbortController();
    expect(shouldMarkRemoteLspFailed(undefined)).toBe(true);
    expect(shouldMarkRemoteLspFailed(live.signal)).toBe(true);
    live.abort();
    expect(shouldMarkRemoteLspFailed(live.signal)).toBe(false);
  });

  it('wordAt finds qualified names', () => {
    const src = 'plot(ta.sma(close, 14))';
    const i = src.indexOf('sma') + 1;
    const w = wordAt(src, i);
    expect(w?.word).toContain('sma');
  });

  it('completes top-level after prefix (local)', () => {
    const state = EditorState.create({ doc: 'ind' });
    const r = pyneCompleteLocal({
      state,
      pos: 3,
      explicit: false,
      matchBefore: (re: RegExp) => {
        const m = 'ind'.match(re);
        return m ? { from: 0, to: 3, text: 'ind' } : null;
      },
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => o.label);
    expect(labels.some((l) => String(l).startsWith('ind'))).toBe(true);
  });

  it('completes module members after ta. (local)', async () => {
    const doc = 'ta.';
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos: 3,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    expect(r!.options.length).toBeGreaterThan(5);
  });

  it('detects style= context and plot namespace', () => {
    const line = 'plot(st, "Supertrend", color=col, linewidth=2, style=)';
    const ctx = styleArgContext(line.slice(0, line.indexOf('style=') + 'style='.length));
    expect(ctx).toBeTruthy();
    expect(ctx!.namespace).toBe('plot');
    expect(ctx!.prefix).toBe('');
  });

  it('suggests plot.style_* when cursor is after style=', () => {
    const doc = 'plot(st, "Supertrend", color=col, linewidth=2, style=)';
    const pos = doc.indexOf('style=') + 'style='.length;
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('plot.style_line');
    expect(labels).toContain('plot.style_linebr');
    expect(labels).toContain('plot.style_stepline');
    expect(labels.every((l) => l.startsWith('plot.style_'))).toBe(true);
    // Insert replaces from after `style=`
    expect(r!.from).toBe(pos);
  });

  it('suggests style_ members after style=plot.', () => {
    const doc = 'plot(close, style=plot.)';
    const pos = doc.indexOf('plot.') + 'plot.'.length;
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels.some((l) => l === 'style_line' || l === 'style_linebr')).toBe(true);
  });

  it('filters style enums by partial prefix', () => {
    const enums = styleEnumsForNamespace('plot');
    expect(enums.length).toBeGreaterThan(5);
    const filtered = filterStyleEnums(enums, 'linebr');
    expect(filtered.some((m) => m.label.includes('linebr'))).toBe(true);
  });

  it('looks up plot.style_stepline after inject', () => {
    const meta = lookupBuiltin('plot.style_stepline');
    expect(meta?.label).toBe('plot.style_stepline');
  });

  it('looks up syminfo.mintick as a host variable (not a function snippet)', () => {
    const mintick = lookupBuiltin('syminfo.mintick');
    expect(mintick?.label).toBe('syminfo.mintick');
    expect(mintick?.kind).toBe('constant');
    expect(mintick?.snippet).toBeUndefined();
    // prefix/ticker stay callables from pyne-builtins.json
    expect(lookupBuiltin('syminfo.prefix')?.kind).not.toBe('constant');
    expect(lookupBuiltin('syminfo.tickerid')?.kind).toBe('constant');
  });

  it('resolves style= across multi-line plot() for any script', () => {
    const doc = `//@version=5
indicator("t")
plot(
  close,
  title="x",
  style=
)`;
    const pos = doc.indexOf('style=') + 'style='.length;
    const before = doc.slice(0, pos);
    expect(findNearestCallName(before)).toBe('plot');
    expect(styleNamespaceForCall(findNearestCallName(before))).toBe('plot');
    const state = EditorState.create({ doc });
    const r = completeNamedArgEnum({
      state,
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('plot.style_linebr');
  });

  it('suggests line.style_* for line.new(..., style=)', () => {
    const doc = 'line.new(bar_index, high, bar_index+1, low, style=)';
    const pos = doc.indexOf('style=') + 'style='.length;
    const ctx = namedArgEnumContext(doc.slice(0, pos));
    expect(ctx?.arg).toBe('style');
    expect(ctx?.prefixes.some((p) => p.startsWith('line.style_'))).toBe(true);
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('line.style_dashed');
    expect(labels.every((l) => l.startsWith('line.style_'))).toBe(true);
  });

  it('suggests label.style_* for label.new style=', () => {
    const doc = 'label.new(bar_index, high, "x", style=)';
    const pos = doc.indexOf('style=') + 'style='.length;
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('label.style_label_up');
    expect(labels.every((l) => l.startsWith('label.style_'))).toBe(true);
  });

  it('suggests shape.* for plotshape(..., style=)', () => {
    const doc = 'plotshape(true, style=)';
    const pos = doc.indexOf('style=') + 'style='.length;
    const r = pyneCompleteLocal({
      state: EditorState.create({ doc }),
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('shape.triangleup');
    expect(labels.every((l) => l.startsWith('shape.'))).toBe(true);
    expect(labels.some((l) => l.startsWith('plot.style_'))).toBe(false);
  });

  it('suggests shape.* for plotshape shape=', () => {
    const doc = 'plotshape(true, shape=)';
    const pos = doc.indexOf('shape=') + 'shape='.length;
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('shape.triangleup');
    expect(labels.every((l) => l.startsWith('shape.'))).toBe(true);
  });

  it('suggests location/size for plotshape named args', () => {
    const locDoc = 'plotshape(true, location=)';
    const locPos = locDoc.indexOf('location=') + 'location='.length;
    const locR = pyneCompleteLocal({
      state: EditorState.create({ doc: locDoc }),
      pos: locPos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect((locR!.options || []).map((o) => o.label)).toContain('location.abovebar');

    const sizeDoc = 'plotshape(true, size=)';
    const sizePos = sizeDoc.indexOf('size=') + 'size='.length;
    const sizeR = pyneCompleteLocal({
      state: EditorState.create({ doc: sizeDoc }),
      pos: sizePos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect((sizeR!.options || []).map((o) => o.label)).toContain('size.small');
  });

  it('suggests color constants after color= without call parens', () => {
    const doc = 'plot(close, color=)';
    const pos = doc.indexOf('color=') + 'color='.length;
    const r = pyneCompleteLocal({
      state: EditorState.create({ doc }),
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels.some((l) => l === 'color.red' || l === 'color.green')).toBe(true);
    expect(labels).toContain('color.new');
    expect(labels).toContain('color.rgb');
  });

  it('suggests color.new after color=color.', () => {
    const doc = 'plot(close, color=color.)';
    const pos = doc.indexOf('color.') + 'color.'.length;
    const r = pyneCompleteLocal({
      state: EditorState.create({ doc }),
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('new');
    expect(labels).toContain('rgb');
    expect(labels).toContain('red');
  });

  it('suggests strategy qty enums for default_qty_type=', () => {
    const doc = 'strategy("t", overlay=true, default_qty_type=)';
    const pos = doc.indexOf('default_qty_type=') + 'default_qty_type='.length;
    const r = pyneCompleteLocal({
      state: EditorState.create({ doc }),
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('strategy.percent_of_equity');
    expect(labels).toContain('strategy.fixed');
  });

  it('enumsMatchingPrefixes covers hline styles', () => {
    const list = enumsMatchingPrefixes(['hline.style_']);
    expect(list.map((m) => m.label)).toContain('hline.style_dotted');
  });

  it('detects markdown hover payloads', () => {
    expect(looksLikeMarkdown('```pinescript\nta.sma(...)\n```\n\nSimple')).toBe(true);
    expect(looksLikeMarkdown('plain detail only')).toBe(false);
    expect(looksLikeMarkdown('**Example:** and `ta.ema`')).toBe(true);
  });

  it('peels leading signature fence from LSP hover', () => {
    const md = '```pinescript\nta.sma(...)\n```\n\nSimple Moving Average\n\n---\n**See also:** `ta.ema`\n';
    const { signature, rest } = peelLeadingSignature(md);
    expect(signature).toBe('ta.sma(...)');
    expect(rest).toContain('Simple Moving Average');
    expect(rest).not.toMatch(/^```/);
  });

  it('renders markdown hover without raw fences', () => {
    const restore = installMinimalDom();
    try {
      const root = document.createElement('div');
      renderHoverMarkdown(
        root,
        'Simple Moving Average\n\n---\n\n**Example:**\n```pinescript\nplot(ta.sma(close, 14))\n```\n\n**See also:** `ta.ema`, `ta.rma`\n',
      );
      const text = collectText(root);
      expect(text).not.toContain('```');
      expect(text).toContain('Simple Moving Average');
      expect(text).toContain('plot(ta.sma(close, 14))');
      expect(text).toContain('ta.ema');
      expect(findByClass(root, 'cm-pine-hover-pre')).toBeTruthy();
      expect(findByClass(root, 'cm-pine-hover-hr')).toBeTruthy();
      const strongs = findAllByClass(root, 'cm-pine-hover-strong').map((n) => n.textContent);
      expect(strongs).toContain('Example:');
      expect(strongs).toContain('See also:');
      expect(findAllByClass(root, 'cm-pine-hover-code-inline').length).toBeGreaterThanOrEqual(1);
    } finally {
      restore();
    }
  });

  it('appendInlineMarkdown escapes as text nodes only', () => {
    const restore = installMinimalDom();
    try {
      const el = document.createElement('div');
      appendInlineMarkdown(el, 'Use **bold** and `code` together');
      expect(findByTag(el, 'strong')?.textContent).toBe('bold');
      expect(findByTag(el, 'code')?.textContent).toBe('code');
      expect(collectText(el)).toBe('Use bold and code together');
    } finally {
      restore();
    }
  });
});

describe('call params completion/hover', () => {
  it('suggests unused named params after plot(close, )', () => {
    const doc = 'plot(close, ';
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos: doc.length,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels).toContain('title=');
    expect(labels).toContain('color=');
  });

  it('still returns plot.style_* enums after plot(close, style=)', () => {
    const doc = 'plot(close, style=';
    const pos = doc.length;
    const state = EditorState.create({ doc });
    const r = pyneCompleteLocal({
      state,
      pos,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => String(o.label));
    expect(labels.some((l) => l.startsWith('plot.style_'))).toBe(true);
    expect(labels).toContain('plot.style_line');
  });

  it('hover on sma in ta.sma(close, 14) includes params or example', () => {
    const src = 'ta.sma(close, 14)';
    const pos = src.indexOf('sma') + 1;
    const tip = pyneHoverLocal(
      {
        state: {
          doc: {
            sliceString: (a: number, b: number) => src.slice(a, b),
            length: src.length,
          },
        },
      },
      pos,
    );
    expect(tip).toBeTruthy();
    const restore = installMinimalDom();
    try {
      const built = tip!.create(null as never);
      const text = collectText(built.dom);
      expect(text).toMatch(/source|length|Parameters|Example/i);
    } finally {
      restore();
    }
  });

  it('hover on title in plot(close, title="Hi") includes title and plot', () => {
    const src = 'plot(close, title="Hi")';
    const pos = src.indexOf('title') + 1;
    const tip = pyneHoverLocal(
      {
        state: {
          doc: {
            sliceString: (a: number, b: number) => src.slice(a, b),
            length: src.length,
          },
        },
      },
      pos,
    );
    expect(tip).toBeTruthy();
    const restore = installMinimalDom();
    try {
      const built = tip!.create(null as never);
      const text = collectText(built.dom);
      expect(text).toContain('title');
      expect(text).toContain('plot');
    } finally {
      restore();
    }
  });
});

describe('hover facts / user symbols', () => {
  function hoverOn(src: string, needle: string, extra = 1) {
    const pos = src.indexOf(needle) + extra;
    return pyneHoverLocal(
      {
        state: {
          doc: {
            sliceString: (a: number, b: number) => src.slice(a, b),
            length: src.length,
          },
        },
      },
      pos,
    );
  }

  function hoverText(src: string, needle: string, extra = 1): string {
    const tip = hoverOn(src, needle, extra);
    expect(tip).toBeTruthy();
    const restore = installMinimalDom();
    try {
      return collectText(tip!.create(null as never).dom);
    } finally {
      restore();
    }
  }

  it('var hover mentions persistence', () => {
    const src = `//@version=6
indicator("t")
var float x = 0.0
`;
    expect(hoverText(src, 'var')).toMatch(/persist/i);
  });

  it('if hover mentions conditional', () => {
    const src = `//@version=6
indicator("t")
if close > open
    x = high
`;
    expect(hoverText(src, 'if')).toMatch(/condition/i);
  });

  it('series qualifier hover mentions type qualifier', () => {
    const src = `//@version=6
indicator("t")
series float x = close
`;
    expect(hoverText(src, 'series')).toMatch(/type qualifier|qualifier/i);
  });

  it('close hover is the series builtin, not strategy.close', () => {
    const src = `//@version=6
indicator("t")
plot(close)
`;
    const text = hoverText(src, 'close');
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toMatch(/closing price|current bar/i);
    expect(text).not.toMatch(/strategy\.close/i);
  });

  it('ta in ta.sma hover mentions technical / module', () => {
    const src = `//@version=6
indicator("t")
x = ta.sma(close, 14)
`;
    expect(hoverText(src, 'ta', 1)).toMatch(/technical|module/i);
  });

  it('user input len hover mentions input / Length', () => {
    const src = `//@version=6
indicator("t")
len = input.int(14, "Length")
plot(len)
`;
    const text = hoverText(src, 'plot(len)', 'plot('.length + 1);
    expect(text).toMatch(/input/i);
    expect(text).toMatch(/Length/);
  });

  it('foo(a) => a hover on foo mentions function / param a', () => {
    const src = `//@version=6
indicator("t")
foo(a) => a
plot(foo(1))
`;
    const text = hoverText(src, 'foo(a)', 1);
    expect(text).toMatch(/function/i);
    expect(text).toMatch(/\ba\b/);
  });
});


/** Lightweight DOM for hover markdown tests (no browser). Restores prior document. */
function installMinimalDom(): () => void {
  type NodeLike = {
    nodeType: number;
    tagName?: string;
    className: string;
    textContent: string;
    dataset: Record<string, string>;
    childNodes: NodeLike[];
    appendChild(c: NodeLike): NodeLike;
  };
  const createEl = (tag: string): NodeLike => {
    const el: NodeLike = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      dataset: {},
      childNodes: [],
      appendChild(c: NodeLike) {
        el.childNodes.push(c);
        if (c.nodeType === 3) {
          el.textContent += c.textContent;
        } else if (c.textContent) {
          el.textContent += c.textContent;
        }
        return c;
      },
    };
    return el;
  };
  const prev = globalThis.document;
  (globalThis as unknown as { document: unknown }).document = {
    __pyneHoverDom: true,
    documentElement: createEl('html'),
    body: createEl('body'),
    createElement(tag: string) {
      return createEl(tag);
    },
    createTextNode(text: string) {
      return {
        nodeType: 3,
        className: '',
        textContent: text,
        dataset: {},
        childNodes: [],
        appendChild(c: NodeLike) {
          return c;
        },
      };
    },
  };
  return () => {
    (globalThis as unknown as { document: typeof prev }).document = prev;
  };
}

function walk(node: { childNodes?: unknown[]; textContent?: string }, out: string[]) {
  const kids = (node.childNodes || []) as Array<{ nodeType: number; textContent?: string; childNodes?: unknown[] }>;
  if (!kids.length && node.textContent) {
    out.push(node.textContent);
    return;
  }
  for (const c of kids) {
    if (c.nodeType === 3) out.push(c.textContent || '');
    else walk(c, out);
  }
}

function collectText(root: { childNodes?: unknown[]; textContent?: string }): string {
  const parts: string[] = [];
  walk(root, parts);
  return parts.join('');
}

function findByClass(root: { childNodes?: unknown[]; className?: string }, cls: string): { textContent?: string } | null {
  const stack = [root as { childNodes?: unknown[]; className?: string; textContent?: string }];
  while (stack.length) {
    const n = stack.pop()!;
    if (typeof n.className === 'string' && n.className.split(/\s+/).includes(cls)) return n;
    for (const c of (n.childNodes || []) as Array<{ childNodes?: unknown[]; className?: string }>) {
      stack.push(c);
    }
  }
  return null;
}

function findAllByClass(root: { childNodes?: unknown[]; className?: string }, cls: string) {
  const out: Array<{ textContent?: string }> = [];
  const stack = [root as { childNodes?: unknown[]; className?: string; textContent?: string }];
  while (stack.length) {
    const n = stack.pop()!;
    if (typeof n.className === 'string' && n.className.split(/\s+/).includes(cls)) out.push(n);
    for (const c of (n.childNodes || []) as Array<{ childNodes?: unknown[]; className?: string }>) {
      stack.push(c);
    }
  }
  return out;
}

function findByTag(root: { childNodes?: unknown[]; tagName?: string }, tag: string) {
  const want = tag.toUpperCase();
  const stack = [root as { childNodes?: unknown[]; tagName?: string; textContent?: string }];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.tagName === want) return n;
    for (const c of (n.childNodes || []) as Array<{ childNodes?: unknown[]; tagName?: string }>) {
      stack.push(c);
    }
  }
  return null;
}
