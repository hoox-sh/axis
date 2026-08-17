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
 * Script Settings modal — edit Pine `input.*` values and Strategy Properties.
 *
 * Target is either an applied indicator (`scriptSettings.indicatorId`) or the
 * docked editor document. Field defs from `resolveScriptInputs`; Strategy
 * Properties tab appears when `strategy()` is declared. Apply writes overrides
 * via store helpers and calls `runAndApply`.
 *
 * **Focus / value stability:** fields are seeded only when the modal opens or
 * the target indicator changes — not on every `lastRun` / live tick. Number
 * fields keep a local string draft so mid-edit re-renders do not reset focus.
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  store,
  closeScriptSettings,
  setEditorInputValues,
  setIndicatorInputValues,
  setEditorStrategyProps,
  setIndicatorStrategyProps,
  loadEditorDoc,
  EDITOR_RUN_KEY,
} from '../store';
import {
  resolveScriptInputs,
  applyInputOverrides,
  overridesFromDefs,
  layoutInputRows,
  isInputActive,
  type InputFormRow,
  type ScriptInputDef,
} from '../results/script-inputs';
import {
  resolveStrategyProps,
  strategyOverridesFromDefs,
  hasStrategyDeclaration,
  type StrategyPropDef,
} from '../results/strategy-props';
import { detectScriptKind } from '../indicators/script-meta';
import { sourceOptionsWithPlots } from '../results/plot-sources';
import { parseLibraryImports } from '../storage/library-publish';
import { readCachedLibrarySource } from '../storage/library-publish-io';
import { runAndApply } from '../indicators/runner';
import type { RunResult } from '../indicators/runner';
import { Icons } from './icons';

/** Extra Pine sources that may declare `enum`s imported by the target script. */
function extraEnumSources(code: string, skipId?: string | null): string[] {
  const extra: string[] = [];
  const seen = new Set<string>();
  const add = (src: string | null | undefined) => {
    const s = String(src || '').trim();
    if (!s || s === code || seen.has(s)) return;
    seen.add(s);
    extra.push(s);
  };
  for (const s of store.scripts || []) {
    if (skipId && s.id === skipId) continue;
    add(s.code);
  }
  const editor = loadEditorDoc();
  if (editor && editor !== code) add(editor);
  try {
    for (const spec of parseLibraryImports(code)) {
      add(readCachedLibrarySource(spec));
    }
  } catch {
    /* cache optional */
  }
  return extra;
}

function runResultForTarget(kind: 'indicator' | 'editor', id: string): RunResult | null {
  const key = kind === 'indicator' && id ? id : EDITOR_RUN_KEY;
  const bag = store.runResults as Record<string, RunResult | undefined> | undefined;
  return bag?.[key] ?? null;
}

type SettingsTab = 'inputs' | 'strategy';

