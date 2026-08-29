// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plugins studio canvas — catalog / install / library. Sibling of Runtime.
 *
 * @module ui/plugins/PluginsPage
 */

import { For, Show, createMemo, createSignal } from 'solid-js';
import {
  DEFAULT_PYNE_AGENT_PLUGIN_URL,
  getInstalledPlugins,
  loadPluginFromUrl,
  removePlugin,
  type InstalledPlugin,
} from '../../plugins/loader';
import { listSources } from '../../sources/catalog';
import { listStreams } from '../../streams/catalog';
import { listEngines } from '../../engines/catalog';
import { listStorages } from '../../storage/catalog';
import { promptStorageChange } from '../../storage/service';
import { getActiveStorageId } from '../../plugins/active';
import { registry } from '../../plugins/registry';
import { persist, setActivePlugin, store } from '../../store';
import type { PluginBase } from '../../plugins/types';
import { ScriptLibraryPanel } from '../ScriptLibraryPanel';
import { CapabilityBadges, engineOptionLabel } from '../plugin-badges';
import { HooxLoader } from '../HooxLoader';
import { Icons } from '../icons';
import type { StudioPageId } from '../studio/types';
import {
  StudioButton,
  StudioCard,
  StudioChip,
  StudioEmpty,
  StudioField,
  StudioFooter,
  StudioHint,
  StudioInput,
  StudioList,
  StudioRow,
  StudioSection,
  StudioStat,
  StudioTabs,
} from '../studio';

type TabId = 'catalog' | 'install' | 'library';
type KindFilter = 'all' | 'source' | 'stream' | 'engine' | 'storage';

const PLUGIN_TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'catalog', label: 'Catalog', hint: 'Built-in and installed plugins' },
  { id: 'install', label: 'Install', hint: 'Load an ES module from URL' },
  { id: 'library', label: 'Script Library', hint: 'Save and load Pine scripts' },
];

const KIND_CHIPS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'source', label: 'Sources' },
  { id: 'stream', label: 'Streams' },
  { id: 'engine', label: 'Engines' },
  { id: 'storage', label: 'Storage' },
];

/** Served from public/plugins/ in production (dist/plugins/). */
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

