// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Results → Optimise tab — strategy-only hyperparameter search UI.
 *
 * @module ui/HpoPanel
 */

import { Component, For, Show, createEffect, createMemo, createSignal, onMount, untrack } from 'solid-js';
import {
  loadEditorDoc,
  setEditorInputValues,
  setIndicatorInputValues,
  setStore,
  store,
} from '../store';
import { detectScriptKind } from '../indicators/script-meta';
import { resolveScriptInputs } from '../results/script-inputs';
import { applyStrategyPropsToSource } from '../results/strategy-props';
import { runAndApply } from '../indicators/runner';
import { defaultParamFromInput, spaceReady } from '../optimize/space';
import type { ParamSpec } from '../optimize/types';
import { loadPersistedStudy, persistStudy, runHpoStudy } from '../optimize/client';
import type {
  ObjectiveId,
  SamplerId,
  StudySnapshot,
  ValidationId,
} from '../optimize/types';
import { MAX_TRIALS } from '../optimize/types';
import { Icons } from './icons';

const SAMPLER_IDS: readonly SamplerId[] = ['auto', 'random', 'tpe', 'grid'];
const OBJECTIVE_IDS: readonly ObjectiveId[] = ['net_pnl', 'profit_factor', 'calmar', 'composite'];
const VALIDATION_IDS: readonly ValidationId[] = ['holdout', 'walk-forward', 'in-sample'];

/** Persisted search config (settings + space) so a reload keeps the setup. */
const HPO_CONFIG_KEY = 'pynescript.axis.hpo.config.v1';

interface HpoConfig {
  nTrials: number;
  sampler: SamplerId;
  objective: ObjectiveId;
  validation: ValidationId;
  holdoutFrac: number;
  trainBars: number;
  testBars: number;
  stepBars: number;
  minTrades: number;
  params: ParamSpec[];
}

function isSampler(v: unknown): v is SamplerId {
  return SAMPLER_IDS.includes(v as SamplerId);
}
function isObjective(v: unknown): v is ObjectiveId {
  return OBJECTIVE_IDS.includes(v as ObjectiveId);
}
function isValidation(v: unknown): v is ValidationId {
  return VALIDATION_IDS.includes(v as ValidationId);
}
function isParamSpec(v: unknown): v is ParamSpec {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    ['int', 'float', 'bool', 'categorical'].includes(String(o.kind))
  );
}

function loadHpoConfig(): Partial<HpoConfig> | null {
  try {
    const raw = localStorage.getItem(HPO_CONFIG_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p !== 'object') return null;
    const out: Partial<HpoConfig> = {};
    if (typeof p.nTrials === 'number' && Number.isFinite(p.nTrials)) {
      out.nTrials = Math.min(MAX_TRIALS, Math.max(1, Math.round(p.nTrials)));
    }
    if (isSampler(p.sampler)) out.sampler = p.sampler;
    if (isObjective(p.objective)) out.objective = p.objective;
    if (isValidation(p.validation)) out.validation = p.validation;
    if (typeof p.holdoutFrac === 'number' && Number.isFinite(p.holdoutFrac)) {
      out.holdoutFrac = p.holdoutFrac;
    }
    if (typeof p.trainBars === 'number' && Number.isFinite(p.trainBars)) {
      out.trainBars = Math.max(1, Math.round(p.trainBars));
    }
    if (typeof p.testBars === 'number' && Number.isFinite(p.testBars)) {
      out.testBars = Math.max(1, Math.round(p.testBars));
    }
    if (typeof p.stepBars === 'number' && Number.isFinite(p.stepBars)) {
      out.stepBars = Math.max(1, Math.round(p.stepBars));
    }
    if (typeof p.minTrades === 'number' && Number.isFinite(p.minTrades)) {
      out.minTrades = Math.max(0, Math.round(p.minTrades));
    }
    if (Array.isArray(p.params)) out.params = p.params.filter(isParamSpec);
    return out;
  } catch {
    return null;
  }
}

