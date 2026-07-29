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

import { Component, For, createEffect, createSignal, Show, createMemo } from 'solid-js';
import { store, setStore, persist, setStatus, setActivePlugin } from '../store';
import { Icons } from './icons';
import { HooxLoader } from './HooxLoader';
import { probeEndpoint } from '../indicators/runner';
import { listEngines } from '../engines/catalog';
import { listStorages } from '../storage/catalog';
import { CapabilityBadges, engineOptionLabel } from './plugin-badges';
import { getEngine } from '../engines/catalog';
import { pluginKey } from '../plugins/types';
import {
  WATCHLIST_INTERVALS,
  WATCHLIST_REFRESH_OPTIONS,
} from '../data/watchlist-tickers';
import { loadSymbolData } from '../data/load-symbol';

/** PYNE Runtime modes (server engine). */
export type EngineExecMode = 'interpret' | 'compile' | 'auto';

const EXEC_MODE_OPTIONS: { value: EngineExecMode; label: string; hint: string }[] = [
  {
    value: 'interpret',
    label: 'Interpreter',
    hint: 'AST walk — full language surface, slower on large history',
  },
  {
    value: 'compile',
    label: 'Compiler',
    hint: 'Numba/numpy path — faster; some constructs stay object-mode',
  },
  {
    value: 'auto',
    label: 'Auto',
    hint: 'Try compile first; fall back to interpret on failure',
  },
];

function normalizeExecMode(raw: unknown, fallback: EngineExecMode = 'interpret'): EngineExecMode {
  const s = String(raw || fallback);
  if (s === 'compile' || s === 'auto' || s === 'interpret') return s;
  return fallback;
}

