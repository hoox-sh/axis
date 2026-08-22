// Copyright (c) 2024-2026 jango_blockchained
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
 * Shared config fields for the active source **and** stream plugins.
 *
 * Renders each field **once** (union of both plugins' `configSchema`
 * keys — ccxt-rest/ccxt-ws share `exchange` + `gateway`) and writes every
 * change through to *all* declaring plugins' `pluginsConfig` bags, so
 * historical and live stay in sync.
 *
 * - `advanced` fields (host URLs, page sizes, fallbacks) are hidden unless
 *   `showAdvanced` — they live in Settings → "Source & stream plugins".
 * - An `exchange` field is a gateway-fed `<select>` when the list is ready,
 *   and a free-text field while loading fails or the list is empty.
 *
 * Selects / checkboxes apply immediately. Text and number fields persist on
 * each keystroke but only call {@link PluginConfigRowProps.onApplied} on
 * blur or Enter (history reload is not a mid-edit action).
 *
 * Layouts: `inline` (Topbar chip row, rendered via {@link TopbarField}) and
 * `stacked` (Settings dialog form using `sc-label` / `sc-input` / `sc-hint`).
 *
 * @module ui/PluginConfigRow
 */

import { For, Show, createMemo, createResource } from 'solid-js';
import type { JSX } from 'solid-js';
import { store, persist } from '../store';
import { getActiveSource, getActiveStream } from '../plugins/active';
import { pluginKey, type FieldSchema } from '../plugins/types';
import {
  fetchGatewayExchanges,
  resolvePluginFieldValue,
  writePluginField,
  type ConfigTarget,
  type GatewayMode,
} from './plugin-config';
import { TopbarField } from './TopbarField';

const EXCHANGE_FIELD = 'exchange';

export interface PluginConfigRowProps {
  /** Called after a committed field change (e.g. re-fetch historical bars). */
  onApplied?: () => void;
  /** Include `advanced: true` fields (Settings variant). Default false. */
  showAdvanced?: boolean;
  /** `inline` (Topbar) or `stacked` (Settings). Default inline. */
  layout?: 'inline' | 'stacked';
  /** Field keys to omit (e.g. hide `exchange` when Venue already pins it). */
  hideKeys?: string[];
}

function parseFieldValue(f: FieldSchema, raw: string): unknown {
  return f.type === 'number' ? Number(raw) : raw;
}

