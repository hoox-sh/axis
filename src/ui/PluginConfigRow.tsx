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
 * Shared inline config row for the active source **and** stream plugins.
 *
 * Renders each config field **once** (union of both plugins'
 * `configSchema` keys — ccxt-rest/ccxt-ws share `exchange` + `gateway`)
 * and writes every change through to *all* declaring plugins'
 * `pluginsConfig` bags, so historical and live stay in sync.
 *
 * An `exchange` field renders as a dropdown fed by the datafeed gateway
 * `/health` exchange list (current value kept as an option even when the
 * gateway doesn't advertise it).
 *
 * @module ui/PluginConfigRow
 */

import { For, Show, createMemo, createSignal } from 'solid-js';
import { store, setStore, persist } from '../store';
import { getActiveSource, getActiveStream } from '../plugins/active';
import { pluginKey, type ConfigSchema, type FieldSchema } from '../plugins/types';
import { effectiveConfig, fetchGatewayExchanges, hasConfigFields } from './plugin-config';

const EXCHANGE_FIELD = 'exchange';

interface ConfigTarget {
  kind: 'source' | 'stream';
  id: string;
  schema: ConfigSchema;
}

export interface PluginConfigRowProps {
  /** Called after any field changes (e.g. re-fetch historical bars). */
  onApplied?: () => void;
}

export function PluginConfigRow(props: PluginConfigRowProps) {
  // Active plugins declaring config fields — source first (field order wins).
  const targets = createMemo<ConfigTarget[]>(() => {
    void store.activePlugins;
    void store.live?.streamId;
    const out: ConfigTarget[] = [];
    const src = getActiveSource();
    if (src && hasConfigFields(src.configSchema)) {
      out.push({ kind: 'source', id: src.id, schema: src.configSchema! });
    }
    const stm = getActiveStream();
    if (stm && !out.some((t) => t.id === stm.id) && hasConfigFields(stm.configSchema)) {
      out.push({ kind: 'stream', id: stm.id, schema: stm.configSchema! });
    }
    return out;
  });

  /** Ordered union of field keys across targets. */
  const fields = createMemo<Array<[string, FieldSchema]>>(() => {
    const seen = new Set<string>();
    const out: Array<[string, FieldSchema]> = [];
    for (const t of targets()) {
      for (const [k, f] of Object.entries(t.schema)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push([k, f]);
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

  /** Dropdown options for the exchange field: advertised ids + current value. */
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

  const inputTitle = (key: string, f: FieldSchema) => f.description || f.label || key;

  return (
    <Show when={fields().length > 0}>
      <div
        class="flex items-center gap-2"
        data-testid="axis-cfg-plugins"
        title="Shared source/stream settings · history applies on Load/Reload · live applies on Live toggle"
      >
        <For each={fields()}>
          {([key, f]) => (
            <label class="flex items-center gap-1 text-[11px] opacity-80">
              <span class="whitespace-nowrap">{f.label || key}</span>
              <Show
                when={f.type !== 'select' && key !== EXCHANGE_FIELD}
                fallback={
                  <Show
                    when={key !== EXCHANGE_FIELD}
                    fallback={
                      <select
                        class="sc-input w-[9em] font-mono text-[12px]"
                        value={String(valueOf(key) ?? '')}
                        onChange={(e) => setField(key, e.currentTarget.value)}
                        title={inputTitle(key, f)}
                      >
                        <Show when={exchangeOptions().length === 0}>
                          <option value="">loading…</option>
                        </Show>
                        <For each={exchangeOptions()}>
                          {(o) => <option value={o}>{o}</option>}
                        </For>
                      </select>
                    }
                  >
                    <select
                      class="sc-input max-w-[8em] font-mono text-[12px]"
                      value={String(valueOf(key) ?? '')}
                      onChange={(e) => setField(key, e.currentTarget.value)}
                    >
                      <For each={f.options || []}>{(o) => <option value={o}>{o}</option>}</For>
                    </select>
                  </Show>
                }
              >
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
                  <input
                    type={
                      f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'
                    }
                    class="sc-input w-[7em] font-mono text-[12px]"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    placeholder={f.placeholder}
                    value={
                      f.type === 'number' ? Number(valueOf(key) ?? 0) : String(valueOf(key) ?? '')
                    }
                    onInput={(e) => {
                      const raw = e.currentTarget.value;
                      setField(key, f.type === 'number' ? Number(raw) : raw);
                    }}
                    title={inputTitle(key, f)}
                  />
                </Show>
              </Show>
            </label>
          )}
        </For>
      </div>
    </Show>
  );
}
