// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layers panel — panes, scripts, overlays, on-chain series, and user drawings.
 *
 * One search filters every section, sections collapse (persisted), and each
 * section header carries its own bulk visibility controls. Drawing rows are
 * selectable, hideable, lockable, and removable; templates live at the bottom.
 *
 * Presentational pieces live under `ui/layers/`. FloatableShell id `layers`.
 * Script settings opens per applied indicator.
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  store,
  isPanelOpen,
  setPaneVisible,
  clearDrawingsForSymbol,
  openScriptSettings,
  setSelectedDrawingId,
  setDrawingTool,
  deleteDrawing,
  patchDrawing,
  setDrawings,
} from '../store';
import {
  getManager,
  getActiveDrawingLayer,
  visibleDrawingsForActiveSymbol,
} from '../chart/manager-access';
import { volumeProfileEnabled, toggleVolumeProfileEnabled } from '../chart/volume-profile';
import { footprintEnabled, toggleFootprintEnabled } from '../chart/footprint';
import {
  onchainManagerState,
  setOnchainSeriesVisible,
  detachOnchainSeries,
  setOnchainEventsVisible,
} from '../onchain/manager';
import { FloatableShell } from './panels/FloatableShell';
import { Icons } from './icons';
import { resolveDrawingStyle, toolLabel, type Drawing } from '../chart/drawing-types';
import {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  getTemplate,
  applyTemplateDrawings,
  exportTemplateJson,
  exportAllTemplatesJson,
  importTemplates,
  type LoadTemplateMode,
} from '../chart/drawings/templates';
import {
  cloneDrawings,
  drawingsForSymbol,
  mergeDrawings,
  mergeLayerDrawingsForSymbol,
  tagDrawingsSymbol,
} from '../chart/drawings/sync';
import { announce } from './sr-announce';
import { DrawingList } from './layers/drawings';
import { drawingMatchesQuery, onchainSeriesSub } from './layers/format';
import { LayerEmpty, LayerRow, LayerSection } from './layers/rows';
import { DrawingTemplates } from './layers/templates';
import { readCollapsedSections, toggleCollapsedSection, type LayerSectionId } from './layers/prefs';

