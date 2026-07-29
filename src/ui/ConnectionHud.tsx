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
 * AXIS Connection HUD — ENG / RUN / MODE / PATH (+ SRC STR STO).
 *
 * ENG  local | remote
 * RUN  browser | server | worker
 * MODE interpret | compile | auto
 * PATH WS | REST (hidden for browser)
 *
 * Sticky info: hover opens panel; click pin (or chip) keeps it until Esc / outside.
 */

import {
  Component,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { store, setStore, persist } from '../store';
import type { PlaneTelemetry, TransportClass } from '../store/types';
import { formatLatency, formatTickAge, transportLabel } from './telemetry';
import {
  deriveHud,
  hudChipHelp,
  type HudChipId,
  type HudSnapshot,
} from './hud-model';
import { defaultStreamForSource } from '../streams/catalog';
import { pluginKey } from '../plugins/types';

function readEngineCfg(engineId: string): Record<string, unknown> {
  const pc = store.pluginsConfig || {};
  return (pc[pluginKey('engine', engineId)] || pc[engineId] || {}) as Record<string, unknown>;
}

function useHudSnapshot(): () => HudSnapshot {
  return createMemo(() => {
    const engineId = store.engine || store.activePlugins?.engine || 'server';
    const cfg = readEngineCfg(engineId);
    const tel = store.telemetry?.engine;
    return deriveHud({
      engineId,
      endpoint: store.endpoint || '',
      modeRaw: cfg.mode,
      preferWs: cfg.preferWs !== false,
      engineTransport: tel?.transport,
      engineState: tel?.state,
      latencyMs: tel?.latencyMs ?? store.lastRunMs,
      detail: tel?.detail,
      error: tel?.error,
    });
  });
}

// ── Sticky info panel ─────────────────────────────────────────────────

function HudInfoPanel(props: {
  chip: HudChipId;
  snap: HudSnapshot;
  pinned: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  /** Anchor element for fixed placement (avoids status-bar overflow clip). */
  anchor: HTMLElement | null | undefined;
}) {
  const help = () => hudChipHelp(props.chip, props.snap);
  const pos = createMemo(() => {
    const el = props.anchor;
    if (!el || typeof el.getBoundingClientRect !== 'function') {
      return { left: 8, bottom: 32 };
    }
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
    const bottom = Math.max(8, window.innerHeight - r.top + 6);
    return { left, bottom };
  });
  return (
    <div
      class="fixed z-[300] w-[min(320px,calc(100vw-24px))] border-2 border-border bg-bg-panel shadow-[0_8px_24px_rgba(0,0,0,0.55)] p-2.5 text-left"
      style={{ left: `${pos().left}px`, bottom: `${pos().bottom}px` }}
      data-testid="axis-hud-info"
      role="dialog"
      aria-label={help().title}
    >
      <div class="flex items-start justify-between gap-2 mb-1.5">
        <div class="text-[11px] font-semibold text-text tracking-tight">{help().title}</div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            class={`sc-btn sc-btn-ghost px-1.5 py-0 text-[9px] font-mono ${
              props.pinned ? 'text-accent' : 'text-text-faint'
            }`}
            title={props.pinned ? 'Unpin (auto-hide on leave)' : 'Pin open'}
            data-testid="axis-hud-pin"
            onClick={(e) => {
              e.stopPropagation();
              props.onTogglePin();
            }}
          >
            {props.pinned ? 'pinned' : 'pin'}
          </button>
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
      </div>
      <p class="text-[10px] text-text-dim font-mono whitespace-pre-wrap leading-relaxed">
        {help().body}
      </p>
      <div class="mt-2 pt-1.5 border-t border-border-soft grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] font-mono text-text-faint">
        <span>ENG {props.snap.eng}</span>
        <span>RUN {props.snap.run}</span>
        <span>MODE {props.snap.mode}</span>
        <span>PATH {props.snap.showPath ? props.snap.path : '—'}</span>
        <span class="col-span-2 truncate" title={props.snap.endpoint}>
          ep {props.snap.endpoint}
        </span>
        <span class="col-span-2 truncate" title={props.snap.product}>
          {props.snap.product}
        </span>
        <Show when={props.snap.error}>
          <span class="col-span-2 text-red truncate">{props.snap.error}</span>
        </Show>
      </div>
      <p class="mt-1.5 text-[9px] text-text-faint">
        Hover for info · pin to keep · Esc closes
      </p>
    </div>
  );
}

function useStickyInfo() {
  const [openChip, setOpenChip] = createSignal<HudChipId | null>(null);
  const [pinned, setPinned] = createSignal(false);
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const clearLeave = () => {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  };

  const open = (id: HudChipId) => {
    clearLeave();
    setOpenChip(id);
  };

  const scheduleClose = () => {
    if (pinned()) return;
    clearLeave();
    leaveTimer = setTimeout(() => setOpenChip(null), 220);
  };

  const close = () => {
    clearLeave();
    setPinned(false);
    setOpenChip(null);
  };

  const togglePin = () => {
    setPinned((p) => !p);
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      clearLeave();
    });
  });

  return { openChip, pinned, open, scheduleClose, close, togglePin, clearLeave };
}

