// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AXIS Connection HUD — scanline instruments (Live, Last, Compose, diagnostics)
 * plus an expanded measured-metrics mode.
 *
 * Derived via {@link deriveHud} from engine plugin + endpoint + telemetry.
 * Chips live in the status-bar scanline. `telemetry.hud.compact` (default) is
 * the classic scanline (Live, Last, Diagnostics, Compose / eng path chips).
 * Expanded (`compact` false) shows measured run / paint latency, network path,
 * and plane states. Click or keyboard opens one inspector dialog above the
 * rail — never hover.
 *
 * | Chip | Values |
 * |------|--------|
 * | ENG  | local \| remote |
 * | RUN  | browser \| server \| worker |
 * | MODE | interpret \| compile \| auto |
 * | PATH | WS \| REST (hidden for browser-local) |
 * | ONC  | on-chain proxy (only when probed / error / active) |
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { store, setActivePlugin, setDataSourcePanelOpen } from '../store';
import { Popover } from './Popover';
import type { FeedSubscription } from '../store/types';
import { useNow } from './clock';
import type { PlaneTelemetry } from '../store/types';
import { formatLatency, formatTickAge, latencySampleStats } from './telemetry';
import {
  paintLatencyStats,
  type PaintLatencyStats,
} from '../chart/paint-latency';
import {
  composeCaption,
  deriveHud,
  feedChipMeta,
  feedChipView,
  hudChipHelp,
  lastTickForSymbol,
  liveBadgeTone,
  liveBadgeWord,
  liveIndicatorTitle,
  reduceHudInspector,
  type HudChipId,
  type HudSnapshot,
} from './hud-model';
import { readLiveArm } from './live-arm';
import { displayedLastPrice } from './extras/quote';
import { barPlane } from '../stores/bars';
import { defaultStreamForSource } from '../streams/catalog';
import { getActiveEngineConfig } from '../plugins/active';
import { currentSeriesKey } from '../engine/market-identity';
import { FALLBACK_MAJORS } from '../data/symbol-catalog';

function useHudSnapshot(): () => HudSnapshot {
  return createMemo(() => {
    const engineId = store.engine || store.activePlugins?.engine || 'server';
    const cfg = getActiveEngineConfig();
    const tel = store.telemetry?.engine;
    return deriveHud({
      engineId,
      endpoint: store.endpoint || '',
      modeRaw: cfg['mode'],
      preferWs: cfg['preferWs'] !== false,
      engineTransport: tel?.transport,
      engineState: tel?.state,
      latencyMs: tel?.latencyMs ?? store.lastRunMs,
      detail: tel?.detail,
      error: tel?.error,
    });
  });
}

// ── Click inspector (never hover) ─────────────────────────────────────

function HudInspectorPanel(props: {
  chip: HudChipId;
  snap: HudSnapshot;
  onClose: () => void;
  /** Chip-specific live rows (status, progress, tier) — the only per-chip facts here. */
  meta?: string[];
}) {
  const help = () => hudChipHelp(props.chip, props.snap);
  return (
    <>
      <div class="flex items-start justify-between gap-2 mb-1.5">
        <div class="text-[11px] font-medium text-text tracking-tight">{help().title}</div>
        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1.5 py-0 text-[10px] text-text-faint"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
        >
          ×
        </button>
      </div>
      <p class="text-[11px] text-text-dim font-mono whitespace-pre-wrap leading-relaxed">
        {help().body}
      </p>
      <div class="mt-2 pt-1.5 border-t border-border-soft grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-text-faint">
        <For each={props.meta ?? []}>
          {(m) => (
            <span class="col-span-2 truncate" title={m}>
              {m}
            </span>
          )}
        </For>
        <Show when={props.snap.endpoint}>
          <span class="col-span-2 truncate" title={props.snap.endpoint}>
            ep {props.snap.endpoint}
          </span>
        </Show>
        <Show when={props.snap.error}>
          <span class="col-span-2 text-red truncate">{props.snap.error}</span>
        </Show>
      </div>
      <p class="mt-1.5 text-[10px] text-text-faint">Click a chip for details · Esc closes</p>
    </>
  );
}