export function PluginsPage(props: {
  onClose: () => void;
  onNavigate?: (id: StudioPageId) => void;
  onChanged?: () => void;
  getDoc?: () => string;
  setDoc?: (doc: string, name?: string, libraryId?: string) => void;
}) {
  const [tab, setTab] = createSignal<TabId>('catalog');
  const [kindFilter, setKindFilter] = createSignal<KindFilter>('all');
  const [url, setUrl] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [installed, setInstalled] = createSignal<InstalledPlugin[]>(getInstalledPlugins());
  const [tick, setTick] = createSignal(0);

  const refresh = () => {
    setInstalled(getInstalledPlugins());
    setTick((n) => n + 1);
    props.onChanged?.();
  };

  const sources = createMemo(() => {
    tick();
    return listSources();
  });
  const streams = createMemo(() => {
    tick();
    return listStreams();
  });
  const engines = createMemo(() => {
    tick();
    return listEngines();
  });
  const storages = createMemo(() => {
    tick();
    return listStorages();
  });
  const components = createMemo(() => {
    tick();
    return registry.listComponents();
  });

  const activeSourceId = () => store.activePlugins?.source || store.source;
  const activeStreamId = () => store.activePlugins?.stream || store.live.streamId;
  const activeEngineId = () => store.activePlugins?.engine || store.engine;
  const activeStorageId = () => store.activePlugins?.storage || 'local';

  const activeName = (items: PluginBase[], id: string) =>
    items.find((p) => p.id === id)?.name || id;

  const catalogSections = createMemo(() => {
    const sections: Array<{
      kind: Exclude<KindFilter, 'all'>;
      title: string;
      lead: string;
      items: PluginBase[];
      activeId: string;
    }> = [
      {
        kind: 'source',
        title: 'Sources',
        lead: 'Historical OHLCV used by Load.',
        items: sources(),
        activeId: activeSourceId(),
      },
      {
        kind: 'stream',
        title: 'Streams',
        lead: 'Live bars while the multiplex is running.',
        items: streams(),
        activeId: activeStreamId(),
      },
      {
        kind: 'engine',
        title: 'Engines',
        lead: 'Which runtime evaluates Pine. Activate here; configure on Runtime.',
        items: engines(),
        activeId: activeEngineId(),
      },
      {
        kind: 'storage',
        title: 'Storage',
        lead: 'Script library backend.',
        items: storages(),
        activeId: activeStorageId(),
      },
    ];
    const f = kindFilter();
    if (f === 'all') return sections;
    return sections.filter((s) => s.kind === f);
  });

  const activate = (kind: string, id: string) => {
    if (kind === 'source' || kind === 'stream' || kind === 'engine') {
      setActivePlugin(kind, id);
      refresh();
      return;
    }
    if (kind === 'storage') {
      // Storage changes open the migrate-or-fresh dialog (hosted globally
      // via <StorageChangePrompt />). The engine flip is committed by the
      // dialog; we only refresh the catalog once the dialog accepts the
      // change — see promptStorageChange / cancelPendingStorageChange in
      // storage/service.ts. To keep UX snappy, refresh immediately so the
      // active highlight tracks the in-flight request.
      promptStorageChange(getActiveStorageId(), id);
      refresh();
    }
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
      if (entry.kind === 'engine' || entry.kind === 'source' || entry.kind === 'stream') {
        setActivePlugin(entry.kind, entry.id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeInstalled = (p: InstalledPlugin) => {
    removePlugin(p.id, p.kind);
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
  };

  const done = () => {
    if (!listSources().some((s) => s.id === store.source)) {
      setActivePlugin('source', 'binance-rest');
    }
    if (!listEngines().some((e) => e.id === store.engine)) {
      setActivePlugin('engine', 'server');
    }
    persist();
    props.onClose();
  };

  const footerStatus = () =>
    `Active · src ${store.source} · eng ${store.engine} · stm ${store.live.streamId} · stor ${
      store.activePlugins?.storage || 'local'
    }`;

  return (
    <div class="ax-page-stack">
      <StudioTabs
        tabs={PLUGIN_TABS}
        value={tab()}
        onChange={setTab}
        ariaLabel="Plugin sections"
        idPrefix="axis-plugins"
        testId="axis-plugins-tabs"
      />
      <div class="ax-page-canvas">
        <Show when={tab() === 'catalog'}>
          <div
            id="axis-plugins-panel-catalog"
            role="tabpanel"
            aria-labelledby="axis-plugins-tab-catalog"
            style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--ax-gap)' }}
          >
            <div class="ax-grid ax-grid--3">
              <StudioStat label="Source" value={activeName(sources(), activeSourceId())} />
              <StudioStat label="Stream" value={activeName(streams(), activeStreamId())} />
              <StudioStat label="Engine" value={activeName(engines(), activeEngineId())} />
              <StudioStat label="Storage" value={activeName(storages(), activeStorageId())} />
            </div>

            <StudioSection
              title="Kind"
              lead="Narrow the catalog. Use a row to make it the active source, stream, engine, or storage."
            >
              <div class="ax-chip-row">
                <For each={KIND_CHIPS}>
                  {(chip) => (
                    <StudioChip pressed={kindFilter() === chip.id} onClick={() => setKindFilter(chip.id)}>
                      {chip.label}
                    </StudioChip>
                  )}
                </For>
              </div>
              <StudioHint>
                {sources().length} sources · {streams().length} streams · {engines().length} engines ·{' '}
                {storages().length} storage
              </StudioHint>
            </StudioSection>

            <For each={catalogSections()}>
              {(section) => (
                <StudioSection title={section.title} lead={section.lead}>
                  <Show
                    when={section.items.length}
                    fallback={<StudioEmpty>No {section.title.toLowerCase()} registered.</StudioEmpty>}
                  >
                    <StudioList>
                      <For each={section.items}>
                        {(p) => {
                          const active = () => section.activeId === p.id;
                          return (
                            <StudioRow>
                              <div style={{ flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', gap: '0.4rem' }}>
                                <div class="ax-inline" style={{ 'align-items': 'baseline', gap: '0.7rem' }}>
                                  <span class="ax-card-title">{p.name}</span>
                                  <span class="ax-card-kicker">{p.id}</span>
                                </div>
                                <CapabilityBadges
                                  capabilities={p.capabilities}
                                  builtIn={p.builtIn}
                                  active={active()}
                                />
                                <Show when={p.description}>
                                  <StudioHint>{p.description}</StudioHint>
                                </Show>
                              </div>
                              <StudioButton
                                variant={active() ? 'ghost' : 'primary'}
                                disabled={active()}
                                onClick={() => activate(section.kind, p.id)}
                                title={active() ? 'Currently active' : `Use ${engineOptionLabel(p)}`}
                              >
                                {active() ? 'Active' : 'Use'}
                              </StudioButton>
                            </StudioRow>
                          );
                        }}
                      </For>
                    </StudioList>
                  </Show>
                </StudioSection>
              )}
            </For>

            <Show when={kindFilter() === 'all' && components().length}>
              <StudioSection title="Components" lead="Host UI slots registered with the plugin registry.">
                <StudioList>
                  <For each={components()}>
                    {(p) => (
                      <StudioRow>
                        <div style={{ flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', gap: '0.4rem' }}>
                          <div class="ax-inline" style={{ 'align-items': 'baseline', gap: '0.7rem' }}>
                            <span class="ax-card-title">{p.name}</span>
                            <span class="ax-card-kicker">{p.id}</span>
                          </div>
                          <Show when={p.description}>
                            <StudioHint>{p.description}</StudioHint>
                          </Show>
                        </div>
                        <span class="ax-card-kicker">Built-in</span>
                      </StudioRow>
                    )}
                  </For>
                </StudioList>
              </StudioSection>
            </Show>

            <StudioSection
              title="Related"
              lead="Workers and Wire are sibling pages — not tabs on this page."
            >
              <div class="ax-grid ax-grid--2">
                <StudioCard
                  kicker="Catalog"
                  title="Workers"
                  testId="axis-plugins-goto-status"
                  onClick={() => props.onNavigate?.('workers')}
                >
                  <StudioHint>
                    Probe pyne Pro, the AXIS Worker, Pyodide, and the service worker. Activate one to
                    become the Runtime.
                  </StudioHint>
                </StudioCard>
                <StudioCard
                  kicker="Compose"
                  title="Wire"
                  onClick={() => props.onNavigate?.('wire')}
                >
                  <StudioHint>
                    Start from a recipe, then swap any source, stream, engine, storage, or dataset slot.
                  </StudioHint>
                </StudioCard>
              </div>
            </StudioSection>
          </div>
        </Show>

        <Show when={tab() === 'install'}>
          <div
            id="axis-plugins-panel-install"
            role="tabpanel"
            aria-labelledby="axis-plugins-tab-install"
          >
            <div class="ax-split">
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--ax-gap)' }}>
                <StudioSection
                  title="Load from URL"
                  lead="Sources, streams, engines, datasets, and components (e.g. PYNE Agent). After load, source/stream/engine plugins activate and appear in top-bar pickers."
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void load();
                    }}
                  >
                    <StudioField
                      label="ES module URL"
                      for="axis-plugin-url"
                      hint="https://…/my-plugin.js or /plugins/example-….js"
                      error={error() || undefined}
                    >
                      <div class="ax-inline">
                        <StudioInput
                          id="axis-plugin-url"
                          mono
                          value={url()}
                          onInput={setUrl}
                          placeholder="https://…/my-plugin.js or /plugins/example-….js"
                          spellcheck={false}
                        />
                        <StudioButton
                          type="submit"
                          variant="primary"
                          disabled={busy() || !url().trim()}
                        >
                          {busy() ? <HooxLoader size="xs" /> : <Icons.download />}
                          Load
                        </StudioButton>
                      </div>
                    </StudioField>
                  </form>
                </StudioSection>

                <StudioSection title="Examples" lead="Same-origin modules shipped with AXIS.">
                  <div class="ax-grid ax-grid--2">
                    <For each={EXAMPLES}>
                      {(ex) => (
                        <StudioCard
                          kicker={ex.kind}
                          title={ex.label}
                          onClick={() => {
                            setUrl(ex.url);
                            void load(ex.url);
                          }}
                        >
                          <StudioHint>{ex.url}</StudioHint>
                        </StudioCard>
                      )}
                    </For>
                  </div>
                </StudioSection>
              </div>

              <StudioSection
                title="Installed URLs"
                lead={
                  installed().length
                    ? `${installed().length} dynamic plugin${installed().length === 1 ? '' : 's'}. Reloaded from localStorage on the next visit.`
                    : 'No dynamic plugins yet.'
                }
              >
                <Show
                  when={installed().length}
                  fallback={<StudioEmpty>Load a URL or an example to populate this list.</StudioEmpty>}
                >
                  <StudioList>
                    <For each={installed()}>
                      {(p) => (
                        <StudioRow>
                          <div style={{ flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', gap: '0.35rem' }}>
                            <div class="ax-inline" style={{ 'align-items': 'baseline', gap: '0.7rem' }}>
                              <span class="ax-card-title">{p.name}</span>
                              <span class="ax-card-kicker">
                                {p.kind} · {p.id}
                              </span>
                            </div>
                            <StudioHint>{p.url}</StudioHint>
                          </div>
                          <div class="ax-inline">
                            <StudioButton variant="ghost" onClick={() => activate(p.kind, p.id)}>
                              Use
                            </StudioButton>
                            <StudioButton
                              variant="danger"
                              ariaLabel="Remove"
                              title="Remove"
                              onClick={() => removeInstalled(p)}
                            >
                              <Icons.x />
                            </StudioButton>
                          </div>
                        </StudioRow>
                      )}
                    </For>
                  </StudioList>
                </Show>
              </StudioSection>
            </div>
          </div>
        </Show>

        <Show when={tab() === 'library'}>
          <div
            id="axis-plugins-panel-library"
            role="tabpanel"
            aria-labelledby="axis-plugins-tab-library"
          >
            <StudioSection
              title="Script library"
              lead={`Scripts backend: ${store.activePlugins?.storage || 'local'}. Storage is a Wire slot; activate a backend on Catalog.`}
            >
              <ScriptLibraryPanel getDoc={props.getDoc} setDoc={props.setDoc} />
            </StudioSection>
          </div>
        </Show>
      </div>
      <StudioFooter status={footerStatus()}>
        <StudioButton variant="primary" onClick={done}>
          Done
        </StudioButton>
      </StudioFooter>
    </div>
  );
}
