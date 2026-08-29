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
 * AXIS plugin manager modal — catalog by kind, install from URL, script library.
 *
 * Studio canvas is {@link PluginsPage} (`ax-*` kit). This file remains as a
 * leftover modal implementation; the product overlay uses PluginsPage.
 *
 * Tabs: **catalog** (built-in + installed), **install** (URL + examples),
 * **library** (embeds {@link ScriptLibraryPanel}). Install calls
 * `loadPluginFromUrl`; parent may pass `onChanged` to bump catalogTick.
 */

import { Component, For, Show, createSignal, createMemo } from 'solid-js';
import {
  getInstalledPlugins,
  loadPluginFromUrl,
  removePlugin,
  DEFAULT_PYNE_AGENT_PLUGIN_URL,
  type InstalledPlugin,
} from '../plugins/loader';
import { listSources } from '../sources/catalog';
import { listStreams } from '../streams/catalog';
import { listEngines } from '../engines/catalog';
import { listStorages } from '../storage/catalog';
import { promptStorageChange } from '../storage/service';
import { getActiveStorageId } from '../plugins/active';
import { registry } from '../plugins/registry';
import { ScriptLibraryPanel } from './ScriptLibraryPanel';
import { CapabilityBadges, engineOptionLabel } from './plugin-badges';
import { Icons } from './icons';
import { HooxLoader } from './HooxLoader';
import { persist, setStore, setActivePlugin, store } from '../store';
import type { PluginBase } from '../plugins/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  getDoc?: () => string;
  setDoc?: (doc: string, name?: string) => void;
  /** Initial tab when opening */
  initialTab?: TabId;
  /**
   * When true, render body only (no backdrop/dialog chrome).
   * Used when this leftover modal is embedded.
   */
  embedded?: boolean;
  /** Cross-link to Runtimes → Status (Workers). */
  onOpenStatus?: () => void;
}

// Served from public/plugins/ in production (dist/plugins/); /src/ only works under Vite dev.
const EXAMPLES = [
  { label: 'CoinGecko source', url: '/plugins/example-coingecko-source.js', kind: 'source' },
  { label: 'Tiny Pyne engine', url: '/plugins/example-tiny-pyne-engine.js', kind: 'engine' },
  { label: 'CF DO stream', url: '/plugins/example-cf-do-stream.js', kind: 'stream' },
  {
    label: 'PYNE Agent (NL → scripts)',
    url: DEFAULT_PYNE_AGENT_PLUGIN_URL,
    kind: 'component',
  },
];

type TabId = 'catalog' | 'install' | 'library';
type KindFilter = 'all' | 'source' | 'stream' | 'engine' | 'storage';