function useHudInspector() {
  const [openChip, setOpenChip] = createSignal<HudChipId | null>(null);
  const toggle = (id: HudChipId) => {
    setOpenChip((cur) => reduceHudInspector(cur, { type: 'toggle', id }));
  };
  const close = () => {
    setOpenChip((cur) => reduceHudInspector(cur, { type: 'close' }));
  };
  return { openChip, toggle, close };
}

/** CSS-only metric glyph keyed by instrument. */
function HudMetricIcon(props: { kind: 'live' | 'last' | 'compose' | 'diag' | 'plane' }) {
  return <span class={`axis-hud-metric axis-hud-metric--${props.kind}`} aria-hidden="true" />;
}

// ── Chips ─────────────────────────────────────────────────────────────

/**
 * Single shell for every HUD chip: metric icon + label + value. Click/keyboard
 * opens the inspector dialog; hover never does. Visual variants travel
 * through class props (`shellClass`, `labelClass`, `valueClass`, `dotClass`)
 * so TickPulse and the Live control share this instead of re-implementing
 * the wiring. Truncated values get their full text via `title`.
 */
function ChipShell(props: {
  id: HudChipId;
  label: string;
  value: string;
  state?: 'idle' | 'ok' | 'warn' | 'err' | 'load';
  /** Extra classes on the outer capsule (e.g. live-button tones). */
  shellClass?: string;
  /** Extra classes on the label span (e.g. `is-word` for non-acronyms). */
  labelClass?: string;
  /** Extra classes on the value span (e.g. tick direction color). */
  valueClass?: string;
  /** Explicit dot classes; when omitted the dot follows `state`. */
  dotClass?: string;
  /** Full text for truncated values (native tooltip). */
  title?: string;
  inspector: ReturnType<typeof useHudInspector>;
  snap: () => HudSnapshot;
  extra?: string;
  testId?: string;
  /** Chip-specific live rows for the inspector footer. */
  meta?: string[];
  /** CSS metric glyph; defaults to a state dot. */
  metric?: 'live' | 'last' | 'compose' | 'diag' | 'plane';
}) {
  const [anchor, setAnchor] = createSignal<HTMLButtonElement | undefined>();
  const dot = () => {
    if (props.dotClass !== undefined) return props.dotClass;
    switch (props.state) {
      case 'ok':
        return 'is-ok';
      case 'warn':
        return 'is-warn';
      case 'load':
        return 'is-warn axis-live-dot--reconnect';
      case 'err':
        return 'is-err';
      default:
        return '';
    }
  };
  const active = () => props.inspector.openChip() === props.id;

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        class={`axis-status-capsule relative ${props.shellClass ?? ''} ${
          active() ? 'is-active' : ''
        }`}
        data-testid={props.testId || `axis-hud-${props.id}`}
        data-hud-chip={props.id}
        data-hud-state={props.state || 'idle'}
        title={props.title}
        aria-expanded={active()}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation();
          props.inspector.toggle(props.id);
        }}
      >
        <Show
          when={props.metric}
          fallback={<span class={`axis-live-dot ${dot()}`} aria-hidden="true" />}
        >
          {(m) => <HudMetricIcon kind={m()} />}
        </Show>
        <span class={`axis-status-capsule-code ${props.labelClass ?? ''}`}>{props.label}</span>
        <Show when={props.value !== ''}>
          <span
            class={`axis-status-capsule-val ${
              props.state === 'load' ? 'text-orange' : ''
            } ${props.valueClass ?? ''}`}
          >
            {props.value}
          </span>
        </Show>
        <Show when={props.extra}>
          <span class="text-[10px] font-mono text-text-faint tabular-nums flex-shrink-0">
            {props.extra}
          </span>
        </Show>
      </button>
      <Popover
        open={active()}
        anchor={anchor()}
        onClose={() => props.inspector.close()}
        width={328}
        side="top"
        role="dialog"
        label={hudChipHelp(props.id, props.snap()).title}
        testId={active() ? 'axis-hud-info' : undefined}
        class="axis-hud-info w-[min(320px,calc(100vw-24px))] text-left"
      >
        <HudInspectorPanel
          chip={props.id}
          snap={props.snap()}
          meta={props.meta}
          onClose={() => props.inspector.close()}
        />
      </Popover>
    </>
  );
}