/** Pane / indicator / drawing visibility and remove actions. */
export const LayerPanel: Component = () => {
  /** Bump to re-read localStorage template catalog. */
  const [tplTick, setTplTick] = createSignal(0);
  const [query, setQuery] = createSignal('');
  const [hiddenOnly, setHiddenOnly] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<LayerSectionId>>(
    new Set(readCollapsedSections()),
  );
  let searchInput: HTMLInputElement | undefined;

  const templates = createMemo(() => {
    void tplTick();
    return listTemplates();
  });

  /** Drawings for the active chart symbol (plus untagged legacy). */
  const symbolDrawings = createMemo(() => visibleDrawingsForActiveSymbol(store.symbol));
  const onchainCount = createMemo(
    () => onchainManagerState.series.length + (onchainManagerState.events.length > 0 ? 1 : 0),
  );
  const overlayCount = createMemo(
    () => Number(volumeProfileEnabled()) + Number(footprintEnabled()),
  );

  const normalizedQuery = () => query().trim().toLowerCase();
  const matches = (...parts: (string | null | undefined)[]) => {
    const q = normalizedQuery();
    if (!q) return true;
    return parts.filter(Boolean).join(' ').toLowerCase().includes(q);
  };

  const filteredScripts = createMemo(() =>
    store.scripts.filter((s) => (!hiddenOnly() || !s.visible) && matches(s.name, s.paneId)),
  );
  const filteredPanes = createMemo(() =>
    [...store.panes]
      .sort((a, b) => a.order - b.order)
      .filter((p) => (!hiddenOnly() || !p.visible) && matches(p.label || p.id, p.id, p.type)),
  );
  const filteredOnchain = createMemo(() => ({
    series: onchainManagerState.series.filter(
      (s) =>
        (!hiddenOnly() || s.visible === false) &&
        matches(s.label || s.key || s.id, onchainSeriesSub(s)),
    ),
    events:
      onchainManagerState.events.length > 0 &&
      (!hiddenOnly() || onchainManagerState.eventsVisible === false) &&
      matches('Event markers', onchainManagerState.eventSourceLabel),
  }));
  const filteredDrawings = createMemo(() =>
    symbolDrawings().filter(
      (d) => (!hiddenOnly() || Boolean(d.meta?.hidden)) && drawingMatchesQuery(d, query()),
    ),
  );
  const filteredTemplates = createMemo(() =>
    templates().filter((t) => !hiddenOnly() && matches(t.name, t.meta?.symbol, t.meta?.interval)),
  );

  const hiddenTotal = createMemo(
    () =>
      store.scripts.filter((s) => !s.visible).length +
      store.panes.filter((p) => !p.visible).length +
      symbolDrawings().filter((d) => d.meta?.hidden).length +
      onchainManagerState.series.filter((s) => s.visible === false).length,
  );

  const matchTotal = createMemo(
    () =>
      filteredScripts().length +
      filteredPanes().length +
      filteredOnchain().series.length +
      filteredDrawings().length,
  );

  // A filter typed for the previous ticker should not hide the next symbol's rows.
  createEffect(() => {
    void store.symbol;
    setQuery('');
    setHiddenOnly(false);
  });

  onMount(() => {
    // `/` focuses the layer search while the panel is mounted.
    const onSlash = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchInput?.focus();
    };
    window.addEventListener('keydown', onSlash);
    onCleanup(() => window.removeEventListener('keydown', onSlash));
  });

  const isCollapsed = (id: LayerSectionId) => collapsed().has(id);
  const toggleSection = (id: LayerSectionId) => {
    setCollapsed(new Set(toggleCollapsedSection(id, [...collapsed()])));
  };

  const refreshTemplates = () => setTplTick((n) => n + 1);

  const resetFilters = () => {
    setQuery('');
    setHiddenOnly(false);
    searchInput?.focus();
  };

  const togglePane = (id: string, next: boolean) => {
    setPaneVisible(id, next);
    getManager()?.setVisible(id, next);
  };

  const onToggleIndicator = (id: string) => {
    void import('../indicators/visibility').then(({ toggleScriptChartVisible }) => {
      toggleScriptChartVisible(id);
    });
  };

  const onRemoveIndicator = (id: string, _paneId: string) => {
    void import('../indicators/detach').then(({ detachIndicatorFromChart }) => {
      detachIndicatorFromChart(id);
    });
  };

  const showAllScripts = () => {
    void import('../indicators/visibility').then(({ setScriptChartVisible }) => {
      for (const script of store.scripts) {
        if (!script.visible) setScriptChartVisible(script.id, true);
      }
      announce('All scripts shown');
    });
  };

  const hideAllScripts = () => {
    void import('../indicators/visibility').then(({ setScriptChartVisible }) => {
      for (const script of store.scripts) {
        if (script.visible) setScriptChartVisible(script.id, false);
      }
      announce('All scripts hidden');
    });
  };

  /** Push the active-symbol list to the layer (never the full multi-symbol store). */
  const syncLayerDrawings = (list: Drawing[]) => {
    const layer = getActiveDrawingLayer();
    if (layer) {
      try {
        layer.setDrawings(list);
      } catch {
        /* ignore */
      }
    }
  };

  const setDrawingHidden = (d: Drawing, hidden: boolean) => {
    const nextMeta = { ...(d.meta || {}), hidden };
    patchDrawing(d.id, { meta: nextMeta } as Partial<Drawing>);
    // Layer only paints the active symbol’s drawings
    syncLayerDrawings(
      visibleDrawingsForActiveSymbol(store.symbol).map((x) =>
        x.id === d.id ? ({ ...x, meta: nextMeta } as Drawing) : x,
      ),
    );
    // Re-apply selection paint after hide toggle
    if (store.selectedDrawingId === d.id) {
      getActiveDrawingLayer()?.setSelectedId(d.id);
    }
  };

  const onToggleDrawingVisible = (d: Drawing) => setDrawingHidden(d, !d.meta?.hidden);

  const showAllDrawings = () => {
    const visible = symbolDrawings();
    if (!visible.some((d) => d.meta?.hidden)) return;
    for (const d of visible) {
      if (d.meta?.hidden) setDrawingHidden(d, false);
    }
    announce(`Shown all drawings for ${store.symbol || 'this symbol'}`);
  };

  const hideAllDrawings = () => {
    const visible = symbolDrawings();
    if (!visible.some((d) => !d.meta?.hidden)) return;
    for (const d of visible) {
      if (!d.meta?.hidden) setDrawingHidden(d, true);
    }
    announce(`Hidden all drawings for ${store.symbol || 'this symbol'}`);
  };

  const onToggleDrawingLock = (d: Drawing) => {
    const locked = !resolveDrawingStyle(d).locked;
    patchDrawing(d.id, {
      locked,
      meta: { ...(d.meta || {}), locked },
    } as Partial<Drawing>);
    syncLayerDrawings(
      visibleDrawingsForActiveSymbol(store.symbol).map((x) =>
        x.id === d.id ? ({ ...x, locked, meta: { ...(x.meta || {}), locked } } as Drawing) : x,
      ),
    );
    announce(`${locked ? 'Locked' : 'Unlocked'} drawing`);
  };

  const onClearDrawings = () => {
    const visible = symbolDrawings();
    const symbol = store.symbol || 'this symbol';
    if (visible.length && !confirm(`Clear drawings for ${symbol}?`)) {
      return;
    }
    clearDrawingsForSymbol(store.symbol);
    setSelectedDrawingId(null);
    syncLayerDrawings([]);
    announce(`Cleared drawings for ${symbol}`);
  };

  /**
   * Duplicate drawings for the active symbol with new ids (template-style).
   * Clones are stamped with the current symbol and merged into the full store.
   */
  const onDuplicateDrawings = () => {
    const visible = symbolDrawings();
    if (!visible.length) return;
    const clones = cloneDrawings(visible, { symbol: store.symbol });
    const next = mergeDrawings(store.drawings, clones, 'append');
    setDrawings(next);
    syncLayerDrawings(visibleDrawingsForActiveSymbol(store.symbol));
    announce(
      `Duplicated ${clones.length} drawing${clones.length === 1 ? '' : 's'} on ${store.symbol || 'this symbol'}`,
    );
  };

  /**
   * Keep drawings for the active symbol only (untagged count as current).
   * Drops drawings tagged for other symbols via `meta.symbol`.
   */
  const onKeepThisSymbol = () => {
    if (!store.drawings.length) return;
    const kept = drawingsForSymbol(store.drawings, store.symbol, {
      includeUntagged: true,
    });
    if (kept.length === store.drawings.length) return;
    setDrawings(kept as Drawing[]);
    setSelectedDrawingId(null);
    syncLayerDrawings(kept as Drawing[]);
    announce(
      `Kept ${kept.length} drawing${kept.length === 1 ? '' : 's'} for ${store.symbol || 'this symbol'}`,
    );
  };

  /**
   * Stamp `meta.symbol` on every drawing with the active chart symbol.
   * Migrates untagged legacy drawings onto the current ticker.
   */
  const onTagWithSymbol = () => {
    if (!store.drawings.length) return;
    const next = tagDrawingsSymbol(store.drawings, store.symbol) as Drawing[];
    setDrawings(next);
    syncLayerDrawings(visibleDrawingsForActiveSymbol(store.symbol));
    announce(`Tagged drawings with ${store.symbol || 'this symbol'}`);
  };

  /** Select drawing in store + live layer (shows handles on chart). */
  const onSelectDrawing = (id: string) => {
    setSelectedDrawingId(id);
    setDrawingTool('cursor');
    const layer = getActiveDrawingLayer();
    if (layer) {
      try {
        layer.setTool('cursor');
        layer.setSelectedId(id);
      } catch {
        /* ignore */
      }
    }
  };

  const onRemoveDrawing = (id: string) => {
    deleteDrawing(id);
    const layer = getActiveDrawingLayer();
    if (layer) {
      try {
        layer.setDrawings(visibleDrawingsForActiveSymbol(store.symbol));
        if (layer.getSelectedId() === id) layer.setSelectedId(null);
      } catch {
        /* ignore */
      }
    }
  };

  const onSaveTemplate = () => {
    const visible = symbolDrawings();
    if (!visible.length) return;
    const name = window.prompt('Template name', `Pack ${templates().length + 1}`);
    if (!name?.trim()) return;
    saveTemplate(name.trim(), visible, {
      meta: {
        symbol: store.symbol,
        interval: store.interval,
        exchange: store.exchange,
      },
    });
    refreshTemplates();
    announce(`Saved template ${name.trim()}`);
  };

  const onLoadTemplate = (id: string, mode: LoadTemplateMode) => {
    const tpl = getTemplate(id);
    if (!tpl) return;
    const visible = symbolDrawings();
    if (
      mode === 'replace' &&
      visible.length &&
      !confirm(`Replace ${visible.length} drawing(s) for ${store.symbol} with "${tpl.name}"?`)
    ) {
      return;
    }
    // Apply template against the active-symbol subset, then merge back so
    // other symbols keep their drawings.
    const applied = applyTemplateDrawings(visible, tpl, mode) as Drawing[];
    const stamped = tagDrawingsSymbol(applied, store.symbol) as Drawing[];
    const next = mergeLayerDrawingsForSymbol(store.drawings, store.symbol, stamped, {
      includeUntagged: true,
    }) as Drawing[];
    setDrawings(next);
    setSelectedDrawingId(null);
    syncLayerDrawings(visibleDrawingsForActiveSymbol(store.symbol));
    announce(`${mode === 'replace' ? 'Loaded' : 'Merged'} template ${tpl.name}`);
  };

  const onDeleteTemplate = (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    deleteTemplate(id);
    refreshTemplates();
    announce(`Deleted template ${name}`);
  };

  const onExportTemplate = (id: string) => {
    const tpl = getTemplate(id);
    if (!tpl) return;
    const blob = new Blob([exportTemplateJson(tpl)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `axis-drawing-${tpl.name.replace(/[^\w.-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onExportAllTemplates = () => {
    const blob = new Blob([exportAllTemplatesJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'axis-drawing-templates.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImportTemplatesFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const n = importTemplates(text, { forceNewIds: true });
      if (n === 0) {
        window.alert('No templates found in file.');
      } else {
        announce(`Imported ${n} template${n === 1 ? '' : 's'}`);
      }
      refreshTemplates();
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      input.value = '';
    }
  };

  return (
    <Show when={isPanelOpen('layers') || store.layerPanel.open}>
      <FloatableShell id="layers" testId="axis-layers">
        <div class="ax-layers flex flex-col flex-1 min-h-0">
          {/* ── Search + summary ───────────────────────────────────── */}
          <div class="ax-layers-head">
            <div class="ax-layers-search">
              <Icons.search size={12} />
              <input
                ref={searchInput}
                type="search"
                class="ax-layers-search-input"
                placeholder="Find layers…"
                aria-label="Find layers"
                data-testid="axis-layers-search"
                value={query()}
                autocomplete="off"
                spellcheck={false}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && (query() || hiddenOnly())) {
                    e.preventDefault();
                    resetFilters();
                  }
                }}
              />
              <Show when={query()} fallback={<kbd class="ax-layers-kbd">/</kbd>}>
                <button
                  type="button"
                  class="ax-layers-search-clear"
                  title="Clear search"
                  aria-label="Clear layer search"
                  onClick={resetFilters}
                >
                  <Icons.x size={10} />
                </button>
              </Show>
            </div>
            <button
              type="button"
              class="ax-layers-icon"
              classList={{ 'is-on': hiddenOnly() }}
              title={hiddenOnly() ? 'Show all layers' : 'Show only hidden layers'}
              aria-label="Show only hidden layers"
              aria-pressed={hiddenOnly()}
              data-testid="axis-layers-hidden-only"
              onClick={() => setHiddenOnly((v) => !v)}
            >
              <Icons.eyeOff size={11} />
            </button>
          </div>

          <div class="ax-layers-summary" data-testid="axis-layers-summary">
            <span title="Applied scripts">{store.scripts.length} scripts</span>
            <span title="Chart panes">{store.panes.length} panes</span>
            <span title="Drawings for the active symbol">{symbolDrawings().length} drawings</span>
            <Show when={hiddenTotal() > 0}>
              <span class="is-warn" title="Hidden layers across this panel">
                {hiddenTotal()} hidden
              </span>
            </Show>
          </div>

          <Show when={query() || hiddenOnly()}>
            <div class="ax-layers-filterbar" data-testid="axis-layers-filterbar">
              <span>
                {hiddenOnly() ? 'Hidden only' : `“${query().trim()}”`} · {matchTotal()} match
                {matchTotal() === 1 ? '' : 'es'}
              </span>
              <button type="button" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </Show>

          {/* ── Sections ───────────────────────────────────────────── */}
          <div class="ax-layers-scroll">
            <LayerSection
              title="Scripts"
              count={store.scripts.length}
              matched={filteredScripts().length}
              collapsed={isCollapsed('scripts')}
              onToggleCollapsed={() => toggleSection('scripts')}
              testId="axis-layers-section-scripts"
              actions={
                <>
                  <button
                    type="button"
                    class="ax-layers-icon"
                    title="Show all scripts"
                    aria-label="Show all scripts"
                    onClick={showAllScripts}
                  >
                    <Icons.eye size={10} />
                  </button>
                  <button
                    type="button"
                    class="ax-layers-icon"
                    title="Hide all scripts"
                    aria-label="Hide all scripts"
                    onClick={hideAllScripts}
                  >
                    <Icons.eyeOff size={10} />
                  </button>
                </>
              }
            >
              <Show
                when={filteredScripts().length > 0}
                fallback={
                  <LayerEmpty>
                    {store.scripts.length ? 'No scripts match' : 'No scripts on the chart'}
                  </LayerEmpty>
                }
              >
                <ul class="ax-layers-list" aria-label="Chart scripts">
                  <For each={filteredScripts()}>
                    {(ind) => (
                      <li>
                        <LayerRow
                          label={ind.name}
                          sub={ind.paneId}
                          visible={ind.visible}
                          hidden={!ind.visible}
                          icon={
                            /\bstrategy\s*\(/.test(ind.code) ? (
                              <Icons.trend size={11} />
                            ) : (
                              <Icons.activity size={11} />
                            )
                          }
                          onToggle={() => onToggleIndicator(ind.id)}
                          onSettings={() => openScriptSettings(ind.id)}
                          onRemove={() => onRemoveIndicator(ind.id, ind.paneId)}
                          testId={`axis-layers-script-${ind.id}`}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </LayerSection>

            <LayerSection
              title="Panes"
              count={store.panes.length}
              matched={filteredPanes().length}
              collapsed={isCollapsed('panes')}
              onToggleCollapsed={() => toggleSection('panes')}
              testId="axis-layers-section-panes"
            >
              <Show
                when={filteredPanes().length > 0}
                fallback={<LayerEmpty>No panes match</LayerEmpty>}
              >
                <ul class="ax-layers-list" aria-label="Chart panes">
                  <For each={filteredPanes()}>
                    {(pane) => (
                      <li>
                        <LayerRow
                          label={pane.label || pane.id}
                          sub={`${pane.type}${pane.height ? ` · ${pane.height}px` : ''}`}
                          visible={pane.visible}
                          hidden={!pane.visible}
                          visibilityLocked={pane.id === 'price'}
                          icon={<Icons.panelBottom size={11} />}
                          badge={pane.id === 'price' ? 'locked' : undefined}
                          onToggle={() => togglePane(pane.id, !pane.visible)}
                          testId={`axis-layers-pane-${pane.id}`}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </LayerSection>

            <LayerSection
              title="Overlays"
              count={overlayCount()}
              collapsed={isCollapsed('overlays')}
              onToggleCollapsed={() => toggleSection('overlays')}
              testId="axis-layers-section-overlays"
            >
              <LayerRow
                label="Volume profile"
                sub="fixed range"
                badge="est."
                visible={volumeProfileEnabled()}
                hidden={!volumeProfileEnabled()}
                icon={<Icons.barChart size={11} />}
                onToggle={() => toggleVolumeProfileEnabled()}
              />
              <LayerRow
                label="Footprint"
                sub="per candle"
                badge="est."
                visible={footprintEnabled()}
                hidden={!footprintEnabled()}
                icon={<Icons.dataView size={11} />}
                onToggle={() => toggleFootprintEnabled()}
                testId="axis-layers-footprint"
              />
            </LayerSection>

            <LayerSection
              title="On-chain"
              count={onchainCount()}
              matched={filteredOnchain().series.length + (filteredOnchain().events ? 1 : 0)}
              collapsed={isCollapsed('onchain')}
              onToggleCollapsed={() => toggleSection('onchain')}
              testId="axis-layers-section-onchain"
            >
              <div data-testid="axis-layers-onchain">
                <Show
                  when={filteredOnchain().series.length > 0 || filteredOnchain().events}
                  fallback={
                    <LayerEmpty>
                      {onchainManagerState.series.length || onchainManagerState.events.length
                        ? 'No on-chain layers match'
                        : 'No on-chain series'}
                    </LayerEmpty>
                  }
                >
                  <ul class="ax-layers-list" aria-label="On-chain series">
                    <For each={filteredOnchain().series}>
                      {(s) => (
                        <li>
                          <LayerRow
                            label={s.label || s.key || s.id}
                            sub={onchainSeriesSub(s)}
                            visible={s.visible !== false}
                            hidden={s.visible === false}
                            icon={<Icons.onchain size={11} />}
                            onToggle={() => setOnchainSeriesVisible(s.id, s.visible === false)}
                            onRemove={() => detachOnchainSeries(s.id)}
                            testId={`axis-layers-onchain-series-${s.id}`}
                            removeTitle="Detach series"
                          />
                        </li>
                      )}
                    </For>
                    <Show when={filteredOnchain().events}>
                      <li>
                        <LayerRow
                          label="Event markers"
                          sub={
                            onchainManagerState.eventSourceLabel ||
                            `${onchainManagerState.events.length} event${
                              onchainManagerState.events.length === 1 ? '' : 's'
                            }`
                          }
                          visible={onchainManagerState.eventsVisible !== false}
                          hidden={onchainManagerState.eventsVisible === false}
                          icon={<Icons.pin size={11} />}
                          onToggle={() =>
                            setOnchainEventsVisible(onchainManagerState.eventsVisible === false)
                          }
                          testId="axis-layers-onchain-events"
                        />
                      </li>
                    </Show>
                  </ul>
                </Show>
              </div>
            </LayerSection>

            <LayerSection
              title="Drawings"
              count={symbolDrawings().length}
              matched={filteredDrawings().length}
              collapsed={isCollapsed('drawings')}
              onToggleCollapsed={() => toggleSection('drawings')}
              testId="axis-layers-section-drawings"
              actions={
                <>
                  <button
                    type="button"
                    class="ax-layers-icon"
                    title="Show all drawings"
                    aria-label="Show all drawings"
                    onClick={showAllDrawings}
                  >
                    <Icons.eye size={10} />
                  </button>
                  <button
                    type="button"
                    class="ax-layers-icon"
                    title="Hide all drawings"
                    aria-label="Hide all drawings"
                    onClick={hideAllDrawings}
                  >
                    <Icons.eyeOff size={10} />
                  </button>
                </>
              }
            >
              <DrawingList
                symbol={store.symbol}
                drawings={symbolDrawings()}
                filtered={filteredDrawings()}
                totalCount={store.drawings.length}
                selectedId={store.selectedDrawingId}
                toolName={toolLabel(store.drawingTool)}
                toolActive={store.drawingTool !== 'cursor'}
                query={query()}
                onDuplicate={onDuplicateDrawings}
                onKeepSymbol={onKeepThisSymbol}
                onTagSymbol={onTagWithSymbol}
                onClear={onClearDrawings}
                onSelect={onSelectDrawing}
                onToggleVisible={onToggleDrawingVisible}
                onToggleLock={onToggleDrawingLock}
                onRemove={onRemoveDrawing}
              />
              <DrawingTemplates
                symbol={store.symbol}
                templates={filteredTemplates()}
                canSave={symbolDrawings().length > 0}
                onSave={onSaveTemplate}
                onImport={(e) => void onImportTemplatesFile(e)}
                onExportAll={onExportAllTemplates}
                onLoad={onLoadTemplate}
                onExport={onExportTemplate}
                onDelete={onDeleteTemplate}
              />
            </LayerSection>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