// ── Chips ─────────────────────────────────────────────────────────────

function ChipShell(props: {
  id: HudChipId;
  label: string;
  value: string;
  state?: 'idle' | 'ok' | 'warn' | 'err' | 'load';
  monoValue?: boolean;
  sticky: ReturnType<typeof useStickyInfo>;
  snap: () => HudSnapshot;
  extra?: string;
  testId?: string;
}) {
  let anchor: HTMLSpanElement | undefined;
  const dot = () => {
    switch (props.state) {
      case 'ok':
        return 'bg-accent-2';
      case 'warn':
      case 'load':
        return 'bg-orange animate-pulse';
      case 'err':
        return 'bg-red';
      default:
        return 'bg-border';
    }
  };
  const active = () => props.sticky.openChip() === props.id;

  return (
    <span
      ref={(el) => {
        anchor = el;
      }}
      class={`relative inline-flex items-center gap-1 px-1.5 py-0.5 border h-[22px] box-border flex-shrink-0 overflow-hidden cursor-default select-none ${
        active()
          ? 'border-accent bg-accent/10'
          : 'border-border-soft bg-bg-elev/60'
      }`}
      data-testid={props.testId || `axis-hud-${props.id}`}
      data-hud-chip={props.id}
      onMouseEnter={() => props.sticky.open(props.id)}
      onMouseLeave={() => props.sticky.scheduleClose()}
      onClick={(e) => {
        e.stopPropagation();
        if (active() && props.sticky.pinned()) {
          props.sticky.close();
        } else {
          props.sticky.open(props.id);
          if (!props.sticky.pinned()) props.sticky.togglePin();
        }
      }}
    >
      <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot()}`} aria-hidden="true" />
      <span class="text-[9px] font-mono uppercase text-text-faint tracking-wide flex-shrink-0">
        {props.label}
      </span>
      <span
        class={`text-[10px] font-mono truncate max-w-[72px] ${
          props.state === 'load' ? 'text-orange' : 'text-text'
        }`}
      >
        {props.value}
      </span>
      <Show when={props.extra}>
        <span class="text-[9px] font-mono text-text-faint tabular-nums flex-shrink-0">
          {props.extra}
        </span>
      </Show>
      <Show when={active()}>
        <div
          onMouseEnter={() => props.sticky.clearLeave()}
          onMouseLeave={() => props.sticky.scheduleClose()}
        >
          <HudInfoPanel
            chip={props.id}
            snap={props.snap()}
            pinned={props.sticky.pinned()}
            anchor={anchor}
            onClose={() => props.sticky.close()}
            onTogglePin={() => props.sticky.togglePin()}
          />
        </div>
      </Show>
    </span>
  );
}

function PlaneChip(props: {
  label: string;
  plane: PlaneTelemetry;
  id: HudChipId;
  sticky: ReturnType<typeof useStickyInfo>;
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
            : t().state === 'connecting'
              ? 'load'
              : 'idle'
      }
      extra={transportLabel(t().transport as TransportClass)}
      sticky={props.sticky}
      snap={props.snap}
      testId={`axis-hud-${props.id}`}
    />
  );
}

function TickPulse(props: {
  sticky: ReturnType<typeof useStickyInfo>;
  snap: () => HudSnapshot;
}) {
  let anchor: HTMLSpanElement | undefined;
  const tick = () => store.telemetry?.lastTick;
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });
  const fresh = () => {
    const t = tick();
    return !!t && now() - t.at < 2000;
  };
  const dirColor = () => {
    const d = tick()?.dir;
    if (d === 'up') return 'text-accent-2';
    if (d === 'down') return 'text-red';
    return 'text-text-faint';
  };
  const priceText = () => {
    const t = tick();
    if (!t) return '—';
    return t.price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };
  const active = () => props.sticky.openChip() === 'tick';

  return (
    <span
      ref={(el) => {
        anchor = el;
      }}
      class={`relative inline-flex items-center gap-1 px-1.5 py-0.5 border font-mono text-[10px] h-[22px] box-border flex-shrink-0 overflow-hidden cursor-default ${
        active() ? 'border-accent bg-accent/10' : 'border-border-soft'
      }`}
      data-testid="axis-tick-indicator"
      data-hud-chip="tick"
      onMouseEnter={() => props.sticky.open('tick')}
      onMouseLeave={() => props.sticky.scheduleClose()}
      onClick={(e) => {
        e.stopPropagation();
        props.sticky.open('tick');
        if (!props.sticky.pinned()) props.sticky.togglePin();
      }}
    >
      <span
        class="relative flex-shrink-0 overflow-hidden"
        style={{ width: '8px', height: '8px' }}
        aria-hidden="true"
      >
        <span
          class={`absolute inset-0 rounded-full ${
            store.live.active && store.stream.status === 'connected'
              ? 'bg-accent-2'
              : 'bg-border'
          }`}
        />
        <Show when={fresh()}>
          <span
            class="absolute left-0 top-0 rounded-full bg-accent-2 animate-ping opacity-40 pointer-events-none"
            style={{ width: '8px', height: '8px' }}
          />
        </Show>
      </span>
      <span class="text-[9px] uppercase text-text-faint w-[2.5ch] flex-shrink-0">tick</span>
      <span
        class={`tabular-nums text-right w-[7.5ch] flex-shrink-0 overflow-hidden text-ellipsis ${dirColor()}`}
      >
        {priceText()}
      </span>
      <span class="text-text-faint tabular-nums w-[3ch] flex-shrink-0 text-right">
        {tick() ? formatTickAge(tick()!.at, now()) : '—'}
      </span>
      <Show when={active()}>
        <div
          onMouseEnter={() => props.sticky.clearLeave()}
          onMouseLeave={() => props.sticky.scheduleClose()}
        >
          <HudInfoPanel
            chip="tick"
            snap={props.snap()}
            pinned={props.sticky.pinned()}
            anchor={anchor}
            onClose={() => props.sticky.close()}
            onTogglePin={() => props.sticky.togglePin()}
          />
        </div>
      </Show>
    </span>
  );
}

function LiveBadge(props: {
  sticky: ReturnType<typeof useStickyInfo>;
  snap: () => HudSnapshot;
}) {
  let anchor: HTMLSpanElement | undefined;
  const st = () => store.stream.status;
  const label = () => {
    if (!store.live.active) return 'OFF';
    if (st() === 'connected') return 'LIVE';
    if (st() === 'connecting') return '…';
    if (st() === 'error') return 'ERR';
    return 'OFF';
  };
  const cls = () => {
    if (!store.live.active) return 'text-text-faint border-border';
    if (st() === 'connected') return 'text-accent-2 border-accent-2/50';
    if (st() === 'connecting') return 'text-orange border-orange/40';
    if (st() === 'error') return 'text-red border-red/40';
    return 'text-text-faint border-border';
  };
  const active = () => props.sticky.openChip() === 'live';
  return (
    <span
      ref={(el) => {
        anchor = el;
      }}
      class={`relative px-1.5 py-0.5 border text-[9px] font-mono tracking-wider flex-shrink-0 h-[22px] box-border inline-flex items-center cursor-default ${cls()} ${
        active() ? 'ring-1 ring-accent' : ''
      }`}
      data-hud-chip="live"
      data-testid="axis-hud-live"
      onMouseEnter={() => props.sticky.open('live')}
      onMouseLeave={() => props.sticky.scheduleClose()}
      onClick={(e) => {
        e.stopPropagation();
        props.sticky.open('live');
        if (!props.sticky.pinned()) props.sticky.togglePin();
      }}
    >
      {label()}
      <Show when={active()}>
        <div
          onMouseEnter={() => props.sticky.clearLeave()}
          onMouseLeave={() => props.sticky.scheduleClose()}
        >
          <HudInfoPanel
            chip="live"
            snap={props.snap()}
            pinned={props.sticky.pinned()}
            anchor={anchor}
            onClose={() => props.sticky.close()}
            onTogglePin={() => props.sticky.togglePin()}
          />
        </div>
      </Show>
    </span>
  );
}

function PairingWarn() {
  const warn = createMemo(() => {
    const src = store.source;
    const expected = defaultStreamForSource(src);
    const actual = store.live.streamId || store.activePlugins?.stream;
    if (!actual || actual === expected) return null;
    if (src === 'mock-walk' || src === 'csv-upload') return null;
    return `Stream ${actual} ≠ default ${expected} for ${src}`;
  });
  return (
    <Show when={warn()}>
      <span
        class="text-[9px] font-mono text-orange truncate max-w-[140px] flex-shrink-0"
        title={warn()!}
      >
        ⚠ pair
      </span>
    </Show>
  );
}

export const ConnectionHud: Component = () => {
  const snap = useHudSnapshot();
  const sticky = useStickyInfo();
  const tel = () => store.telemetry;
  const compact = () => tel()?.hud?.compact;

  // Persist compact preference already exists; ensure hud object present
  createEffect(() => {
    void store.telemetry?.hud?.compact;
  });

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
      class="flex items-center gap-1.5 flex-nowrap min-w-0 flex-shrink-0 overflow-visible"
      data-testid="axis-connection-hud"
      role="status"
      aria-label="Connection status"
    >
      <LiveBadge sticky={sticky} snap={snap} />
      <TickPulse sticky={sticky} snap={snap} />

      {/* ENG local | remote */}
      <ChipShell
        id="eng"
        label="eng"
        value={snap().eng}
        state={engState()}
        sticky={sticky}
        snap={snap}
        testId="axis-hud-eng"
      />

      {/* RUN browser | server | worker */}
      <ChipShell
        id="run"
        label="run"
        value={snap().loading ? 'loading…' : snap().run}
        state={snap().loading ? 'load' : engState()}
        sticky={sticky}
        snap={snap}
        testId="axis-hud-run"
      />

      {/* MODE interpret | compile | auto */}
      <ChipShell
        id="mode"
        label="mode"
        value={snap().mode}
        state={engState()}
        extra={formatLatency(snap().latencyMs)}
        sticky={sticky}
        snap={snap}
        testId="axis-engine-chip"
      />

      {/* PATH WS | REST — not for browser */}
      <Show when={snap().showPath}>
        <ChipShell
          id="path"
          label="path"
          value={snap().path}
          state={snap().path === 'WS' ? 'ok' : 'idle'}
          sticky={sticky}
          snap={snap}
          testId="axis-hud-path"
        />
      </Show>

      <Show when={!compact()}>
        <Show when={tel()?.source}>
          {(p) => (
            <PlaneChip
              label="src"
              plane={p()}
              id="src"
              sticky={sticky}
              snap={snap}
            />
          )}
        </Show>
        <Show when={tel()?.stream}>
          {(p) => (
            <PlaneChip
              label="str"
              plane={p()}
              id="str"
              sticky={sticky}
              snap={snap}
            />
          )}
        </Show>
        <Show when={tel()?.storage}>
          {(p) => (
            <PlaneChip
              label="sto"
              plane={p()}
              id="sto"
              sticky={sticky}
              snap={snap}
            />
          )}
        </Show>
        <PairingWarn />
      </Show>

      {/* Compact toggle (keeps SRC/STR/STO optional) */}
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1 py-0 text-[9px] font-mono text-text-faint flex-shrink-0 h-[22px]"
        title={compact() ? 'Expand SRC/STR/STO chips' : 'Compact HUD (hide SRC/STR/STO)'}
        data-testid="axis-hud-compact"
        onClick={() => {
          setStore('telemetry', 'hud', 'compact', !compact());
          persist();
        }}
      >
        {compact() ? '···' : '·'}
      </button>
    </div>
  );
};
