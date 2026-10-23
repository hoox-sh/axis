/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * GPU parity — the gate for wiring the WebGL2 candle overlay (HP-3 wiring,
 * plan §14.2 "do not gut PaneManager until GPU parity tests exist").
 *
 * `tests/hp/visual-attr.test.ts` pins each fill in isolation; this suite
 * pins what makes one *painter* safe to swap for another:
 *
 * 1. **Feed parity** — `fillVisualAttrFromHot` (the GPU's feed) and
 *    `copyOutBars` (the LWC sampler's feed) read the same published
 *    generation and agree candle-for-candle: prices round-trip through the
 *    float32 NDC records to the exact copy-out values, x_index is
 *    contiguous from the oldest visible candle, flags/colors/volume mirror
 *    the same bars both painters show.
 * 2. **Reference parity** — the hot fill is *bit-identical* to the CPU
 *    reference `fillVisualAttr` for identical inputs (including the
 *    capacity-drop rule), which is the contract a renderer is compared
 *    against (see the note in `visual-attr.ts`).
 * 3. **Anchor math** — `overlayViewport` places record `i` exactly where
 *    LWC puts logical `fromBase + i`, fractional pan offsets and right
 *    margin included.
 * 4. **Activation gate** — the overlay never engages on the default `auto`
 *    flag: no default path may recolor LWC's translucent candles by
 *    stacking a second painter on top (module doc, hp/render/gpu-overlay).
 */

import '../setup';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  allocateHotBuffer,
  BAR_FLAG_CLOSED,
  BAR_FLAG_FORMING,
  type HotBarTicks,
  type HotBuffer,
} from '../../src/hp/memory/hot-buffer';
import {
  allocateVisualAttr,
  fillVisualAttr,
  fillVisualAttrFromHot,
  normalizeVolume,
  packRgba,
  priceToNdc,
  VISUAL_OFFSET,
  type VisualSourceBar,
} from '../../src/hp/paint/visual-attr';
import { copyOutBars } from '../../src/hp/paint/copy-out-lwc';
import { setHpGpuMode } from '../../src/hp/feature-flag';
import {
  MAX_OVERLAY_BARS,
  overlayViewport,
  parseCssColorToRgb,
  startGpuOverlay,
  type GpuOverlayDeps,
} from '../../src/hp/render/gpu-overlay';

const PALETTE = { up: 0x3ddc97, down: 0xf07178 };
const Y = { yMin: 90, yMax: 120 };
const WORDS = 8; // VISUAL_RECORD_WORDS — 6 × f32 + 2 × u32

/** `priceScale = 0` → ticks are the display price (copy-out convention). */
function hot(): HotBuffer {
  const buf = allocateHotBuffer();
  if (!buf) throw new Error('allocateHotBuffer');
  buf.priceScale = 0;
  return buf;
}

function mk(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  flags: number = BAR_FLAG_CLOSED,
): HotBarTicks {
  return {
    time,
    openTicks: BigInt(open),
    highTicks: BigInt(high),
    lowTicks: BigInt(low),
    closeTicks: BigInt(close),
    volume,
    flags,
  };
}

/**
 * Eight mixed candles: falling, rising, flat (close === open → up color),
 * a zero volume, and a forming tip — the states both painters must agree on.
 */
function parityBars(): HotBarTicks[] {
  return [
    mk(60, 100, 105, 98, 103, 10),
    mk(120, 103, 108, 101, 107, 30),
    mk(180, 107, 109, 100, 101, 0),
    mk(240, 101, 104, 99, 99, 20),
    mk(300, 99, 102, 97, 102, 40),
    mk(360, 102, 103, 101, 101, 25),
    mk(420, 101, 110, 100, 109, 35),
    mk(480, 109, 112, 108, 110, 50, BAR_FLAG_FORMING),
  ];
}

const HOT_FROM = 500;

describe('GPU feed ≡ LWC feed (same generation)', () => {
  it('reconstructs every candle the copy-out hands LWC, record for record', () => {
    const buf = hot();
    buf.publish(parityBars(), { hotFromIndex: HOT_FROM });

    const out = copyOutBars(buf, { fromAbs: HOT_FROM, count: 8 });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.complete).toBe(true);
    expect(out.bars).toHaveLength(8);
    expect(out.generation % 2).toBe(0);

    const vis = allocateVisualAttr(8);
    expect(vis).not.toBeNull();
    if (!vis) return;
    const n = fillVisualAttrFromHot(
      buf,
      vis,
      { fromAbs: HOT_FROM, visibleCount: 8, y: Y },
      PALETTE,
    );
    expect(n).toBe(out.bars.length);

    const maxVol = Math.max(...out.bars.map((b) => b.volume ?? 0));
    const span = Y.yMax - Y.yMin;
    const back = (ndc: number): number => Y.yMin + ((ndc + 1) / 2) * span;

    for (let i = 0; i < out.bars.length; i++) {
      const bar = out.bars[i];
      expect(bar).toBeDefined();
      if (!bar) continue;
      const w = i * WORDS;
      const open = bar.open ?? 0;
      const high = bar.high ?? 0;
      const low = bar.low ?? 0;
      const close = bar.close ?? 0;
      const volume = bar.volume ?? 0;

      // x_index: contiguous slots from the oldest visible candle.
      expect(vis.f32[w] ?? Number.NaN).toBe(i);

      // NDC words equal the reference projection bit-for-bit…
      expect(vis.f32[w + 1] ?? Number.NaN).toBe(priceToNdc(open, Y.yMin, Y.yMax));
      expect(vis.f32[w + 2] ?? Number.NaN).toBe(priceToNdc(high, Y.yMin, Y.yMax));
      expect(vis.f32[w + 3] ?? Number.NaN).toBe(priceToNdc(low, Y.yMin, Y.yMax));
      expect(vis.f32[w + 4] ?? Number.NaN).toBe(priceToNdc(close, Y.yMin, Y.yMax));
      // …and round-trip back to the copy-out prices within float32 error.
      expect(Math.abs(back(vis.f32[w + 1] ?? Number.NaN) - open)).toBeLessThan(1e-4);
      expect(Math.abs(back(vis.f32[w + 4] ?? Number.NaN) - close)).toBeLessThan(1e-4);

      // Volume is normalized to the same visible maximum LWC would use.
      expect(vis.f32[w + 5] ?? Number.NaN).toBe(normalizeVolume(volume, maxVol));

      // Color follows the close-vs-open rule with the shared palette.
      const rising = close >= open;
      expect(vis.u32[w + (VISUAL_OFFSET.color >> 2)] ?? 0).toBe(
        packRgba(rising ? PALETTE.up : PALETTE.down, 194),
      );

      // Forming tip parity: the same `closed` state the copy-out carries.
      expect(vis.u32[w + (VISUAL_OFFSET.flags >> 2)] ?? 0).toBe(
        (bar.closed === false ? BAR_FLAG_FORMING : BAR_FLAG_CLOSED) >>> 0,
      );
    }
  });

  it('normalizes a bar differently per viewport (viewport-relative volume)', () => {
    const buf = hot();
    buf.publish(
      [
        mk(60, 100, 105, 98, 103, 10),
        mk(120, 103, 108, 101, 107, 30),
        mk(180, 107, 109, 100, 101, 20),
        mk(240, 101, 104, 99, 99, 40),
      ],
      { hotFromIndex: 0 },
    );

    const a = allocateVisualAttr(4);
    if (!a) throw new Error('allocate');
    // Window A: bars 0..1 → visible max 30. Window B: bars 0..3 → max 40.
    expect(fillVisualAttrFromHot(buf, a, { fromAbs: 0, visibleCount: 2, y: Y }, PALETTE)).toBe(2);
    const a0 = a.f32[5] ?? Number.NaN;
    expect(a0).toBe(normalizeVolume(10, 30));

    expect(fillVisualAttrFromHot(buf, a, { fromAbs: 0, visibleCount: 4, y: Y }, PALETTE)).toBe(4);
    const b0 = a.f32[5] ?? Number.NaN;
    expect(b0).toBe(normalizeVolume(10, 40));
    expect(a0).not.toBe(b0);
  });
});

