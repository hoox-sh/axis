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
 * AXIS Connection HUD — glanceable transport / engine / tick telemetry.
 * Composed into StatusBar; reads ephemeral store.telemetry.
 *
 * Chip roles:
 * - LIVE: stream on/off
 * - tick: last live price pulse (not the calculation engine)
 * - MODE: interpret | compile | auto for the active engine
 * - ENG (plane): engine id + **how the last run traveled** (WS / REST / LOCAL)
 * - SRC / STR / STO: other plugin planes
 */

import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../store';
import type { ConnState, PlaneTelemetry, TransportClass } from '../store/types';
import {
  connDotClass,
  formatLatency,
  formatTickAge,
  transportLabel,
} from './telemetry';
import { Icons } from './icons';
import { getEngine } from '../engines/catalog';
import { defaultStreamForSource } from '../streams/catalog';

function PlaneChip(props: {
  label: string;
  plane: PlaneTelemetry;
  title?: string;
}) {
  const t = () => props.plane;
  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border-soft bg-bg-elev/60 max-w-[160px] flex-shrink-0 h-[22px] box-border overflow-hidden"
      title={
        props.title ||
        `${props.label}: ${t().name} · ${transportLabel(t().transport)} · ${t().state}${
          t().detail ? ` · ${t().detail}` : ''
        }${t().error ? ` · ${t().error}` : ''}`
      }
      data-plane={props.label.toLowerCase()}
    >
      <span
        class={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${connDotClass(t().state)}`}
        aria-hidden="true"
      />
      <span class="text-[9px] font-mono uppercase text-text-faint tracking-wide flex-shrink-0">
        {props.label}
      </span>
      <span class="text-[10px] font-mono text-text-dim truncate max-w-[48px]">{t().id}</span>
      <TransportBadge transport={t().transport} />
      <Show when={t().latencyMs != null}>
        <span class="text-[10px] font-mono tabular-nums text-text-faint flex-shrink-0">
          {formatLatency(t().latencyMs)}
        </span>
      </Show>
    </span>
  );
}

function TransportBadge(props: { transport: TransportClass }) {
  const color = () => {
    switch (props.transport) {
      case 'ws':
        return 'border-accent-2/40 text-accent-2';
      case 'rest':
        return 'border-accent-3/40 text-accent-3';
      case 'broker':
        return 'border-accent/40 text-accent';
      case 'local':
        return 'border-border text-text-faint';
      default:
        return 'border-border text-text-faint';
    }
  };
  return (
    <span
      class={`px-1 py-px border text-[8px] font-mono leading-none flex-shrink-0 ${color()}`}
      title={
        props.transport === 'ws'
          ? 'Last / preferred path: WebSocket /ws/run'
          : props.transport === 'rest'
            ? 'Last / preferred path: REST POST /run'
            : props.transport === 'local'
              ? 'In-browser / local path (no network run)'
              : transportLabel(props.transport)
      }
    >
      {transportLabel(props.transport)}
    </span>
  );
}

function TickPulse() {
  const tick = () => store.telemetry?.lastTick;
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });

  const fresh = () => {
    const t = tick();
    if (!t) return false;
    return now() - t.at < 2000;
  };

  const dirColor = () => {
    const d = tick()?.dir;
    if (d === 'up') return 'text-accent-2';
    if (d === 'down') return 'text-red';
    return 'text-text-faint';
  };

  /** Fixed-width price so digit changes don't resize the chip. */
  const priceText = () => {
    const t = tick();
    if (!t) return '—';
    return t.price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border-soft font-mono text-[10px] h-[22px] box-border flex-shrink-0 overflow-hidden relative"
      title={
        tick()
          ? `Live market tick (stream price) — not the engine. ${tick()!.price} @ ${tick()!.time} (${formatTickAge(tick()!.at, now())})`
          : 'No live ticks yet (enable Live stream)'
      }
      data-testid="axis-tick-indicator"
    >
      {/* Fixed 8×8 box; ping clipped so it never overlaps MODE/ENG chips */}
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
    </span>
  );
}

function LiveBadge() {
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
  return (
    <span
      class={`px-1.5 py-0.5 border text-[9px] font-mono tracking-wider flex-shrink-0 h-[22px] box-border inline-flex items-center ${cls()}`}
      title="Live stream arm (market data), independent of calculation engine"
    >
      {label()}
    </span>
  );
}

/**
 * MODE chip — execution path (interpret / compile / auto) + engine id.
 * Not the same as ENG plane transport (WS/REST).
 */
function EngineModeChip() {
  const meta = createMemo(() => {
    const eng = getEngine(store.engine);
    const mode =
      (store.pluginsConfig?.[`engine:${store.engine}`]?.mode as string) ||
      (store.pluginsConfig?.[store.engine]?.mode as string) ||
      'interpret';
    const tel = store.telemetry?.engine;
    const loading =
      store.engine === 'pyodide' &&
      (tel?.state === 'connecting' || (!!tel?.detail && String(tel.detail).includes('load')));
    return {
      id: store.engine,
      name: eng?.name || store.engine,
      offline: !!eng?.capabilities?.offline,
      mode: String(mode),
      latency: tel?.latencyMs ?? store.lastRunMs,
      state: (tel?.state || 'idle') as ConnState,
      loading,
      detail: tel?.detail || '',
    };
  });

  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border-soft font-mono text-[10px] h-[22px] box-border flex-shrink-0 overflow-hidden max-w-[200px]"
      title={
        meta().loading
          ? `Pyodide cold start: ${meta().detail || '~20–30s'} — wasm, micropip, vendor wheels`
          : `Execution MODE (not transport): ${meta().name} · mode=${meta().mode}. ` +
            `Server uses Pro API; Pyodide runs in-browser. ` +
            `WS/REST is shown on the ENG chip (how the last run was sent).`
      }
      data-testid="axis-engine-chip"
    >
      <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connDotClass(meta().state)}`} />
      {meta().offline ? (
        <Icons.activity size={11} class="text-accent-2 flex-shrink-0" />
      ) : (
        <Icons.wifi size={11} class="text-accent-3 flex-shrink-0" />
      )}
      <span class="text-[9px] text-text-faint uppercase flex-shrink-0">mode</span>
      <span class="truncate max-w-[56px] text-text-dim">{meta().id}</span>
      <Show
        when={!meta().loading}
        fallback={
          <span class="text-[9px] text-orange uppercase truncate" data-testid="axis-pyodide-loading">
            loading…
          </span>
        }
      >
        <span class="text-[9px] text-text-faint uppercase flex-shrink-0">{meta().mode}</span>
      </Show>
      <span class="tabular-nums text-text-dim flex-shrink-0">{formatLatency(meta().latency)}</span>
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
      <span class="text-[9px] font-mono text-orange truncate max-w-[140px] flex-shrink-0" title={warn()!}>
        ⚠ pair
      </span>
    </Show>
  );
}

