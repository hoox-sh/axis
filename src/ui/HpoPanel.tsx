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

import { Component, For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import {
  loadEditorDoc,
  setEditorInputValues,
  setIndicatorInputValues,
  setPanelOpen,
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

export const HpoPanel: Component = () => {
  const [params, setParams] = createSignal<ParamSpec[]>([]);
  const [nTrials, setNTrials] = createSignal(30);
  const [sampler, setSampler] = createSignal<SamplerId>('auto');
  const [objective, setObjective] = createSignal<ObjectiveId>('composite');
  const [validation, setValidation] = createSignal<ValidationId>('holdout');
  const [holdoutFrac, setHoldoutFrac] = createSignal(0.3);
  const [trainBars, setTrainBars] = createSignal(200);
  const [testBars, setTestBars] = createSignal(50);
  const [stepBars, setStepBars] = createSignal(50);
  const [minTrades, setMinTrades] = createSignal(5);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [study, setStudy] = createSignal<StudySnapshot | null>(null);
  let abort: AbortController | null = null;

  const kind = createMemo(() => detectScriptKind(currentScript().code));
  const barsN = createMemo(() => store.bars?.length ?? 0);
  const ready = createMemo(() => spaceReady(params()));

  const refreshSpace = () => {
    const { code } = currentScript();
    const defs = resolveScriptInputs(code, null);
    setParams(defs.map(defaultParamFromInput).filter((p): p is ParamSpec => !!p));
  };

  onMount(() => {
    refreshSpace();
    const prev = loadPersistedStudy();
    if (prev) setStudy(prev);
  });

  createEffect(() => {
    void (store.resultsFocusId || 'editor');
    refreshSpace();
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
    if (reason) {
      setError(reason);
      return;
    }
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

  const applyBest = async (rerun: boolean) => {
    const snap = study();
    if (!snap?.bestParams) return;
    const { id } = currentScript();
    const merged = { ...currentInputValues(), ...snap.bestParams };
    if (id) setIndicatorInputValues(id, merged);
    else setEditorInputValues(merged);
    if (rerun) {
      setPanelOpen('results', true);
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

  return (
    <div class="flex flex-col gap-3 p-1" data-testid="axis-hpo-panel">
      <Show when={gate()}>
        <div class="text-[0.85em] text-text-dim border border-border-soft p-2">{gate()}</div>
      </Show>
      <Show when={validation() === 'in-sample'}>
        <div class="text-[0.8em] text-accent-2 border border-accent/30 bg-accent/5 p-2">
          In-sample only will overfit. Prefer Holdout.
        </div>
      </Show>

      <div class="flex flex-wrap items-end gap-2">
        <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
          Trials
          <input
            class="sc-input w-16"
            type="number"
            min={1}
            max={MAX_TRIALS}
            value={nTrials()}
            onInput={(e) => setNTrials(Math.min(MAX_TRIALS, Math.max(1, Number(e.currentTarget.value) || 1)))}
          />
        </label>
        <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
          Sampler
          <select
            class="sc-input"
            value={sampler()}
            onChange={(e) => setSampler(e.currentTarget.value as SamplerId)}
          >
            <option value="auto">auto</option>
            <option value="random">random</option>
            <option value="tpe">tpe</option>
            <option value="grid">grid</option>
          </select>
        </label>
        <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
          Objective
          <select
            class="sc-input"
            value={objective()}
            onChange={(e) => setObjective(e.currentTarget.value as ObjectiveId)}
          >
            <option value="composite">composite</option>
            <option value="net_pnl">net pnl</option>
            <option value="profit_factor">profit factor</option>
            <option value="calmar">calmar-like</option>
          </select>
        </label>
        <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
          Validation
          <select
            class="sc-input"
            value={validation()}
            onChange={(e) => setValidation(e.currentTarget.value as ValidationId)}
          >
            <option value="holdout">holdout</option>
            <option value="walk-forward">walk-forward</option>
            <option value="in-sample">in-sample</option>
          </select>
        </label>
        <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
          Min trades
          <input
            class="sc-input w-16"
            type="number"
            min={0}
            value={minTrades()}
            onInput={(e) => setMinTrades(Math.max(0, Number(e.currentTarget.value) || 0))}
          />
        </label>
        <Show when={validation() === 'holdout'}>
          <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
            Holdout
            <input
              class="sc-input w-16"
              type="number"
              step="0.05"
              min={0.1}
              max={0.5}
              value={holdoutFrac()}
              onInput={(e) => setHoldoutFrac(Number(e.currentTarget.value) || 0.3)}
            />
          </label>
        </Show>
        <Show when={validation() === 'walk-forward'}>
          <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
            Train
            <input
              class="sc-input w-16"
              type="number"
              value={trainBars()}
              onInput={(e) => setTrainBars(Number(e.currentTarget.value) || 200)}
            />
          </label>
          <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
            Test
            <input
              class="sc-input w-16"
              type="number"
              value={testBars()}
              onInput={(e) => setTestBars(Number(e.currentTarget.value) || 50)}
            />
          </label>
          <label class="flex flex-col text-[10px] uppercase tracking-wider text-text-faint">
            Step
            <input
              class="sc-input w-16"
              type="number"
              value={stepBars()}
              onInput={(e) => setStepBars(Number(e.currentTarget.value) || 50)}
            />
          </label>
        </Show>
        <button
          type="button"
          class="sc-btn sc-btn-ghost text-[0.8em]"
          onClick={refreshSpace}
          disabled={busy()}
        >
          Refresh inputs
        </button>
        <Show
          when={!busy()}
          fallback={
            <button type="button" class="sc-btn text-[0.8em]" onClick={cancel}>
              Cancel
            </button>
          }
        >
          <button
            type="button"
            class="sc-btn sc-btn-primary text-[0.8em]"
            data-testid="axis-hpo-start"
            disabled={!!gate()}
            onClick={() => void start()}
          >
            Start
          </button>
        </Show>
      </div>

      <div class="flex flex-col gap-1">
        <div class="text-[10px] uppercase tracking-wider text-text-faint">Search space</div>
        <For each={params()}>
          {(p) => (
            <div class="flex flex-wrap items-center gap-2 text-[0.8em] border-b border-border-soft/50 py-1">
              <label class="flex items-center gap-1 min-w-[8rem]">
                <input
                  type="checkbox"
                  checked={p.enabled !== false}
                  onChange={(e) => patchParam(p.name, { enabled: e.currentTarget.checked })}
                />
                <span class="truncate">{p.name}</span>
                <span class="text-text-faint">{p.kind}</span>
              </label>
              <Show when={p.kind === 'int' || p.kind === 'float'}>
                <input
                  class="sc-input w-16"
                  type="number"
                  placeholder="min"
                  value={p.min ?? ''}
                  onInput={(e) =>
                    patchParam(p.name, { min: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })
                  }
                />
                <input
                  class="sc-input w-16"
                  type="number"
                  placeholder="max"
                  value={p.max ?? ''}
                  onInput={(e) =>
                    patchParam(p.name, { max: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })
                  }
                />
                <input
                  class="sc-input w-16"
                  type="number"
                  placeholder="step"
                  value={p.step ?? ''}
                  onInput={(e) =>
                    patchParam(p.name, {
                      step: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value),
                    })
                  }
                />
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={error()}>
        <div class="text-red text-[0.8em]">{error()}</div>
      </Show>

      <Show when={study()}>
        {(s) => (
          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2 text-[0.8em]">
              <span class="text-text-dim">
                {s().status} · {s().trials.length}/{s().nTrials} · {s().engineRuns} runs ·{' '}
                {s().backend || '—'} · {s().ms.toFixed(0)}ms
              </span>
              <Show when={s().warning}>
                <span class="text-accent-2">{s().warning}</span>
              </Show>
              <Show when={s().bestParams}>
                <span class="text-accent">
                  best{' '}
                  {Object.entries(s().bestParams || {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' ')}
                </span>
                <button type="button" class="sc-btn sc-btn-ghost text-[0.78em]" onClick={() => void applyBest(false)}>
                  Apply best
                </button>
                <button type="button" class="sc-btn sc-btn-ghost text-[0.78em]" onClick={() => void applyBest(true)}>
                  Apply + re-run
                </button>
              </Show>
              <button type="button" class="sc-btn sc-btn-ghost text-[0.78em]" onClick={exportCsv}>
                <Icons.fileCsv />
                CSV
              </button>
            </div>
            <div class="overflow-auto max-h-56 border border-border-soft">
              <table class="w-full text-[0.78em] font-mono">
                <thead>
                  <tr class="text-left text-text-faint">
                    <th class="px-1">#</th>
                    <th class="px-1">params</th>
                    <th class="px-1">IS</th>
                    <th class="px-1">OOS</th>
                    <th class="px-1">err</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={s().trials}>
                    {(t) => (
                      <tr
                        class={t.index === s().bestIndex ? 'text-accent' : ''}
                      >
                        <td class="px-1">{t.index}</td>
                        <td class="px-1 truncate max-w-[16rem]">
                          {Object.entries(t.params)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(' ')}
                        </td>
                        <td class="px-1">{t.isScore == null ? '—' : t.isScore.toFixed(3)}</td>
                        <td class="px-1">{t.oosScore == null ? '—' : t.oosScore.toFixed(3)}</td>
                        <td class="px-1 text-red truncate max-w-[8rem]">{t.error || ''}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};