function saveHpoConfig(cfg: HpoConfig): void {
  try {
    localStorage.setItem(HPO_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* quota */
  }
}

function currentScript(): { code: string; id: string | null; name: string } {
  const focus = store.resultsFocusId;
  if (focus && focus !== '__editor__') {
    const ind = store.scripts.find((s) => s.id === focus);
    if (ind?.code) return { code: ind.code, id: ind.id, name: ind.name };
  }
  return { code: loadEditorDoc() || '', id: null, name: 'Editor script' };
}

function currentInputValues(): Record<string, unknown> {
  const { id } = currentScript();
  if (id) {
    const ind = store.scripts.find((s) => s.id === id);
    return { ...(ind?.inputValues || {}) };
  }
  return { ...(store.editorInputValues || {}) };
}

function currentStrategyProps(): Record<string, unknown> | undefined {
  const { id } = currentScript();
  if (id) {
    const ind = store.scripts.find((s) => s.id === id);
    return ind?.strategyProps;
  }
  return store.editorStrategyProps;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Compact numeric formatting for chart axis labels / score chips. */
function formatScore(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  return v.toFixed(3);
}

/**
 * Merge a persisted param (bounds / choices / enabled) onto a freshly derived
 * spec. Numeric params that were persisted enabled but lost their min/max are
 * re-disabled so a stale config can never produce an invalid space.
 */
function mergeParam(derived: ParamSpec, prev?: ParamSpec): ParamSpec {
  if (!prev) return derived;
  const merged: ParamSpec = {
    ...derived,
    ...(prev.min != null ? { min: prev.min } : {}),
    ...(prev.max != null ? { max: prev.max } : {}),
    ...(prev.step != null ? { step: prev.step } : {}),
    ...(prev.choices ? { choices: prev.choices } : {}),
    enabled: prev.enabled ?? derived.enabled,
  };
  if (
    (merged.kind === 'int' || merged.kind === 'float') &&
    merged.enabled !== false &&
    (merged.min == null || merged.max == null || merged.min === merged.max)
  ) {
    merged.enabled = false;
  }
  return merged;
}

/** Dual-line chart of in-sample / out-of-sample scores across HPO trials. */
function TrialChart(props: {
  trials: { index: number; isScore?: number | null; oosScore?: number | null }[];
  bestIndex?: number | null;
}) {
  const W = 360;
  const H = 130;
  const PAD_L = 12;
  const PAD_R = 12;
  const PAD_T = 10;
  const PAD_B = 18;
  const PW = W - PAD_L - PAD_R;
  const PH = H - PAD_T - PAD_B;

  const rows = () => [...props.trials].sort((a, b) => a.index - b.index);
  const isPts = () =>
    rows()
      .filter((t) => t.isScore != null)
      .map((t) => ({ i: t.index, v: t.isScore! }));
  const oosPts = () =>
    rows()
      .filter((t) => t.oosScore != null)
      .map((t) => ({ i: t.index, v: t.oosScore! }));

  const bounds = () => {
    const vals = [...isPts(), ...oosPts()].map((p) => p.v);
    if (!vals.length) return null;
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    return { min, max };
  };

  // x is pinned to the trial index so IS and OOS lines stay aligned even when
  // some trials error out (null scores) — not the filtered-array position.
  const maxIndex = () => rows().reduce((m, t) => Math.max(m, t.index), 0);
  const xOf = (idx: number) => PAD_L + (maxIndex() > 0 ? (idx / maxIndex()) * PW : PW / 2);
  const yOf = (v: number, b: { min: number; max: number }) =>
    PAD_T + PH - ((v - b.min) / (b.max - b.min)) * PH;

  const line = (pts: { i: number; v: number }[]) => {
    const b = bounds();
    if (!b || pts.length < 2) return '';
    return pts
      .map((p, k) => `${k === 0 ? 'M' : 'L'} ${xOf(p.i).toFixed(1)} ${yOf(p.v, b).toFixed(1)}`)
      .join(' ');
  };

  const bestMarker = () => {
    if (props.bestIndex == null) return null;
    const b = bounds();
    const row = rows().find((r) => r.index === props.bestIndex);
    if (!b || !row || row.isScore == null) return null;
    return { x: xOf(row.index), y: yOf(row.isScore, b) };
  };

  return (
    <div class="ax-hpo-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} class="ax-hpo-chart" preserveAspectRatio="none" aria-hidden="true">
        <Show when={bounds()}>
          {(b) => (
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yOf(b().max, b())}
              y2={yOf(b().max, b())}
              class="ax-hpo-baseline"
            />
          )}
        </Show>
        <path d={line(isPts())} class="ax-hpo-line-is" fill="none" />
        <path d={line(oosPts())} class="ax-hpo-line-oos" fill="none" />
        <Show when={bestMarker()}>
          {(m) => (
            <>
              <line x1={m().x} x2={m().x} y1={PAD_T} y2={PAD_T + PH} class="ax-hpo-bestline" />
              <circle cx={m().x} cy={m().y} r={2.5} class="ax-hpo-bestdot" />
            </>
          )}
        </Show>
      </svg>
      <div class="ax-hpo-chart-legend">
        <span class="ax-hpo-legend-is">In-sample</span>
        <span class="ax-hpo-legend-oos">Out-of-sample</span>
        <Show when={bounds()}>
          {(b) => (
            <span class="ax-hpo-scale">
              max {formatScore(b().max)} · min {formatScore(b().min)}
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}

export const HpoPanel: Component = () => {
  const initial = loadHpoConfig();

  const [params, setParams] = createSignal<ParamSpec[]>(initial?.params ?? []);
  const [nTrials, setNTrials] = createSignal(initial?.nTrials ?? 30);
  const [sampler, setSampler] = createSignal<SamplerId>(initial?.sampler ?? 'auto');
  const [objective, setObjective] = createSignal<ObjectiveId>(initial?.objective ?? 'composite');
  const [validation, setValidation] = createSignal<ValidationId>(initial?.validation ?? 'holdout');
  const [holdoutFrac, setHoldoutFrac] = createSignal(initial?.holdoutFrac ?? 0.3);
  const [trainBars, setTrainBars] = createSignal(initial?.trainBars ?? 200);
  const [testBars, setTestBars] = createSignal(initial?.testBars ?? 50);
  const [stepBars, setStepBars] = createSignal(initial?.stepBars ?? 50);
  const [minTrades, setMinTrades] = createSignal(initial?.minTrades ?? 5);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [study, setStudy] = createSignal<StudySnapshot | null>(null);
  let abort: AbortController | null = null;

  const kind = createMemo(() => detectScriptKind(currentScript().code));
  const barsN = createMemo(() => store.bars?.length ?? 0);
  const ready = createMemo(() => spaceReady(params()));

  const refreshSpace = (source?: ParamSpec[]) => {
    const { code } = currentScript();
    const defs = resolveScriptInputs(code, null);
    const derived = defs.map(defaultParamFromInput).filter((p): p is ParamSpec => !!p);
    const byName = new Map((source ?? params()).map((p) => [p.name, p] as const));
    setParams(derived.map((p) => mergeParam(p, byName.get(p.name))));
  };

  onMount(() => {
    // Merge persisted bounds into freshly parsed inputs; then restore the study.
    refreshSpace();
    const prev = loadPersistedStudy();
    if (prev) setStudy(prev);
  });

  // Persist search config (settings + space) on any change.
  createEffect(() => {
    saveHpoConfig({
      nTrials: nTrials(),
      sampler: sampler(),
      objective: objective(),
      validation: validation(),
      holdoutFrac: holdoutFrac(),
      trainBars: trainBars(),
      testBars: testBars(),
      stepBars: stepBars(),
      minTrades: minTrades(),
      params: params(),
    });
  });

  // Refresh the search space only when the focused script actually changes —
  // not on every store update (e.g. live ticks that mutate store.scripts /
  // editorDoc), which would reset `params()` and steal focus from the inputs.
  let lastSpaceCode = '';
  createEffect(() => {
    void store.resultsFocusId;
    const code = untrack(() => currentScript().code);
    if (code !== lastSpaceCode) {
      lastSpaceCode = code;
      refreshSpace();
    }
  });

  // Walk-forward is a Pro feature — force back to holdout on the free tier.
  createEffect(() => {
    if (store.tier === 'free' && validation() === 'walk-forward') setValidation('holdout');
  });

  const gate = createMemo(() => {
    if (kind() !== 'strategy') return 'Only strategy() scripts can be optimised.';
    if (barsN() < 8) return 'Load more bars before searching.';
    if (!params().length) return 'No searchable input.int / float / bool / enum fields.';
    if (!ready().ok) return ready().reason || 'Fix search bounds.';
    return '';
  });

  const start = async () => {
    const reason = gate();
    if (reason) return;
    const { code } = currentScript();
    const script = applyStrategyPropsToSource(code, currentStrategyProps());
    setError('');
    setBusy(true);
    abort = new AbortController();
    try {
      const snap = await runHpoStudy({
        script,
        bars: store.bars || [],
        params: params(),
        fixedInputs: currentInputValues(),
        nTrials: nTrials(),
        sampler: sampler(),
        objective: objective(),
        validation: {
          mode: validation(),
          holdoutFrac: holdoutFrac(),
          trainBars: trainBars(),
          testBars: testBars(),
          stepBars: stepBars(),
        },
        minTrades: minTrades(),
        signal: abort.signal,
        onTrial: (_row, partial) => {
          setStudy((prev) =>
            prev
              ? { ...prev, trials: partial.trials || prev.trials, engineRuns: partial.engineRuns ?? prev.engineRuns }
              : {
                  status: 'running',
                  sampler: sampler(),
                  objective: objective(),
                  validation: {
                    mode: validation(),
                    holdoutFrac: holdoutFrac(),
                    trainBars: trainBars(),
                    testBars: testBars(),
                    stepBars: stepBars(),
                  },
                  nTrials: nTrials(),
                  trials: partial.trials || [],
                  engineRuns: partial.engineRuns || 0,
                  ms: 0,
                },
          );
        },
      });
      setStudy(snap);
      persistStudy(snap);
      if (snap.status === 'error') setError(snap.error || 'Study failed');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setStudy((s) => (s ? { ...s, status: 'cancelled' } : s));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abort = null;
      setBusy(false);
    }
  };

  const cancel = () => abort?.abort();

  const clear = () => {
    setStudy(null);
    setError('');
    persistStudy(null);
  };

  const applyBest = async (rerun: boolean) => {
    const snap = study();
    if (!snap?.bestParams) return;
    const { id } = currentScript();
    const merged = { ...currentInputValues(), ...snap.bestParams };
    if (id) setIndicatorInputValues(id, merged);
    else setEditorInputValues(merged);
    if (rerun) {
      setStore('resultsPanel', 'open', true);
      await runAndApply(currentScript().code, id || undefined, {
        inputs: merged,
        strategyProps: currentStrategyProps(),
      });
    }
  };

  const exportCsv = () => {
    const snap = study();
    if (!snap?.trials.length) return;
    const keys = params()
      .filter((p) => p.enabled !== false)
      .map((p) => p.name);
    const header = ['index', ...keys, 'is_score', 'oos_score', 'error'].join(',');
    const rows = snap.trials.map((t) =>
      [
        t.index,
        ...keys.map((k) => t.params[k] ?? ''),
        t.isScore ?? '',
        t.oosScore ?? '',
        t.error ?? '',
      ].join(','),
    );
    downloadText(`axis-hpo-${Date.now()}.csv`, [header, ...rows].join('\n'));
  };

  const patchParam = (name: string, patch: Partial<ParamSpec>) => {
    setParams((list) => list.map((p) => (p.name === name ? { ...p, ...patch } : p)));
  };

  const statusClass = (status: string): string => {
    switch (status) {
      case 'success':
        return 'ax-status--healthy';
      case 'running':
        return 'ax-status--idle';
      case 'error':
        return 'ax-status--down';
      case 'cancelled':
        return 'ax-status--skipped';
      default:
        return 'ax-status--unknown';
    }
  };

  const runningButNoStudy = () => busy() && !study();

  return (
    <div class="ax-stack ax-stack--compact" data-testid="axis-hpo-panel">
      <Show when={store.tier !== 'free'}>
        <div class="ax-inline">
          <span
            class={store.tier === 'pro' ? 'ax-badge ax-badge--pro' : 'ax-badge ax-badge--selfhosted'}
            data-testid="axis-hpo-tier-badge"
          >
            {store.tier === 'pro' ? 'Pro' : 'Self-hosted'}
          </span>
        </div>
      </Show>
      <Show when={gate()}>
        <p class="ax-error">{gate()}</p>
      </Show>
      <Show when={validation() === 'in-sample'}>
        <p class="ax-hint ax-hint--accent">In-sample only will overfit. Prefer Holdout.</p>
      </Show>
      <Show when={store.tier === 'free'}>
        <p class="ax-hint">
          Walk-forward validation is a Pro feature — upgrade to unlock deeper out-of-sample checks.
        </p>
      </Show>

      <div class={`ax-hpo-split${study() || busy() || error() ? '' : ' ax-hpo-split--solo'}`}>
        <div class="ax-hpo-col">
          <section class="ax-section">
            <h3 class="ax-section-title">Search configuration</h3>
            <div class="ax-grid ax-grid--3">
              <label class="ax-field">
                <span class="ax-label">Trials</span>
                <input
                  class="ax-input"
                  type="number"
                  min={1}
                  max={MAX_TRIALS}
                  value={nTrials()}
                  onInput={(e) => setNTrials(Math.min(MAX_TRIALS, Math.max(1, Number(e.currentTarget.value) || 1)))}
                />
              </label>
              <label class="ax-field">
                <span class="ax-label">Sampler</span>
                <select
                  class="ax-select"
                  value={sampler()}
                  onChange={(e) => setSampler(e.currentTarget.value as SamplerId)}
                >
                  <option value="auto">auto</option>
                  <option value="random">random</option>
                  <option value="tpe">tpe</option>
                  <option value="grid">grid</option>
                </select>
              </label>
              <label class="ax-field">
                <span class="ax-label">Objective</span>
                <select
                  class="ax-select"
                  value={objective()}
                  onChange={(e) => setObjective(e.currentTarget.value as ObjectiveId)}
                >
                  <option value="composite">composite</option>
                  <option value="net_pnl">net pnl</option>
                  <option value="profit_factor">profit factor</option>
                  <option value="calmar">calmar-like</option>
                </select>
              </label>
              <label class="ax-field">
                <span class="ax-label">Validation</span>
                <select
                  class="ax-select"
                  value={validation()}
                  onChange={(e) => setValidation(e.currentTarget.value as ValidationId)}
                >
                  <option value="holdout">holdout</option>
                  <option value="walk-forward" disabled={store.tier === 'free'}>
                    walk-forward{store.tier === 'free' ? ' (Pro)' : ''}
                  </option>
                  <option value="in-sample">in-sample</option>
                </select>
              </label>
              <label class="ax-field">
                <span class="ax-label">Min trades</span>
                <input
                  class="ax-input"
                  type="number"
                  min={0}
                  value={minTrades()}
                  onInput={(e) => setMinTrades(Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))}
                />
              </label>
              <Show when={validation() === 'holdout'}>
                <label class="ax-field">
                  <span class="ax-label">Holdout</span>
                  <input
                    class="ax-input"
                    type="number"
                    step="0.05"
                    min={0.1}
                    max={0.5}
                    value={holdoutFrac()}
                    onInput={(e) => setHoldoutFrac(Number(e.currentTarget.value) || 0.3)}
                    onBlur={(e) => setHoldoutFrac(Math.min(0.5, Math.max(0.1, Number(e.currentTarget.value) || 0.3)))}
                  />
                </label>
              </Show>
              <Show when={validation() === 'walk-forward'}>
                <label class="ax-field">
                  <span class="ax-label">Train</span>
                  <input
                    class="ax-input"
                    type="number"
                    min={1}
                    value={trainBars()}
                    onInput={(e) => setTrainBars(Math.max(1, Math.round(Number(e.currentTarget.value) || 1)))}
                  />
                </label>
                <label class="ax-field">
                  <span class="ax-label">Test</span>
                  <input
                    class="ax-input"
                    type="number"
                    min={1}
                    value={testBars()}
                    onInput={(e) => setTestBars(Math.max(1, Math.round(Number(e.currentTarget.value) || 1)))}
                  />
                </label>
                <label class="ax-field">
                  <span class="ax-label">Step</span>
                  <input
                    class="ax-input"
                    type="number"
                    min={1}
                    value={stepBars()}
                    onInput={(e) => setStepBars(Math.max(1, Math.round(Number(e.currentTarget.value) || 1)))}
                  />
                </label>
              </Show>
            </div>

            <div class="ax-inline">
              <button
                type="button"
                class="ax-btn ax-btn--ghost"
                onClick={() => refreshSpace()}
                disabled={busy()}
              >
                <Icons.refresh />
                Refresh inputs
              </button>
              <Show
                when={!busy()}
                fallback={
                  <button type="button" class="ax-btn" onClick={cancel}>
                    Cancel
                  </button>
                }
              >
                <button
                  type="button"
                  class="ax-btn ax-btn--primary"
                  data-testid="axis-hpo-start"
                  disabled={!!gate()}
                  onClick={() => void start()}
                >
                  <Icons.play />
                  Start search
                </button>
              </Show>
            </div>
          </section>

          <section class="ax-section">
            <h3 class="ax-section-title">Search space</h3>
            <Show
              when={params().length}
              fallback={<p class="ax-empty">No searchable input.int / float / bool / enum fields.</p>}
            >
              <div class="ax-list ax-list--dense">
                <For each={params()}>
                  {(p) => (
                    <div class="ax-row">
                      <label class="ax-toggle">
                        <input
                          type="checkbox"
                          checked={p.enabled !== false}
                          onChange={(e) => patchParam(p.name, { enabled: e.currentTarget.checked })}
                        />
                        <span>
                          <span class="ax-toggle-title">{p.name}</span>
                          <span class="ax-toggle-hint">
                            {p.kind}
                            {p.kind === 'categorical' && p.choices?.length ? ` · ${p.choices.join(', ')}` : ''}
                          </span>
                        </span>
                      </label>
                      <Show when={p.kind === 'int' || p.kind === 'float'}>
                        <div class="ax-hpo-bounds">
                          <input
                            class="ax-input"
                            type="number"
                            placeholder="min"
                            value={p.min ?? ''}
                            onInput={(e) =>
                              patchParam(p.name, { min: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })
                            }
                          />
                          <input
                            class="ax-input"
                            type="number"
                            placeholder="max"
                            value={p.max ?? ''}
                            onInput={(e) =>
                              patchParam(p.name, { max: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })
                            }
                          />
                          <input
                            class="ax-input"
                            type="number"
                            placeholder="step"
                            value={p.step ?? ''}
                            onInput={(e) =>
                              patchParam(p.name, {
                                step: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value),
                              })
                            }
                          />
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>

        <Show when={study() || busy() || error()}>
        <div class="ax-hpo-col">
          <Show when={error()}>
            <p class="ax-error">{error()}</p>
          </Show>

          <Show when={runningButNoStudy()}>
            <p class="ax-hint">Searching on the engine… this can take a moment.</p>
          </Show>

          <Show when={study()}>
            {(s) => (
              <section class="ax-section">
                <div class="ax-toolbar">
                  <span class={`ax-status ${statusClass(s().status)}`}>{s().status}</span>
                  <p class="ax-hint">
                    {s().trials.length}/{s().nTrials} trials · {s().engineRuns} runs ·{' '}
                    {s().backend || '—'} · {Math.round(s().ms)}ms
                  </p>
                  <Show when={s().warning}>
                    <span class="ax-hint ax-hint--accent">{s().warning}</span>
                  </Show>
                </div>

                <TrialChart trials={s().trials} bestIndex={s().bestIndex} />

                <Show when={s().bestParams}>
                  <div class="ax-toolbar">
                    <p class="ax-hint ax-hint--accent">
                      best{' '}
                      {Object.entries(s().bestParams || {})
                        .map(([k, v]) => `${k}=${v}`)
                        .join(' ')}
                      <Show when={s().bestIsScore != null}> · IS {formatScore(s().bestIsScore!)}</Show>
                      <Show when={s().bestOosScore != null}> · OOS {formatScore(s().bestOosScore!)}</Show>
                    </p>
                    <span class="ax-toolbar-spacer" />
                    <button
                      type="button"
                      class="ax-btn ax-btn--ghost"
                      disabled={busy()}
                      onClick={() => void applyBest(false)}
                    >
                      Apply best
                    </button>
                    <button
                      type="button"
                      class="ax-btn ax-btn--ghost"
                      disabled={busy()}
                      onClick={() => void applyBest(true)}
                    >
                      Apply + re-run
                    </button>
                    <button type="button" class="ax-btn ax-btn--ghost" onClick={exportCsv}>
                      <Icons.fileCsv />
                      CSV
                    </button>
                    <button type="button" class="ax-btn ax-btn--ghost" onClick={clear} disabled={busy()}>
                      <Icons.trash />
                      Clear
                    </button>
                  </div>
                </Show>

                <Show
                  when={s().trials.length}
                  fallback={<p class="ax-empty">No trials yet.</p>}
                >
                  <div class="ax-table-wrap">
                    <table class="ax-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>params</th>
                          <th>IS</th>
                          <th>OOS</th>
                          <th>err</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={s().trials}>
                          {(t) => (
                            <tr class={t.index === s().bestIndex ? 'is-best' : undefined}>
                              <td>{t.index}</td>
                              <td class="ax-table-cell-wrap">{Object.entries(t.params).map(([k, v]) => `${k}=${v}`).join(' ')}</td>
                              <td>{t.isScore == null ? '—' : t.isScore.toFixed(3)}</td>
                              <td>{t.oosScore == null ? '—' : t.oosScore.toFixed(3)}</td>
                              <td class="ax-table-neg">{t.error || ''}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </section>
            )}
          </Show>
        </div>
        </Show>
      </div>
    </div>
  );
};