/** Modal form for Pine inputs + strategy properties (editor doc or applied). */
export const ScriptSettingsModal: Component = () => {
  const open = () => store.scriptSettings.open;
  const indicatorId = () => store.scriptSettings.indicatorId;

  const [fields, setFields] = createSignal<ScriptInputDef[]>([]);
  const [strategyFields, setStrategyFields] = createSignal<StrategyPropDef[]>([]);
  const [showStrategyTab, setShowStrategyTab] = createSignal(false);
  const [tab, setTab] = createSignal<SettingsTab>('inputs');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  /** Labels for cross-indicator plot options (value → display). */
  const [sourceLabels, setSourceLabels] = createSignal<Record<string, string>>({});

  /**
   * Seed key for the open session: only re-build field list when the modal
   * opens or the target script changes — never on lastRun / live series ticks.
   */
  let seededKey = '';

  const targetMeta = createMemo(() => {
    const id = indicatorId();
    if (id) {
      const ind = store.scripts.find((s) => s.id === id);
      if (!ind) return null;
      return {
        kind: 'indicator' as const,
        id,
        name: ind.name,
        code: ind.code,
        values: ind.inputValues || {},
        strategyProps: ind.strategyProps || {},
      };
    }
    return {
      kind: 'editor' as const,
      id: 'editor',
      name: 'Editor script',
      code: loadEditorDoc() || '',
      values: store.editorInputValues || {},
      strategyProps: store.editorStrategyProps || {},
    };
  });

  const seedFields = () => {
    const t = untrack(() => targetMeta());
    if (!t) {
      setFields([]);
      setStrategyFields([]);
      setShowStrategyTab(false);
      setSourceLabels({});
      return;
    }
    // Snapshot this script's engine inputs / plot series once at seed.
    // Do not use global lastRun — that may belong to a different indicator.
    // Re-read the editor buffer here: `targetMeta` cannot track localStorage.
    const code =
      t.kind === 'editor' ? untrack(() => loadEditorDoc() || t.code) : t.code;
    const r = untrack(() => runResultForTarget(t.kind, t.id));
    const engineInputs = r?.meta?.inputs ?? (r as { inputs?: unknown } | null)?.inputs;
    const extraSources = untrack(() => extraEnumSources(code, t.kind === 'indicator' ? t.id : null));
    const defs = resolveScriptInputs(code, engineInputs, extraSources);
    const seriesSnap = untrack(() => store.indicatorSeries);
    const { options: plotOpts, labels } = sourceOptionsWithPlots(seriesSnap, indicatorId());
    setSourceLabels({ ...labels });
    const withPlots = defs.map((d) => {
      if (d.type !== 'source') return d;
      const opts = [...plotOpts];
      const cur = t.values[d.title] ?? t.values[d.id] ?? d.value;
      if (typeof cur === 'string' && cur && !opts.includes(cur)) {
        opts.push(cur);
        labels[cur] = labels[cur] || cur;
      }
      return { ...d, options: opts };
    });
    setSourceLabels({ ...labels });
    setFields(applyInputOverrides(withPlots, t.values));

    const isStrategy =
      detectScriptKind(t.code) === 'strategy' || hasStrategyDeclaration(t.code);
    setShowStrategyTab(isStrategy);
    if (isStrategy) {
      setStrategyFields(resolveStrategyProps(t.code, t.strategyProps));
      // Prefer Inputs when they exist; otherwise open Properties
      if (withPlots.length === 0) setTab('strategy');
      else setTab('inputs');
    } else {
      setStrategyFields([]);
      setTab('inputs');
    }
    setError('');
  };

  // Seed only on open / target change (not on every store tick)
  createEffect(() => {
    if (!open()) {
      seededKey = '';
      return;
    }
    const key = indicatorId() ?? 'editor';
    if (seededKey === key) return;
    seededKey = key;
    seedFields();
  });

  /** Pine `group` + `inline` layout (declaration order). */
  const inputLayout = createMemo(() => layoutInputRows(fields()));

  const strategyGroups = createMemo(() => {
    const map = new Map<string, StrategyPropDef[]>();
    for (const f of strategyFields()) {
      const g = f.group || 'Properties';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(f);
    }
    return [...map.entries()];
  });

  const setFieldValue = (id: string, value: unknown) => {
    setFields((list) => list.map((f) => (f.id === id ? { ...f, value } : f)));
  };

  const setStrategyFieldValue = (id: string, value: unknown) => {
    setStrategyFields((list) =>
      list.map((f) => (f.id === id ? { ...f, value } : f)),
    );
  };

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) closeScriptSettings();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeScriptSettings();
  };

  // Escape while modal open (dialog itself may not hold focus)
  createEffect(() => {
    if (!open()) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  const onApply = async (andRun: boolean) => {
    const t = untrack(() => targetMeta());
    if (!t) return;
    const overrides = overridesFromDefs(fields());
    const stratOverrides = showStrategyTab()
      ? strategyOverridesFromDefs(strategyFields())
      : {};
    if (t.kind === 'indicator' && t.id) {
      setIndicatorInputValues(t.id, overrides);
      if (showStrategyTab()) setIndicatorStrategyProps(t.id, stratOverrides);
    } else {
      setEditorInputValues(overrides);
      if (showStrategyTab()) setEditorStrategyProps(stratOverrides);
    }
    if (!andRun) {
      closeScriptSettings();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const id = t.kind === 'indicator' ? t.id : undefined;
      const code =
        t.kind === 'editor' ? untrack(() => loadEditorDoc() || t.code) : t.code;
      await runAndApply(code, id, {
        inputs: overrides,
        ...(showStrategyTab() && Object.keys(stratOverrides).length
          ? { strategyProps: stratOverrides }
          : {}),
      });
      closeScriptSettings();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onReset = () => {
    if (tab() === 'strategy') {
      setStrategyFields((list) => list.map((f) => ({ ...f, value: f.default })));
    } else {
      setFields((list) => list.map((f) => ({ ...f, value: f.default })));
    }
  };

  const canReset = () =>
    tab() === 'strategy' ? strategyFields().length > 0 : fields().length > 0;

  return (
    <Show when={open()}>
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(520px,calc(100vw-2*var(--ui-dialog-margin)))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-script-settings-title"
          data-testid="axis-script-settings"
          tabIndex={-1}
        >
          <div class="sc-dialog-accent" />
          <div class="sc-dialog-header">
            <div class="min-w-0">
              <div
                id="axis-script-settings-title"
                class="text-[0.95em] font-semibold text-text tracking-tight"
              >
                Script settings
              </div>
              <div class="sc-hint truncate">
                {targetMeta()?.name || 'Script'}
                {showStrategyTab()
                  ? ' · inputs & strategy properties'
                  : ' · input parameters'}
              </div>
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2"
              onClick={() => closeScriptSettings()}
              aria-label="Close"
            >
              <Icons.x />
            </button>
          </div>

          <Show when={showStrategyTab()}>
            <div
              class="sc-chip-row px-4 pt-2"
              role="tablist"
              aria-label="Script settings tabs"
              data-testid="axis-script-settings-tabs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab() === 'inputs'}
                class={`sc-chip ${tab() === 'inputs' ? 'is-active' : ''}`}
                onClick={() => setTab('inputs')}
                data-testid="axis-script-settings-tab-inputs"
              >
                Inputs
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab() === 'strategy'}
                class={`sc-chip ${tab() === 'strategy' ? 'is-active' : ''}`}
                onClick={() => setTab('strategy')}
                data-testid="axis-script-settings-tab-strategy"
              >
                Properties
              </button>
            </div>
          </Show>

          <div class="sc-dialog-body">
            <Show when={tab() === 'inputs' || !showStrategyTab()}>
              <Show
                when={fields().length > 0}
                fallback={
                  <div class="text-[12px] text-text-dim leading-relaxed">
                    No <code class="text-accent">input.*</code> declarations found in this script.
                    Add e.g. <code class="text-text-faint">length = input.int(14, "Length")</code>.
                    <Show when={showStrategyTab()}>
                      <span>
                        {' '}
                        Strategy broker settings are under the{' '}
                        <strong class="text-text">Properties</strong> tab.
                      </span>
                    </Show>
                  </div>
                }
              >
                <For each={inputLayout()}>
                  {(section) => (
                    <section
                      class="sc-input-group"
                      data-input-group={section.group}
                    >
                      <div class="sc-section-title sc-input-group-title">
                        {section.group}
                      </div>
                      <For each={section.rows}>
                        {(row) => (
                          <InputFormRowView
                            row={row}
                            allFields={fields()}
                            optionLabels={sourceLabels()}
                            onChange={setFieldValue}
                          />
                        )}
                      </For>
                    </section>
                  )}
                </For>
              </Show>
            </Show>

            <Show when={tab() === 'strategy' && showStrategyTab()}>
              <div
                role="tabpanel"
                aria-label="Strategy properties"
                class="flex flex-col gap-3"
                data-testid="axis-script-settings-strategy"
              >
                <p class="text-[11px] text-text-dim leading-relaxed m-0">
                  Broker settings for this <code class="text-accent">strategy()</code> —
                  initial capital, order size, commission, leverage / margin, and
                  execution flags. Applied on run without rewriting your editor buffer.
                </p>
                <For each={strategyGroups()}>
                  {([group, items]) => (
                    <div class="flex flex-col gap-2">
                      <div class="text-[10px] uppercase tracking-wider text-text-dim font-semibold">
                        {group}
                      </div>
                      <For each={items}>
                        {(field) => (
                          <StrategyField
                            field={field}
                            onChange={(v) => setStrategyFieldValue(field.id, v)}
                          />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={error()}>
              <div class="text-[11px] text-red border border-red/40 bg-red/10 px-2 py-1.5">
                {error()}
              </div>
            </Show>
          </div>

          <div class="sc-dialog-footer">
            <button
              type="button"
              class="sc-btn sc-btn-ghost"
              onClick={onReset}
              disabled={!canReset() || busy()}
            >
              Reset
            </button>
            <div class="flex-1" />
            <button
              type="button"
              class="sc-btn sc-btn-ghost"
              onClick={() => closeScriptSettings()}
              disabled={busy()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="sc-btn"
              onClick={() => void onApply(false)}
              disabled={busy()}
            >
              Save
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-primary"
              onClick={() => void onApply(true)}
              disabled={busy() || !targetMeta()?.code?.trim()}
              data-testid="axis-script-settings-apply"
            >
              <Show when={busy()} fallback={<Icons.play />}>
                <Icons.loader class="animate-spin" />
              </Show>
              Apply &amp; run
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

/** Renders one layout row (single field or Pine `inline=` cluster). */
const InputFormRowView: Component<{
  row: InputFormRow;
  allFields: ScriptInputDef[];
  optionLabels: Record<string, string>;
  onChange: (id: string, v: unknown) => void;
}> = (props) => {
  return (
    <Show
      when={props.row.kind === 'inline' ? props.row : false}
      fallback={
        <Show when={props.row.kind === 'single' ? props.row.field : false}>
          {(field) => (
            <InputField
              field={field()}
              allFields={props.allFields}
              optionLabels={props.optionLabels}
              onChange={(v) => props.onChange(field().id, v)}
            />
          )}
        </Show>
      }
    >
      {(row) => (
        <div class="sc-input-inline-row" data-inline={row().key}>
          <For each={row().fields}>
            {(field) => (
              <InputField
                field={field}
                allFields={props.allFields}
                compact
                optionLabels={props.optionLabels}
                onChange={(v) => props.onChange(field.id, v)}
              />
            )}
          </For>
        </div>
      )}
    </Show>
  );
};

const InputField: Component<{
  field: ScriptInputDef;
  onChange: (v: unknown) => void;
  /** Full form list — resolves Pine `active=<ident>`. */
  allFields?: ScriptInputDef[];
  /** Tighter layout inside an `inline` row. */
  compact?: boolean;
  /** Optional display labels for option values (cross-indicator sources). */
  optionLabels?: Record<string, string>;
}> = (props) => {
  const id = () => `axis-in-${props.field.id}`;
  const t = () => props.field.type;
  const val = () => props.field.value ?? props.field.default;
  const optLabel = (opt: string) => {
    const fromField = props.field.optionLabels?.[opt];
    if (fromField) return fromField;
    const fromPlot = props.optionLabels?.[opt];
    if (fromPlot) return fromPlot;
    if (t() === 'enum') {
      const bits = String(opt).split('.');
      return bits[bits.length - 1] || opt;
    }
    return opt;
  };
  const enabled = () =>
    isInputActive(props.field, props.allFields || [props.field]);
  const tip = () => props.field.tooltip || undefined;
  const showTitle = () => Boolean(props.field.title?.trim());

  // Local drafts so parent re-renders do not clobber caret while focused
  const [numDraft, setNumDraft] = createSignal<string | null>(null);
  const [textDraft, setTextDraft] = createSignal<string | null>(null);
  const [numFocused, setNumFocused] = createSignal(false);
  const [textFocused, setTextFocused] = createSignal(false);

  // When not focused, sync display from parent (reset / external update)
  createEffect(() => {
    void props.field.value;
    void props.field.default;
    if (!numFocused()) setNumDraft(null);
    if (!textFocused()) setTextDraft(null);
  });

  const numDisplay = () => {
    if (numFocused() && numDraft() != null) return numDraft()!;
    const v = val();
    return v == null ? '' : String(v);
  };

  const textDisplay = () => {
    if (textFocused() && textDraft() != null) return textDraft()!;
    return String(val() ?? '');
  };

  const commitNumber = (raw: string) => {
    if (raw.trim() === '') {
      props.onChange(props.field.default);
      return;
    }
    const n = t() === 'int' ? parseInt(raw, 10) : parseFloat(raw);
    props.onChange(Number.isFinite(n) ? n : props.field.default);
  };

  return (
    <div
      class={`sc-field ${props.compact ? 'sc-field-inline' : ''} ${enabled() ? '' : 'is-disabled'}`}
      data-input-id={props.field.id}
      data-inline={props.field.inline || undefined}
      aria-disabled={!enabled() || undefined}
    >
      <Show when={showTitle() || tip()}>
        <label
          class="sc-field-label text-[11px] text-text-dim"
          for={id()}
        >
          <span class="sc-field-title">{props.field.title || '\u00a0'}</span>
          <Show when={tip()}>
            <span
              class="sc-field-tooltip"
              title={tip()}
              aria-label={tip()}
              data-tooltip={tip()}
            >
              ?
            </span>
          </Show>
        </label>
      </Show>
      <Show when={t() === 'bool'}>
        <label
          class={`inline-flex items-center gap-2 text-[12px] text-text ${enabled() ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
        >
          <input
            id={id()}
            type="checkbox"
            class="accent-[var(--color-accent)]"
            checked={!!val()}
            disabled={!enabled()}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
          />
          {val() ? 'On' : 'Off'}
        </label>
      </Show>
      <Show when={t() === 'int' || t() === 'float' || t() === 'price'}>
        <input
          id={id()}
          type="number"
          class="sc-input w-full"
          value={numDisplay()}
          min={props.field.min ?? undefined}
          max={props.field.max ?? undefined}
          step={props.field.step ?? (t() === 'int' ? 1 : 'any')}
          disabled={!enabled()}
          onFocus={(e) => {
            setNumFocused(true);
            setNumDraft(e.currentTarget.value);
          }}
          onInput={(e) => {
            if (!enabled()) return;
            const raw = e.currentTarget.value;
            setNumDraft(raw);
            // Commit finite numbers so Apply works without blur; leave empty
            // as draft only so clearing the field does not jump to default.
            if (raw.trim() === '') return;
            const n = t() === 'int' ? parseInt(raw, 10) : parseFloat(raw);
            if (Number.isFinite(n)) props.onChange(n);
          }}
          onChange={(e) => {
            if (enabled()) commitNumber(e.currentTarget.value);
          }}
          onBlur={(e) => {
            if (enabled()) commitNumber(e.currentTarget.value);
            setNumFocused(false);
            setNumDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
        />
      </Show>
      <Show when={t() === 'color'}>
        <div class="flex gap-2 items-center">
          <input
            id={id()}
            type="color"
            class="h-8 w-10 border-2 border-border bg-bg-elev cursor-pointer p-0 rounded-[var(--radius-input)]"
            value={toHexColor(val())}
            disabled={!enabled()}
            onInput={(e) => {
              if (enabled()) props.onChange(e.currentTarget.value);
            }}
          />
          <input
            type="text"
            class="sc-input flex-1 font-mono text-[11px]"
            value={textDisplay()}
            disabled={!enabled()}
            onFocus={(e) => {
              setTextFocused(true);
              setTextDraft(e.currentTarget.value);
            }}
            onInput={(e) => {
              if (!enabled()) return;
              setTextDraft(e.currentTarget.value);
              props.onChange(e.currentTarget.value);
            }}
            onBlur={() => {
              setTextFocused(false);
              setTextDraft(null);
            }}
          />
        </div>
      </Show>
      <Show
        when={
          (t() === 'string' || t() === 'enum' || t() === 'source' || t() === 'timeframe') &&
          props.field.options?.length
        }
      >
        <select
          id={id()}
          class="sc-input w-full"
          value={String(val() ?? '')}
          disabled={!enabled()}
          onChange={(e) => {
            if (enabled()) props.onChange(e.currentTarget.value);
          }}
        >
          <For each={props.field.options}>
            {(opt) => <option value={opt}>{optLabel(opt)}</option>}
          </For>
        </select>
      </Show>
      <Show
        when={
          (t() === 'string' ||
            t() === 'symbol' ||
            t() === 'session' ||
            t() === 'text' ||
            t() === 'unknown' ||
            t() === 'source' ||
            t() === 'timeframe' ||
            t() === 'enum') &&
          !props.field.options?.length
        }
      >
        <Show
          when={t() === 'text'}
          fallback={
            <input
              id={id()}
              type="text"
              class="sc-input w-full"
              value={textDisplay()}
              disabled={!enabled()}
              onFocus={(e) => {
                setTextFocused(true);
                setTextDraft(e.currentTarget.value);
              }}
              onInput={(e) => {
                if (!enabled()) return;
                setTextDraft(e.currentTarget.value);
                props.onChange(e.currentTarget.value);
              }}
              onBlur={() => {
                setTextFocused(false);
                setTextDraft(null);
              }}
            />
          }
        >
          <textarea
            id={id()}
            class="sc-input w-full min-h-[4.5rem] resize-y font-mono text-[11px]"
            value={textDisplay()}
            disabled={!enabled()}
            rows={3}
            onFocus={(e) => {
              setTextFocused(true);
              setTextDraft(e.currentTarget.value);
            }}
            onInput={(e) => {
              if (!enabled()) return;
              setTextDraft(e.currentTarget.value);
              props.onChange(e.currentTarget.value);
            }}
            onBlur={() => {
              setTextFocused(false);
              setTextDraft(null);
            }}
          />
        </Show>
      </Show>
    </div>
  );
};

const StrategyField: Component<{
  field: StrategyPropDef;
  onChange: (v: unknown) => void;
}> = (props) => {
  const id = () => `axis-sp-${props.field.id}`;
  const t = () => props.field.type;
  const val = () => props.field.value ?? props.field.default;

  const [numDraft, setNumDraft] = createSignal<string | null>(null);
  const [textDraft, setTextDraft] = createSignal<string | null>(null);
  const [numFocused, setNumFocused] = createSignal(false);
  const [textFocused, setTextFocused] = createSignal(false);

  createEffect(() => {
    void props.field.value;
    void props.field.default;
    if (!numFocused()) setNumDraft(null);
    if (!textFocused()) setTextDraft(null);
  });

  const numDisplay = () => {
    if (numFocused() && numDraft() != null) return numDraft()!;
    const v = val();
    return v == null ? '' : String(v);
  };

  const textDisplay = () => {
    if (textFocused() && textDraft() != null) return textDraft()!;
    return String(val() ?? '');
  };

  const commitNumber = (raw: string) => {
    if (raw.trim() === '') {
      props.onChange(props.field.default);
      return;
    }
    const n = t() === 'int' ? parseInt(raw, 10) : parseFloat(raw);
    props.onChange(Number.isFinite(n) ? n : props.field.default);
  };

  const enumLabel = (opt: string) => {
    // strategy.percent_of_equity → percent of equity
    const bare = opt.replace(/^strategy\.(commission\.)?/, '');
    return bare.replace(/_/g, ' ');
  };

  return (
    <div class="sc-field" data-strategy-prop={props.field.id}>
      <label class="text-[11px] text-text-dim" for={id()} title={props.field.tooltip || undefined}>
        {props.field.title}
        <Show when={props.field.tooltip}>
          <span class="text-text-faint ml-1" title={props.field.tooltip!}>
            ⓘ
          </span>
        </Show>
      </label>
      <Show when={t() === 'bool'}>
        <label class="inline-flex items-center gap-2 text-[12px] text-text cursor-pointer">
          <input
            id={id()}
            type="checkbox"
            class="accent-[var(--color-accent)]"
            checked={!!val()}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
          />
          {val() ? 'On' : 'Off'}
        </label>
      </Show>
      <Show when={t() === 'int' || t() === 'float'}>
        <input
          id={id()}
          type="number"
          class="sc-input w-full"
          value={numDisplay()}
          min={props.field.min ?? undefined}
          max={props.field.max ?? undefined}
          step={props.field.step ?? (t() === 'int' ? 1 : 'any')}
          onFocus={(e) => {
            setNumFocused(true);
            setNumDraft(e.currentTarget.value);
          }}
          onInput={(e) => {
            const raw = e.currentTarget.value;
            setNumDraft(raw);
            if (raw.trim() === '') return;
            const n = t() === 'int' ? parseInt(raw, 10) : parseFloat(raw);
            if (Number.isFinite(n)) props.onChange(n);
          }}
          onChange={(e) => commitNumber(e.currentTarget.value)}
          onBlur={(e) => {
            commitNumber(e.currentTarget.value);
            setNumFocused(false);
            setNumDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </Show>
      <Show when={t() === 'enum' && props.field.options?.length}>
        <select
          id={id()}
          class="sc-input w-full"
          value={String(val() ?? '')}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        >
          <For each={props.field.options}>
            {(opt) => <option value={opt}>{enumLabel(opt)}</option>}
          </For>
        </select>
      </Show>
      <Show when={t() === 'string'}>
        <input
          id={id()}
          type="text"
          class="sc-input w-full"
          value={textDisplay()}
          onFocus={(e) => {
            setTextFocused(true);
            setTextDraft(e.currentTarget.value);
          }}
          onInput={(e) => {
            setTextDraft(e.currentTarget.value);
            props.onChange(e.currentTarget.value);
          }}
          onBlur={() => {
            setTextFocused(false);
            setTextDraft(null);
          }}
        />
      </Show>
    </div>
  );
};

function toHexColor(v: unknown): string {
  const s = String(v ?? '#939fff');
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#939fff';
}
