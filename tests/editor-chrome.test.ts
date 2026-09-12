/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor chrome: indent folding, indent grid math, minimap scroll mapping,
 * and the minimap store toggle.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import {
  PINE_INDENT_WIDTH,
  codeFoldingExtension,
  foldMarker,
  indentColumn,
  pineFoldRange,
  pineIndentFoldService,
} from '../src/editor/code-folding';
import { IndentWidget, indentGuidesExtension, indentMatcher } from '../src/editor/indent-guides';
import {
  EditorMinimap,
  MINIMAP_MAX_LINES,
  MINIMAP_MIN_CONTAINER_WIDTH,
  MINIMAP_ROW_HEIGHT,
  MINIMAP_WIDTH,
  scrollFraction,
  scrollTopForFraction,
  viewportFraction,
} from '../src/editor/minimap';
import {
  setEditorMinimapEnabled,
  store,
  toggleEditorMinimapEnabled,
} from '../src/store';

const stateFor = (doc: string) => EditorState.create({ doc });

describe('indentColumn', () => {
  it('counts spaces, tabs as 4-stop, stops at first non-space', () => {
    expect(indentColumn('')).toBe(0);
    expect(indentColumn('close')).toBe(0);
    expect(indentColumn('    x')).toBe(4);
    expect(indentColumn('\tx')).toBe(4);
    expect(indentColumn('  \tx')).toBe(4);
    expect(indentColumn('   \tx')).toBe(4);
    expect(PINE_INDENT_WIDTH).toBe(4);
  });
});

describe('pineFoldRange', () => {
  it('folds an indented block, keeping the header line visible', () => {
    const st = stateFor('if a\n    x := 1\n    y := 2\nz := 3\n');
    const head = st.doc.line(1);
    const range = pineFoldRange(st, head.from);
    expect(range).not.toBeNull();
    expect(range?.from).toBe(head.to);
    expect(range?.to).toBe(st.doc.line(3).to);
  });

  it('returns null for flat documents and blank lines', () => {
    const flat = stateFor('a := 1\nb := 2\n');
    expect(pineFoldRange(flat, 0)).toBeNull();
    const withBlank = stateFor('if a\n\n    x := 1\n');
    const range = pineFoldRange(withBlank, 0);
    expect(range).not.toBeNull();
    expect(range?.to).toBe(withBlank.doc.line(3).to);
  });

  it('stops at dedent, folds nested outer block to its end', () => {
    const st = stateFor('if a\n    if b\n        x := 1\n    y := 2\nz := 3\n');
    const outer = pineFoldRange(st, 0);
    expect(outer).not.toBeNull();
    expect(outer?.to).toBe(st.doc.line(4).to);
    const inner = pineFoldRange(st, st.doc.line(2).from);
    expect(inner).not.toBeNull();
    expect(inner?.to).toBe(st.doc.line(3).to);
  });
});

describe('minimap scroll mapping', () => {
  it('fraction helpers clamp and invert', () => {
    expect(scrollFraction(0, 1000, 200)).toBe(0);
    expect(scrollFraction(800, 1000, 200)).toBe(1);
    expect(scrollFraction(-5, 1000, 200)).toBe(0);
    expect(scrollFraction(400, 1000, 200)).toBeCloseTo(0.5);
    expect(scrollTopForFraction(0.5, 1000, 200)).toBeCloseTo(400);
    expect(scrollTopForFraction(2, 1000, 200)).toBe(800);
    expect(scrollTopForFraction(0, 500, 500)).toBe(0);
  });

  it('viewport fraction clamps to [0, 1]', () => {
    expect(viewportFraction(0, 100, 1000)).toEqual({ from: 0, to: 0.1 });
    expect(viewportFraction(-10, 2000, 1000)).toEqual({ from: 0, to: 1 });
  });
  it('layout constants are sane', () => {
    expect(MINIMAP_WIDTH).toBeGreaterThan(0);
    expect(MINIMAP_ROW_HEIGHT).toBeGreaterThan(0);
    expect(MINIMAP_MAX_LINES).toBeGreaterThan(100);
    expect(MINIMAP_MIN_CONTAINER_WIDTH).toBeGreaterThan(MINIMAP_WIDTH);
  });
});