/** Modal plugin catalog / install / library host. */
export const PluginManager: Component<Props> = (props) => {
  const [url, setUrl] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [installed, setInstalled] = createSignal<InstalledPlugin[]>(getInstalledPlugins());
  const [tab, setTab] = createSignal<TabId>(props.initialTab || 'catalog');
  const [kindFilter, setKindFilter] = createSignal<KindFilter>('all');

  const refresh = () => {
    setInstalled(getInstalledPlugins());
    props.onChanged?.();
  };

  const load = async (href?: string) => {
    const u = (href || url()).trim();
    if (!u) return;
    setBusy(true);
    setError('');
    try {
      const entry = await loadPluginFromUrl(u);
      setUrl('');
      refresh();
      // Auto-select newly loaded engine/source/stream if useful
      if (entry.kind === 'engine' || entry.kind === 'source' || entry.kind === 'stream') {
        setActivePlugin(entry.kind as 'engine' | 'source' | 'stream', entry.id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sources = createMemo(() => listSources());
  const streams = createMemo(() => listStreams());
  const engines = createMemo(() => listEngines());
  const storages = createMemo(() => listStorages());
  const components = createMemo(() => registry.listComponents());

  const catalogSections = createMemo(() => {
    const sections: Array<{
      kind: KindFilter;
      title: string;
      items: PluginBase[];
      activeId: string;
    }> = [
      {
        kind: 'source',
        title: 'Sources (history)',
        items: sources(),
        activeId: store.activePlugins?.source || store.source,
      },
      {
        kind: 'stream',
        title: 'Streams (live)',
        items: streams(),
        activeId: store.activePlugins?.stream || store.live.streamId,
      },
      {
        kind: 'engine',
        title: 'Engines (calculation)',
        items: engines(),
        activeId: store.activePlugins?.engine || store.engine,
      },
      {
        kind: 'storage',
        title: 'Storage (scripts)',
        items: storages(),
        activeId: store.activePlugins?.storage || 'local',
      },
    ];
    const f = kindFilter();
    if (f === 'all') return sections;
    return sections.filter((s) => s.kind === f);
  });

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const activate = (kind: string, id: string) => {
    if (kind === 'source' || kind === 'stream' || kind === 'engine') {
      setActivePlugin(kind, id);
      refresh();
      return;
    }
    if (kind === 'storage') {
      // Storage changes open the migrate-or-fresh dialog (hosted globally
      // via <StorageChangePrompt />). The engine flip is committed by the
      // dialog; refresh immediately so the active highlight tracks the
      // in-flight request.
      promptStorageChange(getActiveStorageId(), id);
      refresh();
    }
  };

  const tabBtn = (id: TabId, label: string) => (
    <button
      role="tab"
      aria-selected={tab() === id}
      class={`flex-1 px-3 py-2.5 text-[12px] font-medium border-b-2 -mb-[2px] ${
        tab() === id
          ? 'border-b-accent text-text'
          : 'border-b-transparent text-text-dim hover:text-text'
      }`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  const inner = (
    <>
          <div
            class={`sc-dialog-tabs sc-dialog-tabs--underline flex-shrink-0 ${
              props.embedded ? 'border-t border-border/60' : ''
            }`}
            role="tablist"
            aria-label="Plugin sections"
          >
            {tabBtn('catalog', 'Catalog')}
            {tabBtn('install', 'Install')}
            {tabBtn('library', 'Script Library')}
          </div>

          {/* fixed tall body: tabs stay put; content scrolls inside */}

          <div
            class="sc-dialog-body flex flex-col gap-4 overflow-auto text-[12px] min-h-0 flex-1"
            data-testid="axis-manager"
          >
            <Show when={props.onOpenStatus}>
              <div class="flex flex-wrap items-center gap-2 text-[11px] border border-border bg-bg-elev/50 px-2.5 py-1.5">
                <span class="text-text-faint">
                  Calculation backends &amp; health live under{' '}
                  <strong class="text-text-dim font-medium">Status</strong>.
                </span>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost text-[10px] px-2 ml-auto"
                  data-testid="axis-plugins-goto-status"
                  onClick={() => props.onOpenStatus?.()}
                >
                  <Icons.cpu size={12} />
                  Open Status
                </button>
              </div>
            </Show>
            <Show when={tab() === 'catalog'}>
              <div class="flex flex-wrap gap-1.5">
                <For
                  each={
                    [
                      ['all', 'All'],
                      ['source', 'Sources'],
                      ['stream', 'Streams'],
                      ['engine', 'Engines'],
                      ['storage', 'Storage'],
                    ] as [KindFilter, string][]
                  }
                >
                  {([id, label]) => (
                    <button
                      class={`sc-btn text-[11px] px-3 ${
                        kindFilter() === id ? 'sc-btn-primary' : 'sc-btn-ghost'
                      }`}
                      onClick={() => setKindFilter(id)}
                    >
                      {label}
                    </button>
                  )}
                </For>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-text-faint font-mono">
                <div class="border-2 border-border px-2.5 py-1.5">sources: {sources().length}</div>
                <div class="border-2 border-border px-2.5 py-1.5">streams: {streams().length}</div>
                <div class="border-2 border-border px-2.5 py-1.5">engines: {engines().length}</div>
                <div class="border-2 border-border px-2.5 py-1.5">storage: {storages().length}</div>
              </div>

              <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              <For each={catalogSections()}>
                {(section) => (
                  <div class="flex flex-col gap-2 min-w-0">
                    <div class="text-[11px] text-text-dim uppercase tracking-wider font-semibold">
                      {section.title}
                    </div>
                    <ul class="flex flex-col gap-1.5 max-h-[min(420px,40vh)] overflow-auto pr-0.5">
                      <For each={section.items}>
                        {(p) => {
                          const active = () => section.activeId === p.id;
                          return (
                            <li
                              class={`flex items-start gap-2 border-2 px-2.5 py-2 bg-bg-elev ${
                                active() ? 'border-accent' : 'border-border'
                              }`}
                            >
                              <div class="flex-1 min-w-0">
                                <div class="text-text font-medium flex items-center gap-1.5 flex-wrap">
                                  {p.name}
                                  <span class="text-text-faint font-mono text-[9px]">{p.id}</span>
                                </div>
                                <CapabilityBadges
                                  capabilities={p.capabilities}
                                  builtIn={p.builtIn}
                                  active={active()}
                                  compact
                                />
                                <Show when={p.description}>
                                  <div class="text-text-faint text-[10px] mt-0.5 line-clamp-2">
                                    {p.description}
                                  </div>
                                </Show>
                              </div>
                              <button
                                class={`sc-btn text-[10px] px-2 flex-shrink-0 ${
                                  active() ? 'sc-btn-ghost text-accent-2' : 'sc-btn-primary'
                                }`}
                                disabled={active()}
                                onClick={() => activate(section.kind, p.id)}
                                title={
                                  active()
                                    ? 'Currently active'
                                    : `Use ${engineOptionLabel(p)}`
                                }
                              >
                                {active() ? 'Active' : 'Use'}
                              </button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
              <Show when={kindFilter() === 'all' && components().length}>
                <div class="flex flex-col gap-2 min-w-0 xl:col-span-2">
                  <div class="text-[11px] text-text-dim uppercase tracking-wider font-semibold">
                    Components
                  </div>
                  <ul class="flex flex-col gap-1.5">
                    <For each={components()}>
                      {(p) => (
                        <li class="flex items-start gap-2 border-2 border-border px-2.5 py-2 bg-bg-elev">
                          <div class="flex-1 min-w-0">
                            <div class="text-text font-medium flex items-center gap-1.5 flex-wrap">
                              {p.name}
                              <span class="text-text-faint font-mono text-[9px]">{p.id}</span>
                            </div>
                            <Show when={p.description}>
                              <div class="text-text-faint text-[10px] mt-0.5">{p.description}</div>
                            </Show>
                          </div>
                          <span class="text-[10px] text-text-faint flex-shrink-0">Built-in</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
              </div>
            </Show>

            <Show when={tab() === 'install'}>
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 min-h-0 flex-1">
              <div class="flex flex-col gap-3 min-w-0">
              <div class="flex flex-col gap-1.5">
                <label class="text-[11px] text-text-dim uppercase tracking-wider">
                  Load ES module from URL
                </label>
                <div class="flex gap-1.5">
                  <input
                    class="sc-input flex-1 min-w-0 font-mono text-[12px]"
                    placeholder="https://…/my-plugin.js or /plugins/example-….js"
                    value={url()}
                    onInput={(e) => setUrl(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Enter' && load()}
                  />
                  <button
                    class="sc-btn sc-btn-primary inline-flex items-center gap-1"
                    disabled={busy() || !url().trim()}
                    onClick={() => load()}
                  >
                    {busy() ? (
                      <HooxLoader size="xs" />
                    ) : (
                      <Icons.download size={13} />
                    )}
                    Load
                  </button>
                </div>
                <Show when={error()}>
                  <p class="text-red font-mono text-[11px]">{error()}</p>
                </Show>
                <p class="text-[10px] text-text-faint">
                  Sources, streams, engines, datasets, and components (e.g. PYNE Agent) are
                  supported. After load, source/stream/engine plugins are activated
                  and appears in top-bar pickers.
                </p>
              </div>

              <div>
                <div class="text-[11px] text-text-dim uppercase tracking-wider mb-1.5">Examples</div>
                <div class="flex flex-col gap-1.5">
                  <For each={EXAMPLES}>
                    {(ex) => (
                      <button
                        class="sc-btn sc-btn-ghost text-left text-[11px] font-mono justify-start py-2"
                        onClick={() => {
                          setUrl(ex.url);
                          void load(ex.url);
                        }}
                      >
                        <span class="text-text-faint mr-1">[{ex.kind}]</span>
                        {ex.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              </div>

              <div class="flex flex-col min-h-0 min-w-0">
                <div class="text-[11px] text-text-dim uppercase tracking-wider mb-1.5">
                  Installed URLs ({installed().length})
                </div>
                <Show
                  when={installed().length > 0}
                  fallback={<div class="text-text-faint p-3 border-2 border-border">No dynamic plugins yet.</div>}
                >
                  <ul class="flex flex-col gap-1.5 overflow-auto flex-1 max-h-[min(560px,60vh)]">
                    <For each={installed()}>
                      {(p) => (
                        <li class="flex items-center gap-2 border-2 border-border bg-bg-elev px-2.5 py-2">
                          <div class="flex-1 min-w-0">
                            <div class="text-text font-medium text-[12px]">{p.name}</div>
                            <div class="text-text-faint font-mono text-[11px] truncate">
                              {p.kind} · {p.id}
                            </div>
                            <div
                              class="text-text-faint font-mono text-[10px] truncate"
                              title={p.url}
                            >
                              {p.url}
                            </div>
                          </div>
                          <button
                            class="sc-btn sc-btn-ghost px-2 text-[11px]"
                            title="Activate"
                            onClick={() => activate(p.kind, p.id)}
                          >
                            Use
                          </button>
                          <button
                            class="sc-btn sc-btn-ghost px-1.5"
                            title="Remove"
                            onClick={() => {
                              removePlugin(p.id, p.kind);
                              // Fall back if we removed the active plugin
                              if (p.kind === 'engine' && store.engine === p.id) {
                                setActivePlugin('engine', 'server');
                              }
                              if (p.kind === 'source' && store.source === p.id) {
                                setActivePlugin('source', 'binance-rest');
                              }
                              if (p.kind === 'stream' && store.live.streamId === p.id) {
                                setActivePlugin('stream', 'binance-ws');
                              }
                              refresh();
                            }}
                          >
                            <Icons.x size={13} />
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
              </div>
            </Show>

            <Show when={tab() === 'library'}>
              <ScriptLibraryPanel getDoc={props.getDoc} setDoc={props.setDoc} />
            </Show>
          </div>

          <div class="flex items-center gap-2 px-3.5 py-2.5 border-t-2 border-border bg-bg-base flex-shrink-0">
            <div class="flex-1 text-[10px] text-text-faint truncate">
              {tab() === 'catalog' &&
                `Active · src ${store.source} · eng ${store.engine} · stm ${store.live.streamId} · stor ${store.activePlugins?.storage || 'local'}`}
              {tab() === 'install' && 'URL plugins re-load on next visit from localStorage'}
              {tab() === 'library' &&
                `Scripts backend: ${store.activePlugins?.storage || 'local'}`}
            </div>
            <button
              class="sc-btn sc-btn-primary"
              onClick={() => {
                if (!listSources().some((s) => s.id === store.source)) {
                  setActivePlugin('source', 'binance-rest');
                }
                if (!listEngines().some((e) => e.id === store.engine)) {
                  setActivePlugin('engine', 'server');
                }
                persist();
                props.onClose();
              }}
            >
              Done
            </button>
          </div>
    </>
  );

  if (props.embedded) {
    return (
      <Show when={props.open}>
        <div class="flex flex-col min-h-0 flex-1 overflow-hidden">{inner}</div>
      </Show>
    );
  }

  return (
    <Show when={props.open}>
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(1200px,calc(100vw-2*var(--ui-dialog-margin)))] h-[min(900px,calc(100vh-2*var(--ui-dialog-margin-y)))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-plugins-title"
          data-testid="axis-manager"
        >
          <div class="sc-dialog-accent" />
          <div class="sc-dialog-header">
            <span
              id="axis-plugins-title"
              class="text-base font-semibold text-text tracking-tight inline-flex items-center gap-2"
            >
              <Icons.folder size={16} />
              Plugins
            </span>
            <button class="sc-btn sc-btn-ghost px-2" onClick={props.onClose} aria-label="Close">
              <Icons.x size={14} />
            </button>
          </div>
          {inner}
        </div>
      </div>
    </Show>
  );
};
