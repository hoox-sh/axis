/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * MCP HP-plane capabilities: `hp.get` (state + verdict) and `hp.sample`
 * (windowed liveness).
 *
 * The HP flags live in tab-local `localStorage` and the isolation probe is a
 * runtime property — neither crosses the sanitized app snapshot, so an agent
 * asking *"is HP actually working in this tab?"* used to get nothing. These
 * two views answer that honestly and read-only:
 *
 * - {@link hpView} reports the flags, the cross-origin isolation probe, the
 *   plan-format HUD chip (`hp · sab+gpu`), the **actual** hot-ring runtime
 *   (window bounds, the same `getBarsLength() === hotFrom + hotCount`
 *   alignment the GPU overlay guard checks, seq/closedUpto progress), the
 *   wire state, the overlay canvas's DOM state, and a verdict code —
 *   `kill` / `off` / `awaiting` / `copy` / `fallback` / `degraded` /
 *   `misaligned` / `live`.
 * - {@link hpSampleView} measures a bounded window: rAF frame cadence, the
 *   ring's `seq` delta (ingest publishes actually landing), `closedUpto`
 *   progress, and the chart's append/tail deltas. A snapshot says "the ring
 *   is aligned"; the sample says "the ring is *moving*".
 *
 * Everything is read: no flags are written, no wire is started, no SAB is
 * allocated. Secret hygiene is inherited — nothing here touches engine keys.
 *
 * @module mcp/hp
 */

import { isolationProbe } from '../hp/capabilities';
import { hpGpuMode, hpSabMode, isHpDisabled, isHpEnabled } from '../hp/feature-flag';
import { hpChip } from '../hp/hud';
import { copyOutTail } from '../hp/paint/copy-out-lwc';
import { paintLatencyStats, type PaintLatencyStats } from '../chart/paint-latency';
import { getLiveHotBuffer, streamWireState } from '../streams/stream-live';
import { store } from '../store';

/** Sample window bounds (one invoke stays far below the bridge's 20 s cap). */
const WINDOW_MIN_MS = 100;
const WINDOW_MAX_MS = 10_000;
const WINDOW_DEFAULT_MS = 1_000;

export type HpVerdictCode =
  'kill' | 'off' | 'awaiting' | 'copy' | 'fallback' | 'degraded' | 'misaligned' | 'live';

export type HpRingView = {
  present: boolean;
  /** Writer-side series length (`hotFrom + hotCount`) — its own index space,
   * not the chart's. */
  seriesLen: number | null;
  hotFrom: number | null;
  hotCount: number | null;
  chartBars: number;
  /** Cold page slot (§9.2): the range the GPU overlay paints outside hot. */
  page: { active: boolean; from: number | null; count: number | null };
  /** Newest bar time in the published ring slot (unix seconds). */
  tailTime: number | null;
  chartTailTime: number;
  /** The GPU overlay's alignment: the ring's newest bar is the chart's
   * newest bar and the window fits inside the chart (`hotCount ≤ chartBars`). */
  aligned: boolean;
  seq: number | null;
  closedUpto: number | null;
  epoch: number | null;
  priceScale: number | null;
  /** Ring capacity and SAB size (bytes) — the memory actually pinned. */
  cap: number | null;
  sabBytes: number | null;
};