describe('editor minimap store flag', () => {
  it('defaults on and toggles', () => {
    setEditorMinimapEnabled(true);
    expect(store.editorMinimapEnabled).toBe(true);
    toggleEditorMinimapEnabled();
    expect(store.editorMinimapEnabled).toBe(false);
    toggleEditorMinimapEnabled();
    expect(store.editorMinimapEnabled).toBe(true);
  });
});

describe('code folding extension', () => {
  it('builds gutter + keymap + indent service', () => {
    const ext = codeFoldingExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBe(3);
  });

  it('markers carry open state', () => {
    const open = foldMarker(true);
    expect(open.textContent).toBe('▾');
    expect(open.className).toContain('is-open');
    expect(open.title).toBe('Unfold line');
    expect(open.getAttribute('aria-label')).toBe('Unfold line');
    const closed = foldMarker(false);
    expect(closed.textContent).toBe('▸');
    expect(closed.className).not.toContain('is-open');
    expect(closed.title).toBe('Fold line');
    expect(closed.getAttribute('aria-label')).toBe('Fold line');
  });

  it('fold service resolves indent ranges headlessly', () => {
    const doc = 'if a\n    x := 1\n    y := 2\nz := 3\n';
    const st = EditorState.create({ doc, extensions: [pineIndentFoldService] });
    const range = foldable(st, 0, st.doc.length);
    expect(range).not.toBeNull();
    expect(range?.from).toBe(st.doc.line(1).to);
    expect(range?.to).toBe(st.doc.line(3).to);
    const flat = EditorState.create({
      doc: 'a := 1\nb := 2\n',
      extensions: [pineIndentFoldService],
    });
    expect(foldable(flat, 0, flat.doc.length)).toBeNull();
  });
});

describe('indent grid widget', () => {
  it('extension factory builds without DOM', () => {
    expect(indentGuidesExtension()).toBeDefined();
  });

  it('splits runs into 4-column guided cells, width-preserving', () => {
    const el = new IndentWidget('        ').toDOM() as unknown as {
      children: Array<{
        className: string;
        children: Array<{ className: string; textContent: string }>;
      }>;
    };
    expect(el.children.length).toBe(2);
    for (const cell of el.children) {
      expect(cell.className).toBe('ax-indent-cell');
      expect(cell.children.length).toBe(2);
      expect(cell.children[0]?.className).toBe('ax-iguide');
      expect(cell.children[1]?.textContent).toBe('····');
    }
  });

  it('renders partial trailing cells as dots only', () => {
    const el = new IndentWidget('      ').toDOM() as unknown as {
      children: Array<{ className: string; textContent: string }>;
    };
    expect(el.children.length).toBe(2);
    expect(el.children[0]?.className).toBe('ax-indent-cell');
    expect(el.children[1]?.className).toBe('ax-indent-dots');
    expect(el.children[1]?.textContent).toBe('··');
  });

  it('expands tabs to 4-column stops', () => {
    const el = new IndentWidget('\t').toDOM() as unknown as {
      children: Array<{ className: string }>;
    };
    expect(el.children.length).toBe(1);
    expect(el.children[0]?.className).toBe('ax-indent-cell');
  });

  it('eq compares the whitespace run', () => {
    const a = new IndentWidget('    ');
    const b = new IndentWidget('    ');
    const c = new IndentWidget('        ');
    expect(a.eq(b)).toBe(true);
    expect(a.eq(c)).toBe(false);
  });
});