function PlaneChip(props: {
  label: string;
  plane: PlaneTelemetry;
  id: HudChipId;
  inspector: ReturnType<typeof useHudInspector>;
  snap: () => HudSnapshot;
}) {
  const t = () => props.plane;
  return (
    <ChipShell
      id={props.id}
      label={props.label}
      value={t().id}
      state={
        t().state === 'error'
          ? 'err'
          : t().state === 'open'
            ? 'ok'
            : t().state === 'connecting' || t().state === 'degraded'
              ? 'load'
              : 'idle'
      }
      metric="plane"
      inspector={props.inspector}
      snap={props.snap}
      testId={`axis-hud-${props.id}`}
    />
  );
}

/**
 * Engine-owned feed status chip (F-18). Renders only while a subscription
 * exists for the current chart series — the default (no stream path) shows
 * nothing, so existing HUD behavior is unchanged.
 *
 * The chip answers *where the data comes from* and *how fresh it is*: a live
 * feed reads `live` (or `live·unverified` when only the engine's own copy
 * confirmed the close), and a feed that never came up keeps its state word
 * plus the time it has been stuck. The click inspector lists the facts
 * behind it — state, freshness, verification tier, engine hop and series.
 */
function FeedChip(props: {
  inspector: ReturnType<typeof useHudInspector>;
  snap: () => HudSnapshot;
}) {
  const now = useNow();
  const key = () =>
    currentSeriesKey({
      exchange: store.exchange || 'binance',
      symbol: store.symbol || '',
      interval: store.interval || '',
      catalog: FALLBACK_MAJORS,
    });
  const feed = () => store.live.feeds[key()];
  /** Live rows for the info panel: state, freshness, verification tier. */
  const metaOf = (f: FeedSubscription) => {
    const tel = store.telemetry?.engine;
    return feedChipMeta({
      status: f.status,
      verified: f.verified,
      have: f.have,
      need: f.need,
      message: f.message,
      updatedAt: f.updatedAt,
      now: now(),
      engineTransport: tel?.transport,
      engineState: tel?.state,
      engineLatencyMs: tel?.latencyMs,
      engineDetail: tel?.detail,
      seriesKey: f.key || key(),
    });
  };
  return (
    <Show when={feed()}>
      {(f) => {
        const view = () =>
          feedChipView({
            status: f().status,
            verified: f().verified,
            have: f().have,
            need: f().need,
            message: f().message,
            updatedAt: f().updatedAt,
            now: now(),
          });
        return (
          <ChipShell
            id="feed"
            label="feed"
            value={view().value}
            title={view().title}
            state={chipStateFor(view().tone)}
            metric="plane"
            meta={metaOf(f())}
            inspector={props.inspector}
            snap={props.snap}
            testId="axis-hud-feed"
          />
        );
      }}
    </Show>
  );
}

/** Map a feed tone onto the chip shell state. */
function chipStateFor(
  tone: 'live' | 'load' | 'degraded' | 'err' | 'idle',
): 'idle' | 'ok' | 'warn' | 'err' | 'load' {
  switch (tone) {
    case 'live':
      return 'ok';
    case 'err':
      return 'err';
    case 'load':
      return 'load';
    case 'degraded':
      return 'warn';
    default:
      return 'idle';
  }
}

/**
 * Show optional onchain plane when present and active/error.
 * Classic scanline also shows open/degraded; idle/closed stay hidden.
 */
function showOnchainPlane(
  plane: PlaneTelemetry | undefined | null,
  includeQuiet: boolean,
): boolean {
  if (!plane) return false;
  const st = plane.state;
  if (st === 'error' || st === 'connecting') return true;
  if (st === 'open' || st === 'degraded') return includeQuiet;
  return false;
}

