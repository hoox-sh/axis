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
 * Inline config row for the active source/stream plugin.
 *
 * Renders one compact field per entry of the plugin's `configSchema`
 * (string / number / boolean / select / password) next to the Topbar
 * pickers. Values persist to `store.pluginsConfig[pluginKey(kind, id)]`
 * — the same bag `load-symbol` and `multiplex` hand to plugins as
 * `opts.config`. An `exchange` field gets a datalist fed by the datafeed
 * gateway's `/health` exchange list.
 *
 * @module ui/PluginConfigRow
 */

import { For, Show, createMemo, createSignal } from 'solid-js';
import { store, setStore, persist } from '../store';
import { getActiveSource, getActiveStream } from '../plugins/active';
import { pluginKey, type FieldSchema } from '../plugins/types';
import { effectiveConfig, fetchGatewayExchanges, hasConfigFields } from './plugin-config';

const EXCHANGE_DATALIST_ID = 'axis-gw-exchanges';

export interface PluginConfigRowProps {
  kind: 'source' | 'stream';
  /** Called after a field changes (e.g. re-fetch historical bars). */
  onApplied?: () => void;
}

export function PluginConfigRow(props: PluginConfigRowProps) {
  const plugin = createMemo(() => (props.kind === 'source' ? getActiveSource() : getActiveStream()));
  const schema = createMemo(() => {
    const s = plugin()?.configSchema;
    return hasConfigFields(s) ? s! : undefined;
  });
  const stored = createMemo(() => {
    const p = plugin();
    if (!p) return {} as Record<string, unknown>;
    const all = store.pluginsConfig || {};
    return (all[pluginKey(props.kind, p.id)] as Record<string, unknown> | undefined) || {};
  });
  const values = createMemo(() => effectiveConfig(schema(), stored()));

  const [exchanges, setExchanges] = createSignal<string[]>([]);
  // Lazy: pull gateway exchange ids once an `exchange` field is rendered.
  createMemo(() => {
    if (!schema() || !('exchange' in schema()!)) return;
    const mode = String(values().gateway || 'auto') as 'auto' | 'pyne' | 'sidecar';
    void fetchGatewayExchanges(mode).then(setExchanges);
  });

  const setField = (key: string, v: unknown) => {
    const p = plugin();
    if (!p) return;
    setStore('pluginsConfig', pluginKey(props.kind, p.id), key, v);
    void persist();
    props.onApplied?.();
  };

  const inputTitle = (key: string, f: FieldSchema) =>
    f.description || f.label || key;

  return (
    <Show when={schema()}>
      <div
        class="flex items-center gap-2"
        data-testid={`axis-cfg-${props.kind}`}
        title={
          props.kind === 'stream'
            ? 'Plugin settings · toggle Live to apply'
            : 'Plugin settings · applied on Load/Reload'
        }
      >
        <datalist id={EXCHANGE_DATALIST_ID}>
          <For each={exchanges()}>{(e) => <option value={e} />}</For>
        </datalist>
        <For each={Object.entries(schema()!)}>
          {([key, f]) => (
            <label class="flex items-center gap-1 text-[11px] opacity-80">
              <span class="whitespace-nowrap">{f.label || key}</span>
              <Show
                when={f.type !== 'select'}
                fallback={
                  <select
                    class="sc-input max-w-[8em] font-mono text-[12px]"
                    value={String(values()[key] ?? '')}
                    onChange={(e) => setField(key, e.currentTarget.value)}
                  >
                    <For each={f.options || []}>{(o) => <option value={o}>{o}</option>}</For>
                  </select>
                }
              >
                <Show
                  when={f.type !== 'boolean'}
                  fallback={
                    <input
                      type="checkbox"
                      checked={Boolean(values()[key])}
                      onChange={(e) => setField(key, e.currentTarget.checked)}
                    />
                  }
                >
                  <input
                    type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    class={`sc-input ${key === 'exchange' ? 'w-[8em]' : 'w-[7em]'} font-mono text-[12px]`}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    placeholder={f.placeholder}
                    list={key === 'exchange' ? EXCHANGE_DATALIST_ID : undefined}
                    value={f.type === 'number' ? Number(values()[key] ?? 0) : String(values()[key] ?? '')}
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
