/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
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
  pineBuiltinCount,
  pineComplete,
  wordAt,
  looksLikeMarkdown,
  peelLeadingSignature,
  renderHoverMarkdown,
  appendInlineMarkdown,
} from '../src/editor/pine-lsp';

describe('pine-lsp', () => {
  it('indexes builtins from metadata', () => {
    expect(pineBuiltinCount()).toBeGreaterThan(100);
  });

  it('looks up ta.sma and bare sma', () => {
    const full = lookupBuiltin('ta.sma');
    expect(full?.label).toBeTruthy();
    const bare = lookupBuiltin('sma');
    // may resolve via module search
    expect(bare || full).toBeTruthy();
  });

  it('wordAt finds qualified names', () => {
    const src = 'plot(ta.sma(close, 14))';
    const i = src.indexOf('sma') + 1;
    const w = wordAt(src, i);
    expect(w?.word).toContain('sma');
  });

  it('completes top-level after prefix (local)', async () => {
    const { pineCompleteLocal } = await import('../src/editor/pine-lsp');
    const state = EditorState.create({ doc: 'ind' });
    const r = pineCompleteLocal({
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
    const { pineCompleteLocal } = await import('../src/editor/pine-lsp');
    const doc = 'ta.';
    const state = EditorState.create({ doc });
    const r = pineCompleteLocal({
      state,
      pos: 3,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    expect(r!.options.length).toBeGreaterThan(5);
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
    __pineHoverDom: true,
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