/** Little 3-segment meter for latency / network / app health on expanded row. */
function PerfMeter(props: { level: 0 | 1 | 2 | 3; kind: 'latency' | 'network' | 'app' }) {
  return (
    <span
      class={`axis-hud-meter axis-hud-meter--${props.kind}`}
      data-level={props.level}
      aria-hidden="true"
    >
      <span class="axis-hud-meter-seg" data-on={props.level >= 1 ? '1' : '0'} />
      <span class="axis-hud-meter-seg" data-on={props.level >= 2 ? '1' : '0'} />
      <span class="axis-hud-meter-seg" data-on={props.level >= 3 ? '1' : '0'} />
    </span>
  );
}

/** Map a latency ms value onto a 0–3 meter (lower is better). */
function latencyMeterLevel(ms: number | null | undefined): 0 | 1 | 2 | 3 {
  if (ms == null || !Number.isFinite(ms)) return 0;
  if (ms <= 40) return 3;
  if (ms <= 120) return 2;
  if (ms <= 400) return 1;
  return 1;
}

/** Read-only metric capsule for the expanded perf scanline. */
function PerfCapsule(props: {
  label: string;
  value: string;
  title?: string;
  testId?: string;
  state?: 'idle' | 'ok' | 'warn' | 'err' | 'load';
  meter?: { level: 0 | 1 | 2 | 3; kind: 'latency' | 'network' | 'app' };
}) {
  return (
    <span
      class="axis-status-capsule axis-hud-perf-cap"
      data-testid={props.testId}
      data-hud-state={props.state || 'idle'}
      title={props.title}
    >
      <Show when={props.meter} fallback={<HudMetricIcon kind="diag" />}>
        {(m) => <PerfMeter level={m().level} kind={m().kind} />}
      </Show>
      <span class="axis-status-capsule-code is-word">{props.label}</span>
      <span class="axis-status-capsule-val tabular-nums">{props.value}</span>
    </span>
  );
}

function planeChipState(
  st: PlaneTelemetry['state'] | undefined,
): 'idle' | 'ok' | 'warn' | 'err' | 'load' {
  if (st === 'error') return 'err';
  if (st === 'open') return 'ok';
  if (st === 'connecting' || st === 'degraded') return 'load';
  return 'idle';
}

/** Poll paint-latency module stats while the expanded metrics row is open. */
function usePaintLatency(active: () => boolean): () => PaintLatencyStats {
  const [stats, setStats] = createSignal(paintLatencyStats());
  createEffect(() => {
    if (!active()) return;
    setStats(paintLatencyStats());
    const id = globalThis.setInterval(() => setStats(paintLatencyStats()), 500);
    onCleanup(() => globalThis.clearInterval(id));
  });
  return stats;
}

/**
 * Expanded status-bar instruments: measured run / paint latency, network path,
 * and app plane states — each with a little meter. Never invents numbers.
 */