function readEnginePluginConfig(engineId: string): Record<string, unknown> {
  const pc = store.pluginsConfig || {};
  return (pc[pluginKey('engine', engineId)] || pc[engineId] || {}) as Record<string, unknown>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const SettingsDialog: Component<Props> = (props) => {
  const [endpoint, setEndpoint] = createSignal(store.endpoint);
  const [engine, setEngine] = createSignal(store.engine);
  const [execMode, setExecMode] = createSignal<EngineExecMode>('interpret');
  const [preferWs, setPreferWs] = createSignal(true);
  const [storage, setStorage] = createSignal(store.activePlugins?.storage || 'local');
  const [chartInterval, setChartInterval] = createSignal(store.interval);
  const [refreshSec, setRefreshSec] = createSignal(store.watchlist.refreshSec || 15);
  const [preferAfterLoad, setPreferAfterLoad] = createSignal(!!store.live.preferAfterLoad);
  const [rerunOn, setRerunOn] = createSignal<'every-tick' | 'bar-close'>(
    store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick',
  );
  const [hudCompact, setHudCompact] = createSignal(!!store.telemetry?.hud?.compact);
  const [probing, setProbing] = createSignal(false);
  const [probeMsg, setProbeMsg] = createSignal('');

  const engines = createMemo(() => listEngines());
  const storages = createMemo(() => listStorages());

  const selectedEngine = createMemo(() => getEngine(engine()) || engines()[0]);
  /** Show endpoint field only for engines that take a backend URL (not pyodide). */
  const needsEndpoint = createMemo(() => {
    const e = selectedEngine();
    return e?.id === 'server' || !!e?.configSchema?.endpoint;
  });
  /** Server (and any engine with mode in configSchema) can pick interpret/compile/auto. */
  const hasExecMode = createMemo(() => {
    const schema = selectedEngine()?.configSchema;
    return !!schema?.mode && schema.mode.type === 'select';
  });
  const hasPreferWs = createMemo(() => selectedEngine()?.configSchema?.preferWs?.type === 'boolean');
  const execModeOptions = createMemo(() => {
    const opts = selectedEngine()?.configSchema?.mode?.options;
    if (!opts?.length) return EXEC_MODE_OPTIONS;
    return EXEC_MODE_OPTIONS.filter((o) => opts.includes(o.value));
  });
  const execModeHint = createMemo(
    () => EXEC_MODE_OPTIONS.find((o) => o.value === execMode())?.hint || '',
  );

  const hydrateEngineFields = (engineId: string) => {
    const cfg = readEnginePluginConfig(engineId);
    const schema = getEngine(engineId)?.configSchema;
    const defaultMode = normalizeExecMode(schema?.mode?.default, 'interpret');
    setExecMode(normalizeExecMode(cfg.mode, defaultMode));
    if (typeof cfg.preferWs === 'boolean') setPreferWs(cfg.preferWs);
    else setPreferWs(schema?.preferWs?.default !== false);
  };

  createEffect(() => {
    if (props.open) {
      setEndpoint(store.endpoint);
      setEngine(store.engine);
      hydrateEngineFields(store.engine);
      setStorage(store.activePlugins?.storage || 'local');
      setChartInterval(store.interval);
      setRefreshSec(store.watchlist.refreshSec || 15);
      setPreferAfterLoad(!!store.live.preferAfterLoad);
      setRerunOn(store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick');
      setHudCompact(!!store.telemetry?.hud?.compact);
      setProbeMsg('');
    }
  });

  const save = async () => {
    const prevInterval = store.interval;
    const nextInterval = chartInterval().trim() || prevInterval;
    const nextRefresh = Math.min(120, Math.max(5, Math.round(Number(refreshSec()) || 15)));
    const nextEngine = engine();

    setStore('endpoint', endpoint().trim());
    setStore('interval', nextInterval);
    setStore('watchlist', 'refreshSec', nextRefresh);
    setStore('live', 'preferAfterLoad', preferAfterLoad());
    setStore('live', 'rerunOn', rerunOn());
    setStore('telemetry', 'hud', 'compact', hudCompact());
    setActivePlugin('engine', nextEngine);
    setActivePlugin('storage', storage());

    // Persist engine execution mode / WS preference under pluginsConfig.engine:<id>
    if (hasExecMode() || hasPreferWs()) {
      const key = pluginKey('engine', nextEngine);
      const prev = readEnginePluginConfig(nextEngine);
      const nextCfg: Record<string, unknown> = { ...prev };
      if (hasExecMode()) nextCfg.mode = execMode();
      if (hasPreferWs()) nextCfg.preferWs = preferWs();
      setStore('pluginsConfig', key, nextCfg);
    }

    persist();
    const modePart = hasExecMode() ? ` · mode=${execMode()}` : '';
    setStatus(
      'ready',
      `Settings saved · ${nextInterval} · refresh ${nextRefresh}s · engine=${nextEngine}${modePart} · live re-run=${rerunOn()}`,
    );
    // Reload chart bars if default interval changed
    if (nextInterval !== prevInterval && store.symbol) {
      void loadSymbolData(store.symbol, nextInterval, store.source);
    }
    props.onClose();
  };

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  };

  const testEndpoint = async () => {
    setProbing(true);
    setProbeMsg('Probing…');
    const r = await probeEndpoint(endpoint().trim());
    setProbing(false);
    setProbeMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
    if (r.ok) setStatus('ready', `Endpoint OK · ${endpoint().trim()}`);
    else setStatus('error', `Endpoint failed · ${r.message}`);
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 bg-black/75 flex items-center justify-center z-[1000] p-4"
        onClick={onBackdrop}
        onKeyDown={onKey}
        role="presentation"
      >
        <div
          class="bg-bg-panel border-2 border-border w-[min(520px,calc(100vw-32px))] max-h-[calc(100vh-64px)] flex flex-col shadow-[0_16px_48px_rgba(0,0,0,0.6)] outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-settings-title"
          data-testid="axis-settings"
          tabIndex={-1}
          ref={(el) => queueMicrotask(() => el?.focus())}
        >
          <div class="h-0.5 w-full bg-accent flex-shrink-0" />

          <div class="flex items-center justify-between px-3.5 py-2.5 border-b-2 border-border">
            <span id="axis-settings-title" class="text-sm font-semibold text-text tracking-tight">
              Settings
            </span>
            <button class="sc-btn sc-btn-ghost px-2" onClick={props.onClose} aria-label="Close">
              <Icons.x size={14} />
            </button>
          </div>

          <div class="p-3.5 flex flex-col gap-3.5 overflow-auto">
            <div class="flex flex-col gap-1">
              <label class="text-[10px] text-text-dim uppercase tracking-wider" for="axis-engine">
                Calculation engine
              </label>
              <select
                id="axis-engine"
                class="sc-input w-full"
                value={engine()}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  setEngine(id);
                  hydrateEngineFields(id);
                }}
              >
                <For each={engines()}>
                  {(en) => <option value={en.id}>{engineOptionLabel(en)}</option>}
                </For>
              </select>
              <Show when={selectedEngine()}>
                {(en) => (
                  <div class="mt-0.5">
                    <CapabilityBadges
                      capabilities={en().capabilities}
                      builtIn={en().builtIn}
                    />
                    <p class="text-[10px] text-text-faint mt-0.5">{en().description}</p>
                  </div>
                )}
              </Show>
            </div>

            <Show when={hasExecMode()}>
              <div class="flex flex-col gap-1">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-exec-mode"
                >
                  Execution mode
                </label>
                <select
                  id="axis-exec-mode"
                  class="sc-input w-full"
                  data-testid="axis-exec-mode"
                  value={execMode()}
                  onChange={(e) => setExecMode(normalizeExecMode(e.currentTarget.value))}
                >
                  <For each={execModeOptions()}>
                    {(o) => <option value={o.value}>{o.label}</option>}
                  </For>
                </select>
                <p class="text-[10px] text-text-faint mt-0.5">
                  PYNE backend path for this engine. {execModeHint()}
                </p>
              </div>
            </Show>

            <Show when={hasPreferWs()}>
              <label class="flex items-start gap-2 cursor-pointer" for="axis-prefer-ws">
                <input
                  id="axis-prefer-ws"
                  type="checkbox"
                  class="mt-0.5"
                  data-testid="axis-prefer-ws"
                  checked={preferWs()}
                  onChange={(e) => setPreferWs(e.currentTarget.checked)}
                />
                <span>
                  <span class="text-[12px] text-text">Prefer WebSocket run</span>
                  <span class="block text-[10px] text-text-faint mt-0.5">
                    Use <code class="font-mono">/ws/run</code> when the backend advertises it;
                    fall back to REST <code class="font-mono">POST /run</code>.
                  </span>
                </span>
              </label>
            </Show>

            <Show when={needsEndpoint()}>
              <div class="flex flex-col gap-1">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-endpoint"
                >
                  Backend Endpoint
                </label>
                <div class="flex gap-1.5">
                  <input
                    id="axis-endpoint"
                    class="sc-input font-mono text-[12px] flex-1 min-w-0"
                    value={endpoint()}
                    onInput={(e) => setEndpoint(e.currentTarget.value)}
                    placeholder="http://host:5002 or Worker URL"
                    spellcheck={false}
                  />
                  <button
                    type="button"
                    class="sc-btn inline-flex items-center gap-1 flex-shrink-0"
                    disabled={probing()}
                    onClick={testEndpoint}
                    title="GET / health probe"
                  >
                    {probing() ? <HooxLoader size="xs" /> : <Icons.activity size={13} />}
                    Test
                  </button>
                </div>
                <Show when={probeMsg()}>
                  <p
                    class={`text-[10px] font-mono mt-0.5 ${
                      probeMsg().startsWith('✓') ? 'text-accent-2' : 'text-red'
                    }`}
                  >
                    {probeMsg()}
                  </p>
                </Show>
                <p class="text-[10px] text-text-faint mt-0.5">
                  Used by the server engine and cloud script storage. CORS must allow this origin.
                </p>
              </div>
            </Show>

            <div class="flex flex-col gap-1">
              <label class="text-[10px] text-text-dim uppercase tracking-wider" for="axis-storage">
                Script storage
              </label>
              <select
                id="axis-storage"
                class="sc-input w-full"
                value={storage()}
                onChange={(e) => setStorage(e.currentTarget.value)}
              >
                <For each={storages()}>
                  {(s) => (
                    <option value={s.id}>
                      {s.name}
                      {s.builtIn ? '' : ' (plugin)'}
                    </option>
                  )}
                </For>
              </select>
              <p class="text-[10px] text-text-faint mt-0.5">
                Where saved Pine scripts live (local browser, cloud Worker, or git). Configure
                credentials under Manager → Script Library.
              </p>
            </div>

            <div class="border-t border-border-soft pt-3 flex flex-col gap-3">
              <div class="text-[10px] text-text-dim uppercase tracking-wider font-semibold">
                Chart &amp; watchlist
              </div>

              <div class="flex flex-col gap-1">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-default-interval"
                >
                  Default interval
                </label>
                <select
                  id="axis-default-interval"
                  class="sc-input w-full"
                  value={chartInterval()}
                  onChange={(e) => setChartInterval(e.currentTarget.value)}
                >
                  <For each={[...WATCHLIST_INTERVALS]}>
                    {(i) => <option value={i}>{i}</option>}
                  </For>
                </select>
                <p class="text-[10px] text-text-faint mt-0.5">
                  Used when loading symbols from the watchlist and top bar. Changing this reloads
                  the active chart.
                </p>
              </div>

              <div class="border-t border-border-soft pt-3 flex flex-col gap-3">
                <div class="text-[10px] text-text-dim uppercase tracking-wider font-semibold">
                  Live stream
                </div>

                <label class="flex items-start gap-2 cursor-pointer" for="axis-prefer-live">
                  <input
                    id="axis-prefer-live"
                    type="checkbox"
                    class="mt-0.5"
                    checked={preferAfterLoad()}
                    onChange={(e) => setPreferAfterLoad(e.currentTarget.checked)}
                  />
                  <span>
                    <span class="text-[12px] text-text">Auto-start live after Load</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Prefer WebSocket feed immediately after historical REST load. Off by default
                      to avoid surprise sockets.
                    </span>
                  </span>
                </label>

                <div class="flex flex-col gap-1">
                  <label
                    class="text-[10px] text-text-dim uppercase tracking-wider"
                    for="axis-rerun-on"
                  >
                    Indicator re-run on live bars
                  </label>
                  <select
                    id="axis-rerun-on"
                    class="sc-input w-full"
                    value={rerunOn()}
                    onChange={(e) =>
                      setRerunOn(
                        e.currentTarget.value === 'bar-close' ? 'bar-close' : 'every-tick',
                      )
                    }
                  >
                    <option value="every-tick">Every tick (responsive)</option>
                    <option value="bar-close">Bar close only (lighter)</option>
                  </select>
                  <p class="text-[10px] text-text-faint mt-0.5">
                    Bar-close uses venue closed flags (Binance/OKX/Bybit) or bar time advance.
                  </p>
                </div>

                <label class="flex items-start gap-2 cursor-pointer" for="axis-hud-compact">
                  <input
                    id="axis-hud-compact"
                    type="checkbox"
                    class="mt-0.5"
                    checked={hudCompact()}
                    onChange={(e) => setHudCompact(e.currentTarget.checked)}
                  />
                  <span>
                    <span class="text-[12px] text-text">Compact connection HUD</span>
                    <span class="block text-[10px] text-text-faint mt-0.5">
                      Hide SRC/STR/ENG/STO plane chips; keep Live · Tick · Engine latency.
                    </span>
                  </span>
                </label>
              </div>

              <div class="flex flex-col gap-1">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-watchlist-refresh"
                >
                  Watchlist quote refresh
                </label>
                <select
                  id="axis-watchlist-refresh"
                  class="sc-input w-full"
                  value={String(refreshSec())}
                  onChange={(e) => setRefreshSec(Number(e.currentTarget.value))}
                >
                  <For each={[...WATCHLIST_REFRESH_OPTIONS]}>
                    {(o) => <option value={o.value}>{o.label}</option>}
                  </For>
                </select>
                <p class="text-[10px] text-text-faint mt-0.5">
                  How often the watchlist polls live prices (source-aware: Binance / OKX / Bybit /
                  Coinbase). Also adjustable from the watchlist panel.
                </p>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3.5 py-2.5 border-t-2 border-border bg-bg-base">
            <div class="flex-1 text-[10px] text-text-faint font-mono truncate">AXIS · plugins</div>
            <button type="button" class="sc-btn" onClick={props.onClose}>
              Cancel
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-primary inline-flex items-center gap-1"
              onClick={save}
            >
              <Icons.check size={13} />
              Save
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