describe('hot fill ≡ CPU reference fill (bit parity)', () => {
  it('writes identical float32 and color/flag words for identical inputs', () => {
    const buf = hot();
    buf.publish(parityBars(), { hotFromIndex: HOT_FROM });

    const out = copyOutBars(buf, { fromAbs: HOT_FROM, count: 8 });
    expect(out).not.toBeNull();
    if (!out) return;
    const maxVol = Math.max(...out.bars.map((b) => b.volume ?? 0));
    const src: VisualSourceBar[] = out.bars.map((bar, i) => ({
      x: i,
      open: bar.open ?? 0,
      high: bar.high ?? 0,
      low: bar.low ?? 0,
      close: bar.close ?? 0,
      volume: bar.volume ?? 0,
      flags: bar.closed === false ? BAR_FLAG_FORMING : BAR_FLAG_CLOSED,
    }));

    const hotVis = allocateVisualAttr(8);
    const refVis = allocateVisualAttr(8);
    if (!hotVis || !refVis) throw new Error('allocate');

    const nHot = fillVisualAttrFromHot(
      buf,
      hotVis,
      { fromAbs: HOT_FROM, visibleCount: 8, y: Y },
      PALETTE,
    );
    const nRef = fillVisualAttr({
      buf: refVis,
      bars: src,
      y: Y,
      palette: PALETTE,
      maxVolume: maxVol,
    });
    expect(nHot).toBe(8);
    expect(nRef).toBe(8);

    for (let i = 0; i < 8; i++) {
      const w = i * WORDS;
      for (let k = 0; k < 6; k++) {
        expect(hotVis.f32[w + k] ?? Number.NaN).toBe(refVis.f32[w + k] ?? Number.NaN);
      }
      expect(hotVis.u32[w + (VISUAL_OFFSET.color >> 2)] ?? 0).toBe(
        refVis.u32[w + (VISUAL_OFFSET.color >> 2)] ?? 0,
      );
      expect(hotVis.u32[w + (VISUAL_OFFSET.flags >> 2)] ?? 0).toBe(
        refVis.u32[w + (VISUAL_OFFSET.flags >> 2)] ?? 0,
      );
    }
  });

  it('drops the same bars past capacity, without wrapping', () => {
    const buf = hot();
    const many: HotBarTicks[] = [];
    for (let i = 0; i < 100; i++) {
      many.push(mk(60 * (i + 1), 100 + (i % 7), 106 + (i % 5), 95 + (i % 3), 101 + (i % 4), i + 1));
    }
    buf.publish(many, { hotFromIndex: 0 });

    const out = copyOutBars(buf, { fromAbs: 0, count: 100 });
    expect(out).not.toBeNull();
    if (!out) return;

    // allocateVisualAttr(5) → capacity 69 (< 100): both fills must keep the
    // first 69 records — the hot fill's volume window is that clipped set,
    // so the reference must normalize over the same records (in the overlay
    // path capacity ≥ visibleCount, so the windows always coincide).
    const hotVis = allocateVisualAttr(5);
    const refVis = allocateVisualAttr(5);
    if (!hotVis || !refVis) throw new Error('allocate');
    const capacity = hotVis.capacity;
    expect(capacity).toBeLessThan(100);

    const nHot = fillVisualAttrFromHot(
      buf,
      hotVis,
      { fromAbs: 0, visibleCount: 100, y: Y },
      PALETTE,
    );
    const src: VisualSourceBar[] = out.bars.map((bar, i) => ({
      x: i,
      open: bar.open ?? 0,
      high: bar.high ?? 0,
      low: bar.low ?? 0,
      close: bar.close ?? 0,
      volume: bar.volume ?? 0,
      flags: bar.closed === false ? BAR_FLAG_FORMING : BAR_FLAG_CLOSED,
    }));
    const maxVol = Math.max(...out.bars.slice(0, capacity).map((b) => b.volume ?? 0));
    const nRef = fillVisualAttr({
      buf: refVis,
      bars: src,
      y: Y,
      palette: PALETTE,
      maxVolume: maxVol,
    });

    expect(nHot).toBe(capacity);
    expect(nRef).toBe(capacity);
    expect(hotVis.f32[(capacity - 1) * WORDS] ?? Number.NaN).toBe(capacity - 1);
    expect(hotVis.f32[0] ?? Number.NaN).toBe(0); // record 0 intact — a wrap of item 69 would have overwritten it
    for (let k = 0; k < 6; k++) {
      expect(hotVis.f32[(capacity - 1) * WORDS + k] ?? Number.NaN).toBe(
        refVis.f32[(capacity - 1) * WORDS + k] ?? Number.NaN,
      );
    }
  });
});