function PerfMetrics(props: {
  snap: () => HudSnapshot;
  inspector: ReturnType<typeof useHudInspector>;
}) {
  const paint = usePaintLatency(() => true);
  const runStats = createMemo(() =>
    latencySampleStats(store.telemetry?.runLatencySamples || []),
  );
  const runLast = () => store.lastRunMs ?? runStats().last ?? props.snap().latencyMs;
  const runValue = () => {
    const last = runLast();
    const p50 = runStats().p50;
    if (last == null && p50 == null) return '—';
    if (p50 != null && runStats().n > 1) {
      return `${formatLatency(last)} · p50 ${formatLatency(p50)}`;
    }
    return formatLatency(last);
  };
  const paintValue = () => {
    const s = paint();
    if (!s.n || s.p50 == null) return '—';
    const p95 = s.p95 != null ? formatLatency(s.p95) : '—';
    const worst = s.max != null ? formatLatency(s.max) : '—';
    return `${formatLatency(s.p50)} / ${p95} / ${worst}`;
  };
  const paintTitle = () => {
    const s = paint();
    if (!s.n) return 'Tick → paint latency — no samples yet';
    return `Tick → paint · n=${s.n} · p50 / p95 / worst${
      s.suspended ? ` · ${s.suspended} suspended` : ''
    }`;
  };
  const pathValue = () => (props.snap().showPath ? props.snap().path : 'in tab');
  const pathLevel = (): 0 | 1 | 2 | 3 => {
    if (!props.snap().showPath) return 2;
    return props.snap().path === 'WS' ? 3 : 2;
  };
  const engPlane = () => store.telemetry?.engine;
  const src = () => store.telemetry?.source;
  const str = () => store.telemetry?.stream;
  const sto = () => store.telemetry?.storage;
  const planeLevel = (st: PlaneTelemetry['state'] | undefined): 0 | 1 | 2 | 3 => {
    if (st === 'open') return 3;
    if (st === 'connecting' || st === 'degraded') return 2;
    if (st === 'error') return 1;
    return 0;
  };

  return (
    <div
      class="axis-hud-perf flex items-center gap-1 flex-nowrap min-w-0"
      data-testid="axis-hud-perf"
    >
      <span class="axis-hud-perf-group" data-testid="axis-hud-perf-latency" title="Latency">
        <PerfCapsule
          label="Run"
          value={runValue()}
          title={
            runStats().n
              ? `Run latency · n=${runStats().n} · last ${formatLatency(runStats().last)} · p50 ${formatLatency(runStats().p50)} · p95 ${formatLatency(runStats().p95)}`
              : 'Run latency — waiting for a script run'
          }
          testId="axis-hud-perf-run"
          state={runStats().n || store.lastRunMs != null ? 'ok' : 'idle'}
          meter={{ level: latencyMeterLevel(runLast()), kind: 'latency' }}
        />
        <PerfCapsule
          label="Paint"
          value={paintValue()}
          title={paintTitle()}
          testId="axis-hud-perf-paint"
          state={paint().n ? 'ok' : 'idle'}
          meter={{ level: latencyMeterLevel(paint().p50), kind: 'latency' }}
        />
      </span>
      <span class="axis-hud-perf-group" data-testid="axis-hud-perf-network" title="Network">
        <PerfCapsule
          label="Path"
          value={pathValue()}
          title={
            props.snap().showPath
              ? `Network path · ${props.snap().path}`
              : 'In-tab engine (no remote hop)'
          }
          testId="axis-hud-perf-path"
          state={props.snap().path === 'WS' ? 'ok' : 'idle'}
          meter={{ level: pathLevel(), kind: 'network' }}
        />
        <Show when={str()}>
          {(p) => (
            <PerfCapsule
              label="Str"
              value={p().state}
              title={`Stream · ${p().name || p().id}`}
              testId="axis-hud-perf-str"
              state={planeChipState(p().state)}
              meter={{ level: planeLevel(p().state), kind: 'network' }}
            />
          )}
        </Show>
      </span>
      <span class="axis-hud-perf-group" data-testid="axis-hud-perf-app" title="App">
        <Show when={engPlane()}>
          {(p) => (
            <PerfCapsule
              label="Eng"
              value={`${p().state}${
                p().latencyMs != null ? ` · ${formatLatency(p().latencyMs)}` : ''
              }`}
              title={`Engine plane · ${p().id} · ${p().transport}`}
              testId="axis-hud-perf-eng"
              state={planeChipState(p().state)}
              meter={{ level: planeLevel(p().state), kind: 'app' }}
            />
          )}
        </Show>
        <Show when={src()}>
          {(p) => (
            <PerfCapsule
              label="Src"
              value={p().state}
              title={`Source · ${p().name || p().id}`}
              testId="axis-hud-perf-src"
              state={planeChipState(p().state)}
              meter={{ level: planeLevel(p().state), kind: 'app' }}
            />
          )}
        </Show>
        <Show when={sto()}>
          {(p) => (
            <PerfCapsule
              label="Sto"
              value={p().state}
              title={`Storage · ${p().name || p().id}`}
              testId="axis-hud-perf-sto"
              state={planeChipState(p().state)}
              meter={{ level: planeLevel(p().state), kind: 'app' }}
            />
          )}
        </Show>
      </span>
      <FeedChip inspector={props.inspector} snap={props.snap} />
    </div>
  );
}

