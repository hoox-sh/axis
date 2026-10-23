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
  /** `hotFromIndex + hotCount` — the series length the overlay guard compares. */
  seriesLen: number | null;
  hotFrom: number | null;
  hotCount: number | null;
  chartBars: number;
  /** The exact GPU-overlay guard: `store.bars.length === seriesLen`. */
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
  if (!hot) {
    return {
      present: false,
      seriesLen: null,
      hotFrom: null,
      hotCount: null,
      chartBars,
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
  return {
    present: true,
    seriesLen,
    hotFrom,
    hotCount,
    chartBars,
    aligned: seriesLen !== null && seriesLen === chartBars,
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
  const hasDom = typeof document !== 'undefined' && typeof document.querySelector === 'function';
  if (!hasDom) {
    return { gpuMode, canvas: false, painting: null, width: 0, height: 0 };
  }
  const el = document.querySelector('canvas[data-axis-gpu-overlay="1"]');
  if (!el || (el as { tagName?: string }).tagName !== 'CANVAS') {
    return { gpuMode, canvas: false, painting: null, width: 0, height: 0 };
  }
  const canvas = el as HTMLCanvasElement;
  const painting = canvas.style.display !== 'none';
  return {
    gpuMode,
    canvas: true,
    painting,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
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
      return {
        code: 'misaligned',
        message: `Hot ring window ${ring.seriesLen} bars ≠ chart ${ring.chartBars} bars — the GPU overlay guard clears every frame (LWC keeps painting) until a full snapshot re-seeds the ring.`,
      };
    }
    if (paint.painting) {
      return {
        code: 'live',
        message: `Hot ring aligned at ${ring.chartBars} bars (seq ${ring.seq}) and the WebGL2 overlay is painting (${paint.width}×${paint.height}).`,
      };
    }
    if (paint.gpuMode !== 'webgl2') {
      return {
        code: 'live',
        message: `Hot ring aligned at ${ring.chartBars} bars (seq ${ring.seq}); overlay dormant — axis.engine.hp.gpu is '${paint.gpuMode}' (forced 'webgl2' engages it).`,
      };
    }
    return {
      code: 'live',
      message: `Hot ring aligned at ${ring.chartBars} bars (seq ${ring.seq}); overlay canvas not painting yet (first sized frame pending or the probe bailed).`,
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
    closedUptoDelta: number | null;
    alignedAtStart: boolean;
    alignedAtEnd: boolean;
    seriesLenAtEnd: number | null;
  };
  chart: { barsDelta: number; tailDeltaSec: number };
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
      closedUptoDelta: closedDelta,
      alignedAtStart: before.ring.aligned,
      alignedAtEnd: after.ring.aligned,
      seriesLenAtEnd: after.ring.seriesLen,
    },
    chart: {
      barsDelta: after.bars - before.bars,
      tailDeltaSec: after.tail - before.tail,
    },
    note,
  };
}