describe('overlayViewport (LWC anchor math)', () => {
  it('places every record where LWC puts its logical bar, fractionals included', () => {
    const geom = overlayViewport({ from: 100.7, to: 140.2 }, 790);
    expect(geom).not.toBeNull();
    if (!geom) return;
    expect(geom.fromBase).toBe(100);
    expect(geom.visibleCount).toBe(41); // ceil(140.2) − 100
    expect(geom.barSpacing).toBeCloseTo(790 / 39.5, 9);
    expect(geom.rightEdgeIndex).toBeCloseTo(40.2, 9);

    // Parity identity: GL distance-from-right for bar b equals LWC's own
    // (to − b) · spacing — the definition of "aligned by construction".
    for (let b = geom.fromBase; b < geom.fromBase + geom.visibleCount; b++) {
      const gl = (geom.rightEdgeIndex - (b - geom.fromBase)) * geom.barSpacing;
      const lwc = (140.2 - b) * geom.barSpacing;
      expect(Math.abs(gl - lwc)).toBeLessThan(1e-9);
    }
  });

  it('anchors the right edge in LWC’s margin without shifting bars', () => {
    const buf = hot();
    const bars: HotBarTicks[] = [];
    for (let i = 0; i < 10; i++) bars.push(mk(60 * (i + 1), 100, 105, 98, 102, i + 1));
    buf.publish(bars, { hotFromIndex: 90 }); // series ends at index 100

    // Range reaches to 105 — five margin slots LWC keeps empty.
    const geom = overlayViewport({ from: 90, to: 105 }, 300);
    expect(geom).not.toBeNull();
    if (!geom) return;
    expect(geom.fromBase).toBe(90);
    expect(geom.visibleCount).toBe(15);
    expect(geom.barSpacing).toBe(20);
    expect(geom.rightEdgeIndex).toBe(15);

    // The fill yields only the ten bars that exist; the margin tail is
    // absent, but every present record keeps its LWC anchor.
    const vis = allocateVisualAttr(15);
    if (!vis) throw new Error('allocate');
    const n = fillVisualAttrFromHot(
      buf,
      vis,
      { fromAbs: geom.fromBase, visibleCount: geom.visibleCount, y: Y },
      PALETTE,
    );
    expect(n).toBe(10);
    for (let i = 0; i < 10; i++) {
      const b = geom.fromBase + i;
      const gl = (geom.rightEdgeIndex - i) * geom.barSpacing;
      const lwc = (105 - b) * geom.barSpacing;
      expect(gl).toBe(lwc);
      expect(vis.f32[i * WORDS] ?? Number.NaN).toBe(i);
    }
  });

  it('rejects degenerate, non-finite, and absurd ranges', () => {
    expect(overlayViewport(null, 100)).toBeNull();
    expect(overlayViewport(undefined, 100)).toBeNull();
    expect(overlayViewport({ from: 1, to: 1 }, 100)).toBeNull();
    expect(overlayViewport({ from: 5, to: 1 }, 100)).toBeNull();
    expect(overlayViewport({ from: Number.NaN, to: 5 }, 100)).toBeNull();
    expect(overlayViewport({ from: 1, to: Number.POSITIVE_INFINITY }, 100)).toBeNull();
    expect(overlayViewport({ from: 0, to: MAX_OVERLAY_BARS + 1 }, 100)).toBeNull();
    expect(overlayViewport({ from: 0, to: MAX_OVERLAY_BARS }, 100)).not.toBeNull();
    expect(overlayViewport({ from: 0, to: 50 }, 0)).toBeNull();
    expect(overlayViewport({ from: 0, to: 50 }, -10)).toBeNull();
    expect(overlayViewport({ from: 0, to: 50 }, Number.NaN)).toBeNull();
    expect(overlayViewport({ from: 0, to: 50 }, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('overlay activation gate (explicit rung only)', () => {
  afterEach(() => {
    setHpGpuMode('auto');
  });

  function trapDeps(appended: { n: number }): GpuOverlayDeps {
    return {
      host: {
        appendChild: () => {
          appended.n++;
        },
      } as unknown as HTMLElement,
      getPriceChart: () => null,
      getCandleSeries: () => null,
      getPricePaneEl: () => null,
      getBarsLength: () => 0,
      getHotBuffer: () => null,
      fallbackPalette: PALETTE,
    };
  }

  /** Make the isolation probe answer "webgl2 available" for this scope. */
  function withProbeableWebgl2<T>(fn: () => T): T {
    const hadDoc = 'document' in globalThis;
    const prev = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({
        setAttribute: () => {},
        style: {},
        remove: () => {},
        getContext: () => ({}), // truthy → probe says yes; the factory
        // rejects the fake context → renderer null → safe no-op fallback.
      }),
    };
    try {
      return fn();
    } finally {
      if (hadDoc) (globalThis as { document?: unknown }).document = prev;
      else delete (globalThis as { document?: unknown }).document;
    }
  }

  it('stays dormant on the default auto flag even with WebGL2 probeable', () => {
    setHpGpuMode('auto');
    const appended = { n: 0 };
    withProbeableWebgl2(() => {
      const stop = startGpuOverlay(trapDeps(appended));
      expect(typeof stop).toBe('function');
      stop();
    });
    expect(appended.n).toBe(0);
  });

  it('stays dormant on the forced webgl2 flag when no context probes', () => {
    setHpGpuMode('webgl2');
    const appended = { n: 0 };
    // Bun: the document stub's canvas has no getContext → probe says no.
    const stop = startGpuOverlay(trapDeps(appended));
    expect(typeof stop).toBe('function');
    stop();
    expect(appended.n).toBe(0);
  });

  it('engages only when the flag is forced and a context probes', () => {
    setHpGpuMode('webgl2');
    const appended = { n: 0 };
    withProbeableWebgl2(() => {
      const stop = startGpuOverlay(trapDeps(appended));
      expect(typeof stop).toBe('function');
      expect(() => stop()).not.toThrow();
    });
    expect(appended.n).toBe(1); // canvas mounted → the rung engaged
  });
});

describe('parseCssColorToRgb (palette source)', () => {
  it('parses the color forms LWC and the theme emit', () => {
    expect(parseCssColorToRgb('#3DDC97')).toBe(0x3ddc97);
    expect(parseCssColorToRgb('#abc')).toBe(0xaabbcc);
    expect(parseCssColorToRgb('rgb(240, 113, 120)')).toBe(0xf07178);
    expect(parseCssColorToRgb('rgb(240 113 120)')).toBe(0xf07178);
    // Series colors arrive premultiplied by alpha — the RGB bytes are the palette.
    expect(parseCssColorToRgb('rgba(61, 220, 151, 0.76)')).toBe(0x3ddc97);
  });

  it('clamps out-of-range channels and rejects junk', () => {
    expect(parseCssColorToRgb('rgb(300, -5, 12)')).toBe(0xff000c);
    expect(parseCssColorToRgb('rgb(a, b, c)')).toBeNull();
    expect(parseCssColorToRgb('transparent')).toBeNull();
    expect(parseCssColorToRgb('#12345')).toBeNull();
    expect(parseCssColorToRgb('')).toBeNull();
    expect(parseCssColorToRgb(null)).toBeNull();
    expect(parseCssColorToRgb(undefined)).toBeNull();
  });
});