function TickPulse(props: {
  inspector: ReturnType<typeof useHudInspector>;
  snap: () => HudSnapshot;
}) {
  const tick = () => lastTickForSymbol(store.telemetry?.lastTick, store.symbol);
  const now = useNow();
  const lastPrice = () => {
    const t = tick();
    const tickPrice = t && Number.isFinite(t.price) ? t.price : NaN;
    const barOk = !barPlane.symbol || barPlane.symbol === store.symbol;
    const tip = barOk ? barPlane.tip : null;
    const last = tip?.close ?? (barOk && barPlane.length ? barPlane.bars[barPlane.length - 1]?.close : NaN);
    return displayedLastPrice({
      tickPrice,
      barClose: Number.isFinite(last) ? (last as number) : NaN,
      streamState: store.telemetry?.stream?.state,
    });
  };
  const fresh = () => {
    const t = tick();
    return !!t && now() - t.at < 2000;
  };
  const dir = () => tick()?.dir;
  const dirColor = () => {
    const d = dir();
    if (d === 'up') return 'text-accent-2';
    if (d === 'down') return 'text-red';
    return 'text-text-faint';
  };
  const priceText = () => {
    const p = lastPrice();
    if (!Number.isFinite(p)) return '—';
    return p.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };
  const ageTitle = () => {
    const t = tick();
    const p = priceText();
    if (p === '—') return 'Last — waiting for this symbol';
    return t ? `${p} · ${formatTickAge(t.at, now())}` : `${p} · last close`;
  };
  const arm = () => readLiveArm(now());
  return (
    <ChipShell
      id="tick"
      label="Last"
      labelClass="is-word"
      value={priceText()}
      valueClass={`tabular-nums text-right max-w-[7ch] flex-shrink-0 overflow-hidden text-ellipsis ${dirColor()}`}
      shellClass={`axis-hud-chip--last${fresh() ? ' is-fresh' : ''}${
        dir() === 'up' ? ' is-up' : dir() === 'down' ? ' is-down' : ''
      }`}
      metric="last"
      title={ageTitle()}
      state={liveBadgeTone(arm()) === 'live' ? 'ok' : 'idle'}
      inspector={props.inspector}
      snap={props.snap}
      testId="axis-tick-indicator"
    />
  );
}

function LiveBadge(props: {
  inspector: ReturnType<typeof useHudInspector>;
  snap: () => HudSnapshot;
}) {
  const arm = () => readLiveArm();
  const tone = () => liveBadgeTone(arm());
  const label = () => liveBadgeWord(tone());
  const tip = () => liveIndicatorTitle({ ...arm(), startHint: 'Live stream is off' });
  const cls = () => {
    const t = tone();
    if (t === 'live') return 'is-live';
    if (t === 'reconnect') return 'is-reconnect';
    if (t === 'degraded' || t === 'rest') return 'is-degraded';
    if (t === 'offline') return 'is-offline';
    return 'is-idle';
  };
  return (
    <ChipShell
      id="live"
      label={label()}
      labelClass="is-word axis-live-btn-word"
      value=""
      shellClass={`axis-live-btn ${cls()}`}
      metric="live"
      title={tip()}
      inspector={props.inspector}
      snap={props.snap}
      testId="axis-hud-live"
    />
  );
}