/** Headless view shape for MatchDecorator (state is real, layout faked). */
function fakeDecoView(doc: string) {
  const state = EditorState.create({ doc });
  return {
    state,
    viewport: { from: 0, to: state.doc.length },
    visibleRanges: [{ from: 0, to: state.doc.length }],
  };
}

describe('indent matcher pipeline', () => {
  it('decorates each leading-whitespace run once', () => {
    const view = fakeDecoView('if a\n    x := 1\n    y := 2\nz := 3\n');
    const deco = indentMatcher.createDeco(view as never);
    const found: Array<{ from: number; to: number }> = [];
    deco.between(0, view.state.doc.length, (from, to) => {
      found.push({ from, to });
    });
    expect(found.length).toBe(2);
    expect(found[0]).toEqual({ from: 5, to: 9 });
  });

  it('decorations carry the whitespace run in the widget', () => {
    const view = fakeDecoView('        x := 1\n');
    const deco = indentMatcher.createDeco(view as never);
    const widgets: unknown[] = [];
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      widgets.push((value as { spec?: { widget?: unknown } }).spec?.widget);
    });
    expect(widgets.length).toBe(1);
    expect(widgets[0]).toBeInstanceOf(IndentWidget);
    expect((widgets[0] as IndentWidget).run).toBe('        ');
  });

  it('update without changes returns the same set', () => {
    const view = fakeDecoView('    x := 1\n');
    const deco = indentMatcher.createDeco(view as never);
    const same = indentMatcher.updateDeco(
      { docChanged: false, viewportMoved: false, view } as never,
      deco,
    );
    expect(same).toBe(deco);
  });

  it('update across an edit remaps decorations', () => {
    const before = EditorState.create({ doc: '    x := 1\n' });
    const view = {
      state: before,
      viewport: { from: 0, to: before.doc.length },
      visibleRanges: [{ from: 0, to: before.doc.length }],
    };
    const deco = indentMatcher.createDeco(view as never);
    const tr = before.update({ changes: { from: 0, to: 0, insert: '//c\n' } });
    const after = {
      state: tr.state,
      viewport: { from: 0, to: tr.state.doc.length },
      visibleRanges: [{ from: 0, to: tr.state.doc.length }],
    };
    const next = indentMatcher.updateDeco(
      {
        docChanged: true,
        viewportMoved: false,
        changes: tr.changes,
        view: after,
      } as never,
      deco,
    );
    const found: number[] = [];
    next.between(0, tr.state.doc.length, (from) => {
      found.push(from);
    });
    // Leading run shifted down by the inserted comment line: [0,4) → [4,8).
    expect(found).toEqual([4]);
  });
});

