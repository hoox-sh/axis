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
 * Script Settings modal — edit Pine `input.*` values and re-run.
 *
 * Target is either an applied indicator (`scriptSettings.indicatorId`) or the
 * docked editor document. Field defs from `resolveScriptInputs`; Apply writes
 * overrides via store helpers and calls `runAndApply`.
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
  loadEditorDoc,
} from '../store';
import {
  resolveScriptInputs,
  applyInputOverrides,
  overridesFromDefs,
  type ScriptInputDef,
} from '../results/script-inputs';
import { sourceOptionsWithPlots } from '../results/plot-sources';
import { runAndApply } from '../indicators/runner';
import type { RunResult } from '../indicators/runner';
import { Icons } from './icons';

/** Modal form for Pine inputs (editor doc or applied indicator). */
export const ScriptSettingsModal: Component = () => {
  const open = () => store.scriptSettings.open;
  const indicatorId = () => store.scriptSettings.indicatorId;

  const [fields, setFields] = createSignal<ScriptInputDef[]>([]);
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
      };
    }
    return {
      kind: 'editor' as const,
      id: 'editor',
      name: 'Editor script',
      code: loadEditorDoc() || '',
      values: store.editorInputValues || {},
    };
  });

  const seedFields = () => {
    const t = untrack(() => targetMeta());
    if (!t) {
      setFields([]);
      setSourceLabels({});
      return;
    }
    // Snapshot engine inputs / plot series once at seed — do not track live updates
    const r = untrack(() => store.lastRun as RunResult | null);
    const engineInputs = r?.meta?.inputs ?? (r as { inputs?: unknown } | null)?.inputs;
    const defs = resolveScriptInputs(t.code, engineInputs);
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

  const groups = createMemo(() => {
    const map = new Map<string, ScriptInputDef[]>();
    for (const f of fields()) {
      const g = f.group || 'Inputs';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(f);
    }
    return [...map.entries()];
  });

  const setFieldValue = (id: string, value: unknown) => {
    setFields((list) => list.map((f) => (f.id === id ? { ...f, value } : f)));
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
    if (t.kind === 'indicator' && t.id) {
      setIndicatorInputValues(t.id, overrides);
    } else {
      setEditorInputValues(overrides);
    }
    if (!andRun) {
      closeScriptSettings();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const id = t.kind === 'indicator' ? t.id : undefined;
      await runAndApply(t.code, id, { inputs: overrides });
      closeScriptSettings();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onReset = () => {
    setFields((list) => list.map((f) => ({ ...f, value: f.default })));
  };

  return (
    <Show when={open()}>
      <div
        class="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-4 backdrop-blur-[2px]"
        onClick={onBackdrop}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(440px,calc(100vw-32px))]"
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
                {targetMeta()?.name || 'Script'} · input parameters
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

          <div class="sc-dialog-body">
            <Show
              when={fields().length > 0}
              fallback={
                <div class="text-[12px] text-text-dim leading-relaxed">
                  No <code class="text-accent">input.*</code> declarations found in this script.
                  Add e.g. <code class="text-text-faint">length = input.int(14, "Length")</code>.
                </div>
              }
            >
              <For each={groups()}>
                {([group, items]) => (
                  <div class="flex flex-col gap-2">
                    <div class="text-[10px] uppercase tracking-wider text-text-dim font-semibold">
                      {group}
                    </div>
                    <For each={items}>
                      {(field) => (
                        <InputField
                          field={field}
                          optionLabels={sourceLabels()}
                          onChange={(v) => setFieldValue(field.id, v)}
                        />
                      )}
                    </For>
                  </div>
                )}
              </For>
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
              disabled={!fields().length || busy()}
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

const InputField: Component<{
  field: ScriptInputDef;
  onChange: (v: unknown) => void;
  /** Optional display labels for option values (cross-indicator sources). */
  optionLabels?: Record<string, string>;
}> = (props) => {
  const id = () => `axis-in-${props.field.id}`;
  const t = () => props.field.type;
  const val = () => props.field.value ?? props.field.default;
  const optLabel = (opt: string) => props.optionLabels?.[opt] || opt;

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
    <div class="sc-field" data-input-id={props.field.id}>
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
      <Show when={t() === 'int' || t() === 'float' || t() === 'price'}>
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
            // Commit finite numbers so Apply works without blur; leave empty
            // as draft only so clearing the field does not jump to default.
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
            onInput={(e) => props.onChange(e.currentTarget.value)}
          />
          <input
            type="text"
            class="sc-input flex-1 font-mono text-[11px]"
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
          onChange={(e) => props.onChange(e.currentTarget.value)}
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