function PairingWarn() {
  const warn = createMemo(() => {
    const src = store.source;
    const expected = defaultStreamForSource(src);
    const actual = store.live.streamId || store.activePlugins?.stream;
    if (!actual || actual === expected) return null;
    if (src === 'mock-walk' || src === 'csv-upload') return null;
    return {
      text: `Stream ${actual} ≠ ${expected} for ${src}`,
      expected,
    };
  });
  const provider = () => store.provider;
  return (
    <>
      <Show when={provider()}>
        {(p) => (
          <span
            class="axis-status-capsule text-text-faint truncate max-w-[120px]"
            title={`${p().venue} ${p().market} · ${p().authMode}`}
            data-testid="axis-hud-provider"
          >
            <HudMetricIcon kind="plane" />
            <span class="axis-status-capsule-val max-w-[7em]">
              {p().venue}
              {p().authMode === 'authenticated' ? '·key' : ''}
            </span>
          </span>
        )}
      </Show>
      <Show when={warn()}>
        {(w) => (
          <button
            type="button"
            class="axis-status-capsule text-orange max-w-[160px]"
            title={w().text}
            data-testid="axis-hud-pair-fix"
            onClick={() => setActivePlugin('stream', w().expected)}
          >
            <span class="axis-live-dot is-warn" aria-hidden="true" />
            <span class="axis-status-capsule-code">pair</span>
            <span class="axis-status-capsule-val">Fix</span>
          </button>
        )}
      </Show>
    </>
  );
}

/** One chip for source × stream × engine × storage. Click opens the compose inspector. */
function ComposeChip(props: { snap: () => HudSnapshot }) {
  const [open, setOpen] = createSignal(false);
  const [btn, setBtn] = createSignal<HTMLButtonElement | undefined>();

  const close = () => setOpen(false);

  const snap = () => props.snap();
  const src = () => store.telemetry?.source;
  const str = () => store.telemetry?.stream;
  const sto = () => store.telemetry?.storage;
  const warn = () => {
    const expected = defaultStreamForSource(store.source);
    const actual = store.live.streamId || store.activePlugins?.stream;
    if (!actual || actual === expected) return '';
    if (store.source === 'mock-walk' || store.source === 'csv-upload') return '';
    return `Stream ${actual} does not match ${expected}`;
  };

  const openData = () => {
    close();
    setDataSourcePanelOpen(true);
  };
  const openStudio = () => {
    close();
    window.dispatchEvent(new CustomEvent('axis-open-studio', { detail: { page: 'wire' } }));
  };

  return (
    <>
      <button
        ref={setBtn}
        type="button"
        class={`axis-status-capsule ${open() ? 'is-active' : ''}`}
        data-testid="axis-hud-compose"
        title="Source, stream, engine, and storage. Open Data or Studio."
        aria-expanded={open()}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <HudMetricIcon kind="compose" />
        <span class="axis-status-capsule-code is-word">Compose</span>
        <span class="axis-status-capsule-val">{composeCaption(snap())}</span>
      </button>
      <Popover
        open={open()}
        anchor={btn()}
        onClose={close}
        width={280}
        side="top"
        role="dialog"
        label="Compose"
        testId="axis-compose-menu"
        class="axis-hud-info w-[min(280px,calc(100vw-24px))] text-left"
      >
        <div class="text-[11px] font-medium text-text mb-1.5">Compose</div>
        <div class="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-[11px] font-mono">
          <span class="text-text-faint">Engine</span>
          <span class="truncate text-text-dim" title={snap().product}>
            {composeCaption(snap())} · {snap().eng}
          </span>
          <span class="text-text-faint">Run</span>
          <span class="truncate text-text-dim">{snap().mode}</span>
          <span class="text-text-faint">Path</span>
          <span class="text-text-dim">{snap().showPath ? snap().path : 'in tab'}</span>
          <span class="text-text-faint">Source</span>
          <span class="truncate text-text-dim" title={src()?.id}>
            {src()?.name || src()?.id || '—'}
          </span>
          <span class="text-text-faint">Stream</span>
          <span class="truncate text-text-dim" title={str()?.id}>
            {str()?.name || str()?.id || '—'}
          </span>
          <span class="text-text-faint">Storage</span>
          <span class="truncate text-text-dim" title={sto()?.id}>
            {sto()?.name || sto()?.id || '—'}
          </span>
        </div>
        <Show when={warn()}>
          <p class="mt-1.5 text-[10px] text-orange">{warn()}</p>
        </Show>
        <Show when={snap().error}>
          <p class="mt-1.5 text-[10px] text-red truncate">{snap().error}</p>
        </Show>
        <div class="mt-2 flex gap-1">
          <button
            type="button"
            class="sc-btn sc-btn-ghost flex-1 text-[11px]"
            data-testid="axis-compose-data"
            onClick={openData}
          >
            Data
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost flex-1 text-[11px]"
            data-testid="axis-compose-studio"
            onClick={openStudio}
          >
            Studio
          </button>
        </div>
      </Popover>
    </>
  );
}

