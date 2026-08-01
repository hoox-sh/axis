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
 * Application Settings modal — engine endpoint/mode, storage plugin, chart
 * interval / history bars, live prefs (preferAfterLoad, rerunOn), HUD compact,
 * UI scale.
 *
 * Local form state is seeded from `store` when the dialog opens (not on every
 * store mutation while open). Save snapshots form fields, writes
 * `pluginsConfig` / `activePlugins` / layout prefs, then `flushPersist()`.
 * Endpoint **Probe** uses `probeEndpoint` without committing form values.
 */

import { Component, For, createEffect, createSignal, Show, createMemo, untrack } from 'solid-js';
import { reconcile } from 'solid-js/store';
import {
  store,
  setStore,
  flushPersist,
  setStatus,
  setActivePlugin,
  setUiScale,
  clampUiScale,
  clampHistoryBars,
  HISTORY_BARS_MIN,
  HISTORY_BARS_MAX,
  HISTORY_BARS_DEFAULT,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_STEP,
  applyUiScale,
} from '../store';
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
import { UI_SCALE_PRESETS, formatUiScalePct } from './ui-scale';

/** PYNE Runtime modes for the server/worker engine plugin config. */
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

/** Modal settings form; parent controls `open` / `onClose`. */
export const SettingsDialog: Component<Props> = (props) => {
  const [endpoint, setEndpoint] = createSignal(store.endpoint);
  const [engine, setEngine] = createSignal(store.engine);
  const [execMode, setExecMode] = createSignal<EngineExecMode>('interpret');
  const [preferWs, setPreferWs] = createSignal(true);
  const [storage, setStorage] = createSignal(store.activePlugins?.storage || 'local');
  const [chartInterval, setChartInterval] = createSignal(store.interval);
  const [historyBars, setHistoryBars] = createSignal(
    clampHistoryBars(store.historyBars ?? HISTORY_BARS_DEFAULT),
  );
  const [refreshSec, setRefreshSec] = createSignal(store.watchlist.refreshSec || 15);
  const [preferAfterLoad, setPreferAfterLoad] = createSignal(!!store.live.preferAfterLoad);
  const [rerunOn, setRerunOn] = createSignal<'every-tick' | 'bar-close'>(
    store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick',
  );
  const [hudCompact, setHudCompact] = createSignal(!!store.telemetry?.hud?.compact);
  const [uiScale, setUiScaleLocal] = createSignal(clampUiScale(store.uiScale ?? 1));
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
  /**
   * Execution mode: always for built-in server/pyodide (by id), plus any engine
   * that advertises configSchema.mode. Do not rely only on schema discovery —
   * a dynamic plugin that clobbered `server` used to hide the control.
   */
  const hasExecMode = createMemo(() => {
    const id = engine() || selectedEngine()?.id || '';
    if (id === 'server' || id === 'pyodide') return true;
    const schema = selectedEngine()?.configSchema;
    if (!schema?.mode) return false;
    // Accept select schemas even if type string was lost on a shallow clone
    return schema.mode.type === 'select' || Array.isArray(schema.mode.options);
  });
  const hasPreferWs = createMemo(() => {
    const id = engine() || selectedEngine()?.id || '';
    if (id === 'server') return true;
    return selectedEngine()?.configSchema?.preferWs?.type === 'boolean';
  });
  const execModeOptions = createMemo(() => {
    const opts = selectedEngine()?.configSchema?.mode?.options;
    if (!opts?.length) return EXEC_MODE_OPTIONS;
    const filtered = EXEC_MODE_OPTIONS.filter((o) => opts.includes(o.value));
    return filtered.length ? filtered : EXEC_MODE_OPTIONS;
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

  /**
   * Seed form only when the dialog *opens*. Do not re-read the store on every
   * store mutation while open — Save calls setStore many times and a reactive
   * hydrate would reset local signals mid-save (wrong values persisted).
   */
  createEffect((wasOpen?: boolean) => {
    const isOpen = props.open;
    if (isOpen && !wasOpen) {
      untrack(() => {
        setEndpoint(store.endpoint);
        setEngine(store.engine);
        hydrateEngineFields(store.engine);
        setStorage(store.activePlugins?.storage || 'local');
        setChartInterval(store.interval);
        setHistoryBars(clampHistoryBars(store.historyBars ?? HISTORY_BARS_DEFAULT));
        setRefreshSec(store.watchlist.refreshSec || 15);
        setPreferAfterLoad(!!store.live.preferAfterLoad);
        setRerunOn(store.live.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick');
        setHudCompact(!!store.telemetry?.hud?.compact);
        setUiScaleLocal(clampUiScale(store.uiScale ?? 1));
        setProbeMsg('');
      });
    }
    return isOpen;
  });

  /** Live density preview while dragging (persists on Save or preset click). */
  const previewScale = (raw: number) => {
    const s = clampUiScale(raw);
    setUiScaleLocal(s);
    applyUiScale(s);
  };

  const save = async () => {
    // Snapshot every form field *before* any setStore. Mid-save store updates
    // must not re-enter the hydrate effect or re-read stale signals.
    const prevInterval = store.interval;
    const prevHistoryBars = clampHistoryBars(store.historyBars);
    const nextInterval = chartInterval().trim() || prevInterval;
    const nextHistoryBars = clampHistoryBars(historyBars());
    const nextRefresh = Math.min(120, Math.max(5, Math.round(Number(refreshSec()) || 15)));
    const nextEngine = engine();
    const nextEndpoint = endpoint().trim();
    const nextStorage = storage();
    const nextPreferAfterLoad = preferAfterLoad();
    const nextRerunOn = rerunOn();
    const nextHudCompact = hudCompact();
    const nextUiScale = clampUiScale(uiScale());
    const nextExecMode = execMode();
    const nextPreferWs = preferWs();
    const writeEndpoint = needsEndpoint();
    const writeExecMode = hasExecMode();
    const writePreferWs = hasPreferWs();

    // Batch all durable fields before persist so one flush sees full state
    setStore('endpoint', nextEndpoint);
    setStore('interval', nextInterval);
    setStore('historyBars', nextHistoryBars);
    setStore('watchlist', 'refreshSec', nextRefresh);
    setStore('live', 'preferAfterLoad', nextPreferAfterLoad);
    setStore('live', 'rerunOn', nextRerunOn);
    setStore('telemetry', 'hud', 'compact', nextHudCompact);
    setStore('uiScale', nextUiScale);
    applyUiScale(nextUiScale);
    // setActivePlugin keeps flat engine/source fields + telemetry planes aligned
    setActivePlugin('engine', nextEngine);
    setActivePlugin('storage', nextStorage);

    // Always merge engine plugin config when any engine field is shown — include
    // endpoint so pluginsConfig cannot keep a stale URL over store.endpoint.
    if (writeEndpoint || writeExecMode || writePreferWs) {
      const key = pluginKey('engine', nextEngine);
      const prev = readEnginePluginConfig(nextEngine);
      const nextCfg: Record<string, unknown> = { ...prev };
      if (writeEndpoint) nextCfg.endpoint = nextEndpoint;
      if (writeExecMode) nextCfg.mode = nextExecMode;
      if (writePreferWs) nextCfg.preferWs = nextPreferWs;
      // reconcile replaces nested keys (Solid merges plain objects / function returns)
      setStore('pluginsConfig', key, reconcile(nextCfg));
    }

    // Write immediately so a quick reload cannot race the 200ms debounce
    flushPersist();
    const modePart = writeExecMode ? ` · mode=${nextExecMode}` : '';
    setStatus(
      'ready',
      `Settings saved · ${nextInterval} · ${nextHistoryBars} bars · refresh ${nextRefresh}s · engine=${nextEngine}${modePart} · live re-run=${nextRerunOn}`,
    );
    // Reload chart when interval or history depth changes
    if (
      store.symbol &&
      (nextInterval !== prevInterval || nextHistoryBars !== prevHistoryBars)
    ) {
      void loadSymbolData(store.symbol, nextInterval, store.source);
    }
    props.onClose();
  };

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      // Restore committed scale if user closed without Save after preview
      applyUiScale(store.uiScale);
      props.onClose();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      applyUiScale(store.uiScale);
      props.onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  };

  const closeWithoutSave = () => {
    applyUiScale(store.uiScale);
    props.onClose();
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
        class="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-4 backdrop-blur-[2px]"
        onClick={onBackdrop}
        onKeyDown={onKey}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(540px,calc(100vw-32px))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-settings-title"
          data-testid="axis-settings"
          tabIndex={-1}
          ref={(el) => queueMicrotask(() => el?.focus())}
        >
          <div class="sc-dialog-accent" />

          <div class="sc-dialog-header">
            <div class="min-w-0">
              <div
                id="axis-settings-title"
                class="text-[0.95em] font-semibold text-text tracking-tight"
              >
                Settings
              </div>
              <div class="sc-hint mt-0">Engine · density · chart · live</div>
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2"
              onClick={closeWithoutSave}
              aria-label="Close"
            >
              <Icons.x />
            </button>
          </div>

          <div class="sc-dialog-body">
            {/* ── Appearance / density ─────────────────────────────── */}
            <div class="flex flex-col gap-2" data-testid="axis-ui-scale-field">
              <div class="sc-section-title">Appearance</div>
              <div class="flex items-center justify-between gap-2">
                <label class="sc-label" for="axis-ui-scale">
                  UI scale
                </label>
                <span
                  class="font-mono text-[0.85em] tabular-nums text-accent"
                  data-testid="axis-ui-scale-value"
                >
                  {formatUiScalePct(uiScale())}
                </span>
              </div>
              <input
                id="axis-ui-scale"
                class="sc-range"
                type="range"
                min={UI_SCALE_MIN}
                max={UI_SCALE_MAX}
                step={UI_SCALE_STEP}
                value={uiScale()}
                data-testid="axis-ui-scale"
                aria-valuemin={UI_SCALE_MIN}
                aria-valuemax={UI_SCALE_MAX}
                aria-valuenow={uiScale()}
                aria-label="UI scale"
                onInput={(e) => previewScale(Number(e.currentTarget.value))}
              />
              <div class="flex justify-between text-[0.72em] text-text-faint font-mono tabular-nums">
                <span>{formatUiScalePct(UI_SCALE_MIN)}</span>
                <span>100%</span>
                <span>{formatUiScalePct(UI_SCALE_MAX)}</span>
              </div>
              <div class="sc-chip-row" role="group" aria-label="Scale presets">
                <For each={UI_SCALE_PRESETS}>
                  {(p) => (
                    <button
                      type="button"
                      class={`sc-chip ${Math.abs(uiScale() - p.value) < 0.01 ? 'is-active' : ''}`}
                      aria-pressed={Math.abs(uiScale() - p.value) < 0.01}
                      title={p.hint}
                      onClick={() => {
                        previewScale(p.value);
                        // Preset click commits scale immediately (Save still needed for other fields)
                        setUiScale(p.value);
                      }}
                    >
                      {p.label}
                    </button>
                  )}
                </For>
              </div>
              <p class="sc-hint">
                Scales text, icons, inputs, padding, and gaps. Chart candles stay sharp (canvas not
                zoomed). Live preview — Save to keep.
              </p>
              <div
                class="flex items-center gap-2 mt-0.5 p-2.5 bg-bg-elev border border-border-soft rounded-[var(--radius-sc)]"
                aria-hidden="true"
              >
                <button type="button" class="sc-btn sc-btn-primary">
                  <Icons.play />
                  Run
                </button>
                <button type="button" class="sc-btn sc-btn-ghost">
                  <Icons.layers />
                  Layers
                </button>
                <input class="sc-input min-w-0 flex-1 font-mono" value="BTCUSDT" readOnly />
              </div>
            </div>

            <div class="sc-section">
              <div class="sc-section-title">Engine</div>
            <div class="sc-field">
              <label class="sc-label" for="axis-engine">
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
              <div class="sc-field" data-testid="axis-exec-mode-field">
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
                  {engine() === 'pyodide'
                    ? `HUD: ENG local · RUN browser. ${execModeHint()} Numba compile needs RUN server (CPython).`
                    : `HUD: ENG local|remote (from Backend URL) · RUN server (or worker if edge URL). ${execModeHint()}`}
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
              <div class="sc-field">
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
                <div class="flex flex-wrap gap-1 mt-0.5">
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1.5 py-0.5 text-[10px] font-mono"
                    data-testid="axis-endpoint-preset-local"
                    title="VPS (or any remote) AXIS UI + pyne on this PC — for Numba compile"
                    onClick={() => {
                      setEndpoint('http://127.0.0.1:5002');
                      setEngine('server');
                      setExecMode('compile');
                      setPreferWs(true);
                      setProbeMsg('');
                    }}
                  >
                    Local pyne · compile
                  </button>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1.5 py-0.5 text-[10px] font-mono"
                    data-testid="axis-endpoint-preset-vps"
                    title="Demo API on the VPS (interpret/compile if numba installed there)"
                    onClick={() => {
                      setEndpoint('http://162.254.38.194:5002');
                      setEngine('server');
                      setProbeMsg('');
                    }}
                  >
                    VPS pyne API
                  </button>
                </div>
                <Show
                  when={(() => {
                    const ep = endpoint().trim().toLowerCase();
                    const loop =
                      ep.includes('localhost') ||
                      ep.includes('127.0.0.1') ||
                      ep.includes('0.0.0.0');
                    const remotePage =
                      typeof location !== 'undefined' &&
                      location.hostname !== 'localhost' &&
                      location.hostname !== '127.0.0.1';
                    return loop && remotePage;
                  })()}
                >
                  <p
                    class="text-[10px] text-orange font-mono mt-0.5 leading-relaxed"
                    data-testid="axis-endpoint-loopback-warn"
                  >
                    <strong class="text-orange">VPS UI → local compile:</strong> Browser calls{' '}
                    <em>this PC</em> at 127.0.0.1:5002 (not the VPS API). Checklist:
                    <br />
                    1) On PC: <code class="text-text-dim">pip install numba && make run</code> (pyne :5002)
                    <br />
                    2) Local CORS must allow this page origin (
                    <code class="text-text-dim">
                      {typeof location !== 'undefined' ? location.origin : '…'}
                    </code>
                    ) — latest pyne allows demo host by default, or{' '}
                    <code class="text-text-dim">ALLOWED_ORIGINS=*</code>
                    <br />
                    3) Engine server · Mode compile · Test → then Save
                  </p>
                </Show>
                <Show when={probeMsg()}>
                  <p
                    class={`text-[10px] font-mono mt-0.5 break-words ${
                      probeMsg().startsWith('✓') ? 'text-accent-2' : 'text-red'
                    }`}
                  >
                    {probeMsg()}
                  </p>
                </Show>
                <p class="text-[10px] text-text-faint mt-0.5">
                  Server engine + LSP (completion/hover) use this URL. Cross-origin needs CORS on
                  pyne (page origin must be allowed).
                </p>
              </div>
            </Show>

            <div class="sc-field">
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

            </div>

            <div class="sc-section">
              <div class="sc-section-title">Chart &amp; watchlist</div>

              <div class="sc-field">
                <label class="sc-label" for="axis-default-interval">
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

              <div class="sc-field">
                <label class="sc-label" for="axis-history-bars">
                  Historical bars
                </label>
                <input
                  id="axis-history-bars"
                  type="number"
                  class="sc-input w-full font-mono"
                  min={HISTORY_BARS_MIN}
                  max={HISTORY_BARS_MAX}
                  step={50}
                  value={historyBars()}
                  onInput={(e) => setHistoryBars(Number(e.currentTarget.value))}
                  onChange={(e) =>
                    setHistoryBars(clampHistoryBars(e.currentTarget.value))
                  }
                />
                <p class="text-[10px] text-text-faint mt-0.5">
                  Bars requested on Load / symbol change ({HISTORY_BARS_MIN}–{HISTORY_BARS_MAX}).
                  Default {HISTORY_BARS_DEFAULT}. Venues may return fewer (e.g. OKX max 300,
                  Binance max 1000). Saved with your other settings.
                </p>
              </div>

              <div class="sc-section !mt-0 !border-t-0 !pt-0">
                <div class="sc-section-title">Live stream</div>

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

                <div class="sc-field">
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

              <div class="sc-field">
                <label
                  class="text-[10px] text-text-dim uppercase tracking-wider"
                  for="axis-watchlist-refresh"
                >
                  Watchlist REST fallback
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
                  Used only when WebSocket quotes fail. While live, prices update on every exchange
                  ticker tick (Binance / OKX / Bybit / Coinbase).
                </p>
              </div>
            </div>
          </div>

          <div class="sc-dialog-footer">
            <div class="flex-1 text-[0.72em] text-text-faint font-mono truncate">
              AXIS · scale {formatUiScalePct(uiScale())}
            </div>
            <button type="button" class="sc-btn" onClick={closeWithoutSave}>
              Cancel
            </button>
            <button type="button" class="sc-btn sc-btn-primary" onClick={save}>
              <Icons.check />
              Save
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