/** Local fakes for the canvas/host/view trio EditorMinimap drives. */
function makeMinimapHarness(lines: string[], hostWidth = 800) {
  const fills: number[][] = [];
  const strokes: number[][] = [];
  const canvasHandlers = new Map<string, Set<(e: never) => void>>();
  const windowHandlers = new Map<string, Set<(e: never) => void>>();
  const scrollHandlers = new Set<(e: never) => void>();
  const fakeCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    setTransform() {},
    clearRect() {},
    fillRect(...a: number[]) {
      fills.push(a);
    },
    strokeRect(...a: number[]) {
      strokes.push(a);
    },
  };
  let removed = false;
  const fakeCanvas = {
    className: '',
    style: {} as Record<string, string>,
    attrs: {} as Record<string, string>,
    width: 0,
    height: 0,
    setAttribute(k: string, v: string) {
      fakeCanvas.attrs[k] = v;
    },
    addEventListener(t: string, fn: (e: never) => void) {
      if (!canvasHandlers.has(t)) canvasHandlers.set(t, new Set());
      canvasHandlers.get(t)?.add(fn);
    },
    removeEventListener(t: string, fn: (e: never) => void) {
      canvasHandlers.get(t)?.delete(fn);
    },
    setPointerCapture() {},
    remove() {
      removed = true;
    },
    getBoundingClientRect: () => ({
      x: 1528,
      y: 0,
      top: 0,
      left: 1528,
      width: MINIMAP_WIDTH,
      height: 400,
      right: 1600,
      bottom: 400,
    }),
    getContext: () => fakeCtx,
  };
  let appended: unknown = null;
  const fakeHost = {
    clientWidth: hostWidth,
    clientHeight: 400,
    dataset: {} as Record<string, string>,
    appendChild(el: unknown) {
      appended = el;
    },
  };
  const fakeScroll = {
    scrollTop: 0,
    clientHeight: 400,
    scrollHeight: 2000,
    addEventListener(_t: string, fn: (e: never) => void) {
      scrollHandlers.add(fn);
    },
    removeEventListener(_t: string, fn: (e: never) => void) {
      scrollHandlers.delete(fn);
    },
  };
  const fakeView = {
    state: {
      doc: {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
        lineAt: () => ({ number: 1 }),
      },
      selection: { main: { head: 0 } },
    },
    scrollDOM: fakeScroll,
  };
  const g = globalThis as Record<string, unknown>;
  const prev = {
    document: g.document,
    getComputedStyle: g.getComputedStyle,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
    window: g.window,
  };
  let rafCb: (() => void) | null = null;
  g.document = { createElement: () => fakeCanvas, documentElement: {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  g.requestAnimationFrame = (cb: () => void) => {
    rafCb = cb;
    return 1;
  };
  g.cancelAnimationFrame = () => {
    rafCb = null;
  };
  g.window = {
    devicePixelRatio: 1,
    addEventListener(t: string, fn: (e: never) => void) {
      if (!windowHandlers.has(t)) windowHandlers.set(t, new Set());
      windowHandlers.get(t)?.add(fn);
    },
    removeEventListener(t: string, fn: (e: never) => void) {
      windowHandlers.get(t)?.delete(fn);
    },
  };
  return {
    fills,
    strokes,
    fakeCanvas,
    fakeHost,
    fakeScroll,
    fakeView,
    canvasHandlers,
    windowHandlers,
    scrollHandlerCount: () => scrollHandlers.size,
    appended: () => appended,
    removed: () => removed,
    runFrame: () => {
      const cb = rafCb;
      rafCb = null;
      cb?.();
    },
    restore: () => {
      g.document = prev.document;
      g.getComputedStyle = prev.getComputedStyle;
      g.requestAnimationFrame = prev.requestAnimationFrame;
      g.cancelAnimationFrame = prev.cancelAnimationFrame;
      g.window = prev.window;
    },
  };
}

const DEMO_LINES = ['//@version=6', 'indicator("Big")', 'if close > open', '    x = 1', '    plot(x)'];

describe('EditorMinimap', () => {
  it('appends a canvas, renders bars + viewport, marks host on', () => {
    const h = makeMinimapHarness(DEMO_LINES);
    try {
      const mm = new EditorMinimap(h.fakeView as never, h.fakeHost as never);
      expect(h.appended()).toBe(h.fakeCanvas);
      expect(h.fakeCanvas.className).toBe('ax-minimap');
      h.runFrame();
      expect(h.fills.length).toBeGreaterThan(0);
      expect(h.strokes.length).toBe(1);
      expect(h.fakeHost.dataset.minimap).toBe('on');
      expect(h.fakeCanvas.style.height).toBe(`${h.fakeHost.clientHeight}px`);
      expect(h.fakeCanvas.height).toBe(h.fakeHost.clientHeight);
      mm.destroy();
      expect(h.removed()).toBe(true);
    } finally {
      h.restore();
    }
  });

  it('coalesces rapid updates into one frame', () => {
    const h = makeMinimapHarness(DEMO_LINES);
    try {
      const mm = new EditorMinimap(h.fakeView as never, h.fakeHost as never);
      mm.schedule();
      mm.schedule();
      h.runFrame();
      const afterFirst = h.fills.length;
      expect(afterFirst).toBeGreaterThan(0);
      h.runFrame();
      expect(h.fills.length).toBe(afterFirst);
      mm.destroy();
    } finally {
      h.restore();
    }
  });

  it('hides below the minimum container width', () => {
    const h = makeMinimapHarness(DEMO_LINES, MINIMAP_MIN_CONTAINER_WIDTH - 1);
    try {
      const mm = new EditorMinimap(h.fakeView as never, h.fakeHost as never);
      h.runFrame();
      expect(h.fakeCanvas.style.display).toBe('none');
      expect(h.fakeHost.dataset.minimap).toBe('off');
      mm.destroy();
    } finally {
      h.restore();
    }
  });

  it('pointer press scrolls, drag follows, release stops', () => {
    const h = makeMinimapHarness(DEMO_LINES);
    try {
      const mm = new EditorMinimap(h.fakeView as never, h.fakeHost as never);
      h.runFrame();
      const press = (clientY: number) => ({ clientX: 1564, clientY, pointerId: 7 });
      h.canvasHandlers.get('pointerdown')?.forEach((fn) => { fn(press(390) as never); });
      // frac 0.975, centered by half the viewport fraction (400/2000 / 2).
      expect(h.fakeScroll.scrollTop).toBeCloseTo(0.875 * (2000 - 400), 0);
      h.windowHandlers.get('pointermove')?.forEach((fn) => { fn(press(10) as never); });
      expect(h.fakeScroll.scrollTop).toBe(0);
      h.windowHandlers.get('pointerup')?.forEach((fn) => { fn({} as never); });
      h.windowHandlers.get('pointermove')?.forEach((fn) => { fn(press(390) as never); });
      expect(h.fakeScroll.scrollTop).toBe(0);
      mm.destroy();
    } finally {
      h.restore();
    }
  });

  it('pointercancel ends a drag so later moves do not scroll', () => {
    const h = makeMinimapHarness(DEMO_LINES);
    try {
      const mm = new EditorMinimap(h.fakeView as never, h.fakeHost as never);
      h.runFrame();
      const press = (clientY: number) => ({ clientX: 1564, clientY, pointerId: 7 });
      h.canvasHandlers.get('pointerdown')?.forEach((fn) => { fn(press(390) as never); });
      const afterDown = h.fakeScroll.scrollTop;
      expect(afterDown).toBeGreaterThan(0);
      h.windowHandlers.get('pointercancel')?.forEach((fn) => { fn({} as never); });
      h.windowHandlers.get('pointermove')?.forEach((fn) => { fn(press(10) as never); });
      expect(h.fakeScroll.scrollTop).toBe(afterDown);
      mm.destroy();
    } finally {
      h.restore();
    }
  });

  it('survives setPointerCapture failures (synthetic events)', () => {
    const h = makeMinimapHarness(DEMO_LINES);
    try {
      h.fakeCanvas.setPointerCapture = () => {
        throw new Error('no active pointer');
      };
      const mm = new EditorMinimap(h.fakeView as never, h.fakeHost as never);
      h.runFrame();
      h.canvasHandlers.get('pointerdown')?.forEach((fn) => {
        fn({ clientX: 1564, clientY: 390, pointerId: 7 } as never);
      });
      expect(h.fakeScroll.scrollTop).toBeGreaterThan(0);
      mm.destroy();
    } finally {
      h.restore();
    }
  });

  it('destroy detaches the scroll listener', () => {
    const h = makeMinimapHarness(DEMO_LINES);
    try {
      const mm = new EditorMinimap(h.fakeView as never, h.fakeHost as never);
      expect(h.scrollHandlerCount()).toBe(1);
      mm.destroy();
      expect(h.scrollHandlerCount()).toBe(0);
    } finally {
      h.restore();
    }
  });
});