function engPlaneTitle(p: PlaneTelemetry): string {
  const transportHint =
    p.transport === 'ws'
      ? 'WS = WebSocket /ws/run (preferred when Prefer WebSocket is on)'
      : p.transport === 'rest'
        ? 'REST = POST /run (fallback if WS fails or Prefer WebSocket is off)'
        : p.transport === 'local'
          ? 'LOCAL = in-browser Pyodide (no Pro API hop)'
          : transportLabel(p.transport);
  return (
    `ENG plane (active engine + transport): ${p.name} · ${transportLabel(p.transport)} · ${p.state}. ` +
    `${transportHint}. ` +
    `Should match MODE chip engine id. WS/REST toggles on server runs; LOCAL when pyodide is selected. ` +
    `Execution mode (interpret/compile) is on the MODE chip.`
  );
}

/**
 * ENG plane must track the *selected* engine (store.engine). Telemetry can lag
 * after background Pyodide warm-up; overlay id/name/transport from selection.
 */
function resolvedEnginePlane(): PlaneTelemetry | undefined {
  const raw = store.telemetry?.engine;
  if (!raw) return undefined;
  const id = store.engine || store.activePlugins?.engine || raw.id;
  if (id === raw.id) return raw;
  const eng = getEngine(id);
  const transport: TransportClass =
    id === 'pyodide' ? 'local' : id === 'server' ? (raw.transport === 'rest' ? 'rest' : 'ws') : raw.transport;
  return {
    ...raw,
    id,
    name: eng?.name || id,
    transport,
    // Don't keep pyodide "ready/loading" detail while MODE is server
    detail: id === 'pyodide' ? raw.detail : raw.detail?.includes('load') ? undefined : raw.detail,
    state: id === 'pyodide' ? raw.state : raw.state === 'connecting' && raw.id === 'pyodide' ? 'idle' : raw.state,
  };
}

export const ConnectionHud: Component = () => {
  const tel = () => store.telemetry;
  const compact = () => tel()?.hud?.compact;
  const engPlane = createMemo(() => resolvedEnginePlane());

  return (
    <div
      class="flex items-center gap-1.5 flex-nowrap min-w-0 flex-shrink-0 overflow-hidden"
      data-testid="axis-connection-hud"
      role="status"
      aria-label="Connection status"
    >
      <LiveBadge />
      <TickPulse />
      <EngineModeChip />
      <Show when={!compact()}>
        <For
          each={[
            {
              label: 'SRC',
              plane: () => tel()?.source,
              title: () => undefined as string | undefined,
            },
            {
              label: 'STR',
              plane: () => tel()?.stream,
              title: () => undefined as string | undefined,
            },
            {
              label: 'ENG',
              plane: () => engPlane(),
              title: () => {
                const p = engPlane();
                return p ? engPlaneTitle(p) : undefined;
              },
            },
            {
              label: 'STO',
              plane: () => tel()?.storage,
              title: () => undefined as string | undefined,
            },
          ]}
        >
          {(item) => (
            <Show when={item.plane()}>
              {(p) => (
                <PlaneChip label={item.label} plane={p()} title={item.title?.()} />
              )}
            </Show>
          )}
        </For>
        <PairingWarn />
      </Show>
    </div>
  );
};