export type HpView = {
  flags: { enabled: boolean; killSwitch: boolean; gpu: string; sab: string };
  isolation: { isolated: boolean; sab: boolean; webgl2: boolean; webgpu: boolean };
  chip: ReturnType<typeof hpChip>;
  session: { rungCap: number | null };
  ring: HpRingView;
  wire: { started: boolean; open: boolean; failures: number; cooledDown: boolean };
  chart: { bars: number; tailTime: number };
  paint: {
    gpuMode: string;
    /** DOM canvas `data-axis-gpu-overlay`; `null` painting in non-DOM envs. */
    canvas: boolean;
    painting: boolean | null;
    width: number;
    height: number;
    /** Applied live tick → first frame that can show it (plan §14.2). */
    latency: PaintLatencyStats;
  };
  verdict: { code: HpVerdictCode; message: string };
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = num(v);
  if (n === null) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Session rung cap from a prior SAB OOM (`axis.hp.rung`), if any. */
function readSessionRung(): number | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const v = sessionStorage.getItem('axis.hp.rung');
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function chartTailTime(): number {
  const bars = store.bars;
  const last = bars.length ? bars[bars.length - 1] : undefined;
  return last && Number.isFinite(last.time) ? last.time : 0;
}

function ringView(): HpRingView {
  const hot = getLiveHotBuffer();
  const chartBars = store.bars.length;
  const chartTail = chartTailTime();
  if (!hot) {
    return {
      present: false,
      seriesLen: null,
      hotFrom: null,
      hotCount: null,
      chartBars,
      page: { active: false, from: null, count: null },
      tailTime: null,
      chartTailTime: chartTail,
      aligned: false,
      seq: null,
      closedUpto: null,
      epoch: null,
      priceScale: null,
      cap: null,
      sabBytes: null,
    };
  }
  const c = hot.control;
  const hotFrom = num(c.hotFromIndex);
  const hotCount = num(c.hotCount);
  const seriesLen = hotFrom !== null && hotCount !== null ? hotFrom + hotCount : null;
  const rawTail = copyOutTail(hot, 1)?.bars[0]?.time;
  const tailTime = num(rawTail);
  const pageActive = hot.pageActive;
  return {
    present: true,
    seriesLen,
    hotFrom,
    hotCount,
    chartBars,
    page: {
      active: pageActive,
      from: pageActive ? num(c.pageFromIndex) : null,
      count: pageActive ? num(c.pageCount) : null,
    },
    tailTime,
    chartTailTime: chartTail,
    aligned:
      tailTime !== null &&
      tailTime === chartTail &&
      hotCount !== null &&
      hotCount > 0 &&
      chartBars >= hotCount,
    seq: num(c.seq),
    closedUpto: num(c.closedUpto),
    epoch: num(hot.epoch),
    priceScale: num(hot.priceScale),
    cap: num(hot.layout?.cap),
    sabBytes: num(hot.sab?.byteLength),
  };
}

/** Overlay canvas DOM state — the honest "is GL painting right now" read. */
function paintView(): HpView['paint'] {
  const gpuMode = hpGpuMode();
  const latency = paintLatencyStats();
  const hasDom = typeof document !== 'undefined' && typeof document.querySelector === 'function';
  if (!hasDom) {
    return { gpuMode, canvas: false, painting: null, width: 0, height: 0, latency };
  }
  const el = document.querySelector('canvas[data-axis-gpu-overlay="1"]');
  if (!el || (el as { tagName?: string }).tagName !== 'CANVAS') {
    return { gpuMode, canvas: false, painting: null, width: 0, height: 0, latency };
  }
  const canvas = el as HTMLCanvasElement;
  const painting = canvas.style.display !== 'none';
  return {
    gpuMode,
    canvas: true,
    painting,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    latency,
  };
}

function verdictOf(
  chip: ReturnType<typeof hpChip>,
  ring: HpRingView,
  wire: { started: boolean; open: boolean },
  probe: { isolated: boolean; sab: boolean },
  paint: HpView['paint'],
): { code: HpVerdictCode; message: string } {
  if (isHpDisabled()) {
    return {
      code: 'kill',
      message: 'axis.engine.hp.disabled=1 wins — the JSON /ws/live → LWC path stays (HP-0).',
    };
  }
  if (!isHpEnabled()) {
    return {
      code: 'off',
      message: 'HP is opt-in and off — default HP-0 (JSON decode on main, LWC paints).',
    };
  }
  if (ring.present) {
    if (!ring.aligned) {
      const why =
        ring.hotCount !== null && ring.hotCount > ring.chartBars
          ? `the ring window (${ring.hotCount} bars) is larger than the chart (${ring.chartBars} bars)`
          : `ring tail ${ring.tailTime ?? 'n/a'} ≠ chart tail ${ring.chartTailTime}`;
      return {
        code: 'misaligned',
        message: `Hot ring is not the chart's tail window: ${why} — the GPU overlay clears every frame (LWC keeps painting) until both paths converge.`,
      };
    }
    if (paint.painting) {
      return {
        code: 'live',
        message: `Hot ring covers the chart's last ${ring.hotCount} bars (seq ${ring.seq}) and the WebGL2 overlay is painting (${paint.width}×${paint.height}).`,
      };
    }
    if (paint.gpuMode !== 'webgl2') {
      // `webgpu` (forced or auto-selected) has no painter — HP-4 is reserved.
      // Say so explicitly: otherwise "dormant" reads like the overlay *could*
      // engage on this rung.
      const noPainter =
        chip.renderer === 'webgpu'
          ? ' WebGPU has no painter yet (HP-4 reserved) — LWC paints.'
          : '';
      return {
        code: 'live',
        message: `Hot ring covers the chart's last ${ring.hotCount} bars (seq ${ring.seq}); overlay dormant — axis.engine.hp.gpu is '${paint.gpuMode}' (forced 'webgl2' engages it).${noPainter}`,
      };
    }
    return {
      code: 'live',
      message: `Hot ring covers the chart's last ${ring.hotCount} bars (seq ${ring.seq}); overlay canvas not painting yet — ${
        ring.page.active
          ? `cold page covers [${ring.page.from}, +${ring.page.count}) and the viewport fill is catching up`
          : 'viewport outside the ring window and no cold page yet (the pager re-requests while the viewport stays cold)'
      } or the first sized frame pending.`,
    };
  }
  if (chip.rung === 1) {
    if (hpSabMode() === 'off') {
      return {
        code: 'copy',
        message: 'HP-1 by choice: axis.engine.hp.sab=off — transferable copy path, no ring.',
      };
    }
    if (!probe.isolated) {
      return {
        code: 'copy',
        message: 'HP-1 transferable copy: not cross-origin isolated, so no SAB ring can exist.',
      };
    }
    if (!probe.sab) {
      return {
        code: 'copy',
        message: 'HP-1 transferable copy: SharedArrayBuffer unavailable in this browser.',
      };
    }
    return {
      code: 'copy',
      message: 'HP-1 after a session rung clamp (axis.hp.rung) — copy path until the tab reloads.',
    };
  }
  if (!wire.started) {
    return {
      code: 'awaiting',
      message: `HP-${chip.rung} selected but no live wire yet — the hot ring allocates with the wire client (start the live stream).`,
    };
  }
  if (probe.isolated && probe.sab && hpSabMode() !== 'off') {
    return {
      code: 'degraded',
      message: `The wire is up and SAB is allowed, but no hot ring exists at HP-${chip.rung} — the ingest client did not allocate (unexpected; check the console for SAB OOM).`,
    };
  }
  return {
    code: 'fallback',
    message: `HP-${chip.rung} selected but SAB/isolation is unavailable — no hot ring; the copy path carries the chart.`,
  };
}

/** `hp.get` — flags, isolation, chip, ring runtime, overlay DOM + verdict. */
export function hpView(): HpView {
  const probe = isolationProbe();
  const chip = hpChip();
  const ring = ringView();
  const wireState = streamWireState();
  const wire = {
    started: wireState !== null,
    open: wireState?.open ?? false,
    failures: num(wireState?.failures) ?? 0,
    cooledDown: wireState?.cooledDown ?? false,
  };
  const paint = paintView();
  return {
    flags: {
      enabled: isHpEnabled(),
      killSwitch: isHpDisabled(),
      gpu: hpGpuMode(),
      sab: hpSabMode(),
    },
    isolation: {
      isolated: probe.isolated,
      sab: probe.sab,
      webgl2: probe.webgl2,
      webgpu: probe.webgpu,
    },
    chip,
    session: { rungCap: readSessionRung() },
    ring,
    wire,
    chart: { bars: store.bars.length, tailTime: chartTailTime() },
    paint,
    verdict: verdictOf(chip, ring, wire, probe, paint),
  };
}

type RingStats = {
  present: boolean;
  seq: number | null;
  closedUpto: number | null;
  seriesLen: number | null;
  aligned: boolean;
};

function ringStats(): { ring: RingStats; bars: number; tail: number } {
  const r = ringView();
  return {
    ring: {
      present: r.present,
      seq: r.seq,
      closedUpto: r.closedUpto,
      seriesLen: r.seriesLen,
      aligned: r.aligned,
    },
    bars: r.chartBars,
    tail: chartTailTime(),
  };
}

function rafAvailable(): boolean {
  return typeof requestAnimationFrame === 'function';
}

/**
 * Count rAF frames over `windowMs`. Without rAF (headless/tests) the window
 * elapses on a timer with `frames: null`; a hidden tab freezes rAF, so a
 * safety timer resolves anyway with whatever was counted (0 → the note says
 * so) instead of hanging the invoke.
 */
function countFrames(windowMs: number): Promise<{ frames: number | null; elapsedMs: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    if (!rafAvailable()) {
      setTimeout(() => resolve({ frames: null, elapsedMs: Date.now() - t0 }), windowMs);
      return;
    }
    let frames = 0;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve({ frames, elapsedMs: Date.now() - t0 });
    };
    const tick = (): void => {
      frames += 1;
      if (Date.now() - t0 >= windowMs) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(finish, windowMs + 500);
  });
}

