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
 * - An `exchange` field renders as a dropdown fed by the datafeed gateway's
 *   full ccxt exchange list (`/health` → `ccxt_exchanges`); the current value
 *   is always kept as an option even when unlisted.
 *
 * Layouts: `inline` (Topbar chip row) and `stacked` (Settings dialog form),
 * both using the shared `sc-label` / `sc-input` / `sc-hint` classes.
 *
 * @module ui/PluginConfigRow
 */

import { For, Show, createMemo, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { store, setStore, persist } from '../store';
import { getActiveSource, getActiveStream } from '../plugins/active';
import { pluginKey, type ConfigSchema, type FieldSchema } from '../plugins/types';
import { fetchGatewayExchanges } from './plugin-config';

const EXCHANGE_FIELD = 'exchange';

interface ConfigTarget {
  kind: 'source' | 'stream';
  id: string;
  schema: ConfigSchema;
}

export interface PluginConfigRowProps {
  /** Called after any field changes (e.g. re-fetch historical bars). */
  onApplied?: () => void;
  /** Include `advanced: true` fields (Settings variant). Default false. */
  showAdvanced?: boolean;
  /** `inline` (Topbar) or `stacked` (Settings). Default inline. */
  layout?: 'inline' | 'stacked';
}

export function PluginConfigRow(props: PluginConfigRowProps) {
  const stacked = () => props.layout === 'stacked';

  const hasVisibleFields = (schema?: ConfigSchema): boolean =>
    !!schema &&
    Object.keys(schema).length > 0 &&
    (props.showAdvanced || Object.values(schema).some((f) => !f?.advanced));

  // Active plugins declaring visible config fields — source first (field order wins).
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

  /** Ordered union of field keys across targets (advanced filtered unless showAdvanced). */
  const fields = createMemo<Array<[string, FieldSchema]>>(() => {
    const seen = new Set<string>();
    const out: Array<[string, FieldSchema]> = [];
    for (const t of targets()) {
      for (const [k, f] of Object.entries(t.schema)) {
        if (!seen.has(k)) {
          seen.add(k);
          if (!f?.advanced || props.showAdvanced) out.push([k, f]);
        }
      }
    }
    return out;
  });

  /** Effective value for a field: first stored override among targets, else default. */
  const valueOf = (key: string): unknown => {
    for (const t of targets()) {
      const all = store.pluginsConfig || {};
      const bag = (all[pluginKey(t.kind, t.id)] as Record<string, unknown> | undefined) || {};
      if (bag[key] !== undefined) return bag[key];
      const f = t.schema[key];
      if (f && 'default' in f && f.default !== undefined) return f.default;
    }
    const f0 = fields().find(([k]) => k === key)?.[1];
    return f0?.default ?? '';
  };

  const [exchanges, setExchanges] = createSignal<string[]>([]);
  createMemo(() => {
    if (!fields().some(([k]) => k === EXCHANGE_FIELD)) return;
    const mode = String(valueOf('gateway') || 'auto') as 'auto' | 'pyne' | 'sidecar';
    void fetchGatewayExchanges(mode).then(setExchanges);
  });

  /** Dropdown options for exchange: full ccxt list (+ current value). */
  const exchangeOptions = createMemo<string[]>(() => {
    const cur = String(valueOf(EXCHANGE_FIELD) || '').trim();
    const set = new Set<string>(exchanges());
    if (cur) set.add(cur);
    return [...set];
  });

  const setField = (key: string, v: unknown) => {
    let changed = false;
    for (const t of targets()) {
      if (!(key in t.schema)) continue;
      setStore('pluginsConfig', pluginKey(t.kind, t.id), key, v);
      changed = true;
    }
    if (!changed) return;
    void persist();
    props.onApplied?.();
  };

  const fieldTitle = (key: string, f: FieldSchema) => f.description || f.label || key;

  /** Single field control — shared by inline + stacked layouts. */
  const renderControl = (key: string, f: FieldSchema): JSX.Element => (
    <Show
      when={f.type !== 'boolean'}
      fallback={
        <input
          type="checkbox"
          checked={Boolean(valueOf(key))}
          onChange={(e) => setField(key, e.currentTarget.checked)}
        />
      }
    >
      <Show
        when={f.type !== 'select' && key !== EXCHANGE_FIELD}
        fallback={
          <select
            class={`sc-input font-mono text-[12px] ${stacked() ? 'w-full' : 'w-[9em]'}`}
            value={String(valueOf(key) ?? '')}
            onChange={(e) => setField(key, e.currentTarget.value)}
            title={fieldTitle(key, f)}
          >
            <Show when={key === EXCHANGE_FIELD && exchangeOptions().length === 0}>
              <option value="">loading…</option>
            </Show>
            <For
              each={
                key === EXCHANGE_FIELD ? exchangeOptions() : f.options || [String(valueOf(key) ?? '')]
              }
            >
              {(o) => <option value={o}>{o}</option>}
            </For>
          </select>
        }
      >
        <input
          type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
          class={`sc-input font-mono text-[12px] ${stacked() ? 'w-full' : 'w-[7em]'}`}
          min={f.min}
          max={f.max}
          step={f.step}
          placeholder={f.placeholder}
          value={f.type === 'number' ? Number(valueOf(key) ?? 0) : String(valueOf(key) ?? '')}
          onInput={(e) => {
            const raw = e.currentTarget.value;
            setField(key, f.type === 'number' ? Number(raw) : raw);
          }}
          title={fieldTitle(key, f)}
        />
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
                  <label class="sc-label" for={`axis-cfg-${props.layout}-${key}`}>
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
          title="Shared source/stream settings · history applies on Load/Reload · live applies on Live toggle · advanced options in Settings"
        >
          <For each={fields()}>
            {([key, f]) => (
              <label class="sc-label flex items-center gap-1" title={fieldTitle(key, f)}>
                <span class="whitespace-nowrap">{f.label || key}</span>
                {renderControl(key, f)}
              </label>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}