/** Status-bar scanline chips + click inspector (never hover). */
export const ConnectionHud: Component = () : JSX.Element => {
  const snap = useHudSnapshot();
  const inspector = useHudInspector();
  const tel = () => store.telemetry;
  /** Compact = Live/Last/Compose chips; expanded = measured perf meters. */
  const compact = () => !!tel()?.hud?.compact;
  const diagnostics = () => tel()?.hud?.diagnostics === true;

  const engState = () => {
    const s = snap();
    if (s.error) return 'err' as const;
    if (s.loading) return 'load' as const;
    if (s.engineState === 'open') return 'ok' as const;
    if (s.engineState === 'connecting') return 'load' as const;
    return 'idle' as const;
  };

  return (
    <div
      class="axis-connection-hud flex items-center gap-1 flex-nowrap min-w-0 flex-shrink-0 overflow-hidden"
      classList={{ 'is-compact': compact() }}
      data-testid="axis-connection-hud"
      data-compact={compact() ? '1' : '0'}
      data-mode={compact() ? 'chips' : 'perf'}
      role="status"
      aria-label="Connection status"
    >
      <LiveBadge inspector={inspector} snap={snap} />
      <TickPulse inspector={inspector} snap={snap} />

      <Show when={compact()}>
        {/* Fine chips — Diagnostics density is Settings-gated (no Diagnostics button). */}
        <Show
          when={diagnostics()}
          fallback={
            <>
              <ComposeChip snap={snap} />
              <Show when={showOnchainPlane(tel()?.onchain, true)}>
                <Show when={tel()?.onchain}>
                  {(o) => (
                    <PlaneChip
                      label="Chain"
                      plane={o()}
                      id="onc"
                      inspector={inspector}
                      snap={snap}
                    />
                  )}
                </Show>
              </Show>
              <PairingWarn />
            </>
          }
        >
          <ChipShell
            id="eng"
            label="eng"
            value={snap().eng}
            state={engState()}
            metric="plane"
            inspector={inspector}
            snap={snap}
            testId="axis-hud-eng"
          />
          <ChipShell
            id="run"
            label="run"
            value={snap().loading ? 'loading…' : snap().run}
            state={snap().loading ? 'load' : engState()}
            metric="plane"
            inspector={inspector}
            snap={snap}
            testId="axis-hud-run"
          />
          <ChipShell
            id="mode"
            label="mode"
            value={snap().mode}
            state={engState()}
            metric="plane"
            extra={formatLatency(snap().latencyMs)}
            inspector={inspector}
            snap={snap}
            testId="axis-engine-chip"
          />
          <Show when={snap().showPath}>
            <ChipShell
              id="path"
              label="path"
              value={snap().path}
              state={snap().path === 'WS' ? 'ok' : 'idle'}
              metric="plane"
              inspector={inspector}
              snap={snap}
              testId="axis-hud-path"
            />
          </Show>
          <Show when={tel()?.source}>
            {(p) => (
              <PlaneChip label="src" plane={p()} id="src" inspector={inspector} snap={snap} />
            )}
          </Show>
          <Show when={tel()?.stream}>
            {(p) => (
              <PlaneChip label="str" plane={p()} id="str" inspector={inspector} snap={snap} />
            )}
          </Show>
          <Show when={tel()?.storage}>
            {(p) => (
              <PlaneChip label="sto" plane={p()} id="sto" inspector={inspector} snap={snap} />
            )}
          </Show>
          <FeedChip inspector={inspector} snap={snap} />
          <PairingWarn />
        </Show>
      </Show>

      <Show when={!compact()}>
        <PerfMetrics snap={snap} inspector={inspector} />
      </Show>
    </div>
  );
};