export function PluginConfigRow(props: PluginConfigRowProps) {
  const stacked = () => props.layout === 'stacked';
  const layoutName = () => (stacked() ? 'stacked' : 'inline');
  const fieldId = (key: string) => `axis-cfg-${layoutName()}-${key}`;

  const hasVisibleFields = (schema?: Record<string, FieldSchema>): boolean =>
    !!schema &&
    Object.keys(schema).length > 0 &&
    (props.showAdvanced || Object.values(schema).some((f) => !f?.advanced));

  const targets = createMemo<ConfigTarget[]>(() => {
    void store.activePlugins;
    void store.live?.streamId;
    const out: ConfigTarget[] = [];
    const src = getActiveSource();
    if (src && hasVisibleFields(src.configSchema)) {
      out.push({ kind: 'source', id: src.id, schema: src.configSchema! });
    }
    const stm = getActiveStream();
    if (
      stm &&
      !out.some((t) => t.id === stm.id) &&
      hasVisibleFields(stm.configSchema)
    ) {
      out.push({ kind: 'stream', id: stm.id, schema: stm.configSchema! });
    }
    return out;
  });

  const fields = createMemo<Array<[string, FieldSchema]>>(() => {
    const seen = new Set<string>();
    const out: Array<[string, FieldSchema]> = [];
    for (const t of targets()) {
      for (const [k, f] of Object.entries(t.schema)) {
        if (!seen.has(k)) {
          seen.add(k);
          if (props.hideKeys?.includes(k)) continue;
          if (!f?.advanced || props.showAdvanced) out.push([k, f]);
        }
      }
    }
    return out;
  });

  const valueOf = (key: string): unknown => {
    void store.pluginsConfig;
    return resolvePluginFieldValue(store.pluginsConfig, targets(), key);
  };

  const gatewayMode = createMemo((): GatewayMode | undefined => {
    if (!fields().some(([k]) => k === EXCHANGE_FIELD)) return undefined;
    const g = String(valueOf('gateway') || 'auto');
    return g === 'pyne' || g === 'sidecar' ? g : 'auto';
  });

  const [exchangeList] = createResource(gatewayMode, (mode) => fetchGatewayExchanges(mode));

  /** Reading a failed resource throws in Solid — never call `exchangeList()` in the error state. */
  const loadedExchanges = (): string[] => {
    if (exchangeList.state === 'errored') return [];
    return exchangeList() ?? [];
  };

  const exchangeOptions = createMemo<string[]>(() => {
    const cur = String(valueOf(EXCHANGE_FIELD) ?? '').trim();
    const set = new Set<string>(loadedExchanges());
    if (cur) set.add(cur);
    return [...set];
  });

  /** `select` when the gateway returned venues; otherwise a typed field. */
  const exchangeAsSelect = () => loadedExchanges().length > 0;

  /** Text/number keystrokes that have not yet called `onApplied`. */
  const dirty = new Set<string>();

  const writeField = (key: string, v: unknown): boolean => {
    let wrote = false;
    for (const t of targets()) {
      if (!(key in t.schema)) continue;
      writePluginField(pluginKey(t.kind, t.id), key, v);
      wrote = true;
    }
    if (wrote) void persist();
    return wrote;
  };

  /** Persist immediately; reload history only for selects/checkboxes. */
  const applyField = (key: string, v: unknown) => {
    if (!writeField(key, v)) return;
    dirty.delete(key);
    props.onApplied?.();
  };

  /** Persist a keystroke; history reload waits for {@link commitField}. */
  const draftField = (key: string, v: unknown) => {
    if (!writeField(key, v)) return;
    dirty.add(key);
  };

  /** Blur / Enter — reload only if this field was edited since last apply. */
  const commitField = (key: string, v: unknown) => {
    if (!writeField(key, v)) return;
    if (!dirty.has(key)) return;
    dirty.delete(key);
    props.onApplied?.();
  };

  const fieldTitle = (key: string, f: FieldSchema) => f.description || f.label || key;

  const isSelectField = (key: string, f: FieldSchema): boolean =>
    f.type === 'select' || (key === EXCHANGE_FIELD && exchangeAsSelect());

  const optionsFor = (key: string, f: FieldSchema): string[] =>
    key === EXCHANGE_FIELD ? exchangeOptions() : f.options || [String(valueOf(key) ?? '')];

  const displayValue = (key: string, f: FieldSchema): string | number =>
    f.type === 'number' ? Number(valueOf(key) ?? 0) : String(valueOf(key) ?? '');

  const onTextInput = (key: string, f: FieldSchema, raw: string) => {
    draftField(key, parseFieldValue(f, raw));
  };

  const onTextCommit = (key: string, f: FieldSchema, raw: string) => {
    commitField(key, parseFieldValue(f, raw));
  };

  const onTextKeyDown = (
    key: string,
    f: FieldSchema,
    e: KeyboardEvent & { currentTarget: HTMLInputElement },
  ) => {
    if (e.key === 'Enter') onTextCommit(key, f, e.currentTarget.value);
  };

  const selectOptions = (key: string, f: FieldSchema): JSX.Element => (
    <>
      <Show when={key === EXCHANGE_FIELD}>
        <option value="">Select exchange…</option>
      </Show>
      <For each={optionsFor(key, f)}>{(o) => <option value={o}>{o}</option>}</For>
    </>
  );

  const exchangeLoadingLabel = () =>
    exchangeList.state === 'pending' || exchangeList.state === 'unresolved'
      ? 'loading…'
      : exchangeList.state === 'errored'
        ? 'gateway unavailable — type an id'
        : 'no exchanges — type an id';

  const renderInlineField = (key: string, f: FieldSchema): JSX.Element => (
    <Show
      when={f.type !== 'boolean'}
      fallback={
        <label class="flex items-center gap-1" for={fieldId(key)} title={fieldTitle(key, f)}>
          <span class="whitespace-nowrap text-[11px] tracking-wide">{f.label || key}</span>
          <input
            id={fieldId(key)}
            type="checkbox"
            checked={Boolean(valueOf(key))}
            onChange={(e) => applyField(key, e.currentTarget.checked)}
          />
        </label>
      }
    >
      <Show
        when={isSelectField(key, f)}
        fallback={
          <TopbarField
            id={fieldId(key)}
            label={f.label || key}
            variant="input"
            class="w-[7.5em]"
            mono
            title={fieldTitle(key, f)}
            testId={`axis-cfg-${key}`}
            placeholder={key === EXCHANGE_FIELD ? exchangeLoadingLabel() : f.placeholder}
            value={displayValue(key, f)}
            onInput={(e) => onTextInput(key, f, e.currentTarget.value)}
            onBlur={(e) => onTextCommit(key, f, e.currentTarget.value)}
            onKeyDown={(e) => onTextKeyDown(key, f, e)}
          />
        }
      >
        <TopbarField
          id={fieldId(key)}
          label={f.label || key}
          variant="select"
          class="min-w-[8em]"
          mono
          title={fieldTitle(key, f)}
          testId={`axis-cfg-${key}`}
          value={String(valueOf(key) ?? '')}
          onChange={(e) => applyField(key, e.currentTarget.value)}
        >
          {selectOptions(key, f)}
        </TopbarField>
      </Show>
    </Show>
  );

  const renderControl = (key: string, f: FieldSchema): JSX.Element => (
    <Show
      when={f.type !== 'boolean'}
      fallback={
        <input
          id={fieldId(key)}
          type="checkbox"
          checked={Boolean(valueOf(key))}
          onChange={(e) => applyField(key, e.currentTarget.checked)}
        />
      }
    >
      <Show
        when={isSelectField(key, f)}
        fallback={
          <input
            id={fieldId(key)}
            type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
            class="sc-input font-mono text-[12px] w-full"
            min={f.min}
            max={f.max}
            step={f.step}
            placeholder={key === EXCHANGE_FIELD ? exchangeLoadingLabel() : f.placeholder}
            value={displayValue(key, f)}
            onInput={(e) => onTextInput(key, f, e.currentTarget.value)}
            onBlur={(e) => onTextCommit(key, f, e.currentTarget.value)}
            onKeyDown={(e) => onTextKeyDown(key, f, e)}
            title={fieldTitle(key, f)}
          />
        }
      >
        <select
          id={fieldId(key)}
          class="sc-input font-mono text-[12px] w-full"
          value={String(valueOf(key) ?? '')}
          onChange={(e) => applyField(key, e.currentTarget.value)}
          title={fieldTitle(key, f)}
        >
          {selectOptions(key, f)}
        </select>
      </Show>
    </Show>
  );

  return (
    <Show when={fields().length > 0}>
      <Show
        when={!stacked()}
        fallback={
          <div class="flex flex-col gap-2" data-testid="axis-cfg-plugins-settings">
            <For each={fields()}>
              {([key, f]) => (
                <div class="sc-field">
                  <label class="sc-label" for={fieldId(key)}>
                    {f.label || key}
                  </label>
                  {renderControl(key, f)}
                  <Show when={f.description}>
                    <p class="sc-hint mt-0.5">{f.description}</p>
                  </Show>
                </div>
              )}
            </For>
          </div>
        }
      >
        <div
          class="flex items-center gap-2"
          data-testid="axis-cfg-plugins"
          title="Shared source/stream settings · history applies on Load/Reload or when a select/checkbox changes · live applies on Live toggle · advanced options in Settings"
        >
          <For each={fields()}>
            {([key, f]) => renderInlineField(key, f)}
          </For>
        </div>
      </Show>
    </Show>
  );
}