export type HpSampleView = {
  windowMs: number;
  elapsedMs: number;
  /** rAF frames observed; `null` where rAF does not exist (tests/Node). */
  frames: number | null;
  fps: number | null;
  ring: null | {
    presentAtStart: boolean;
    presentAtEnd: boolean;
    /** Ring publishes (seq advances) during the window. */
    seqDelta: number | null;
    /** Engine `closed_upto` progress in seconds — the stamp is a time, not
     * an index; `0` when the engine omits it. */
    closedUptoTimeDelta: number | null;
    alignedAtStart: boolean;
    alignedAtEnd: boolean;
    seriesLenAtEnd: number | null;
  };
  chart: { barsDelta: number; tailDeltaSec: number };
  /** Applied tick → frame, over the rolling paint-latency window. */
  paint: PaintLatencyStats;
  note: string | null;
};

/**
 * `hp.sample` — measure HP liveness over a bounded window: ring publish
 * cadence (`seq` delta), closed-bar progress, rAF frame rate, and how far
 * the chart advanced. Defaults to 1 s, clamped to [100 ms, 10 s].
 */
export async function hpSampleView(payload: unknown = {}): Promise<HpSampleView> {
  const p = (payload ?? {}) as { windowMs?: unknown };
  const want = clampInt(p.windowMs, WINDOW_MIN_MS, WINDOW_MAX_MS, WINDOW_DEFAULT_MS);
  const before = ringStats();
  const { frames, elapsedMs } = await countFrames(want);
  const after = ringStats();

  const bothRings = before.ring.present && after.ring.present;
  const seqDelta =
    bothRings && before.ring.seq !== null && after.ring.seq !== null
      ? after.ring.seq - before.ring.seq
      : null;
  const closedDelta =
    bothRings && before.ring.closedUpto !== null && after.ring.closedUpto !== null
      ? after.ring.closedUpto - before.ring.closedUpto
      : null;

  let note: string | null = null;
  if (frames === null) note = 'requestAnimationFrame unavailable in this environment.';
  else if (frames === 0) note = 'No frames in window — tab hidden or rAF paused.';
  else if (seqDelta === 0 && after.ring.present)
    note = 'Ring idle — no publishes in window (no live ticks).';

  return {
    windowMs: want,
    elapsedMs,
    frames,
    fps:
      frames === null
        ? null
        : elapsedMs > 0
          ? Math.round((frames * 1000 * 100) / elapsedMs) / 100
          : 0,
    ring: {
      presentAtStart: before.ring.present,
      presentAtEnd: after.ring.present,
      seqDelta,
      closedUptoTimeDelta: closedDelta,
      alignedAtStart: before.ring.aligned,
      alignedAtEnd: after.ring.aligned,
      seriesLenAtEnd: after.ring.seriesLen,
    },
    chart: {
      barsDelta: after.bars - before.bars,
      tailDeltaSec: after.tail - before.tail,
    },
    paint: paintLatencyStats(),
    note,
  };
}
