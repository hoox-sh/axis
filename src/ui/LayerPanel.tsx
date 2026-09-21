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
 * Layers panel — panes, indicators, user drawings visibility/management.
 *
 * User drawings are listed individually, selectable (syncs chart selection),
 * hideable per-item, and removable. Visibility toggles hit both store and
 * chart manager / drawing layer.
 *
 * Presentational pieces live under `ui/layers/`. FloatableShell id `layers`.
 * Script settings opens per applied indicator.
 */

import { type Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
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
import {
  volumeProfileEnabled,
  toggleVolumeProfileEnabled,
} from '../chart/volume-profile';
import {
  onchainManagerState,
  setOnchainSeriesVisible,
  detachOnchainSeries,
  setOnchainEventsVisible,
} from '../onchain/manager';
import { FloatableShell } from './panels/FloatableShell';
import { toolLabel, type Drawing } from '../chart/drawing-types';
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

/** Pane / indicator / drawing visibility and remove actions. */
export const LayerPanel: Component = () => {
  /** Bump to re-read localStorage template catalog. */
  const [tplTick, setTplTick] = createSignal(0);
  const [drawingQuery, setDrawingQuery] = createSignal('');
  const templates = createMemo(() => {
    void tplTick();
    return listTemplates();
  });

  /** Drawings for the active chart symbol (plus untagged legacy). */
  const symbolDrawings = createMemo(() =>
    visibleDrawingsForActiveSymbol(store.symbol),
  );
  const filteredDrawings = createMemo(() =>
    symbolDrawings().filter((d) => drawingMatchesQuery(d, drawingQuery())),
  );
  const onchainCount = createMemo(
    () =>
      onchainManagerState.series.length +
      (onchainManagerState.events.length > 0 ? 1 : 0),
  );

  // A filter typed for the previous ticker should not hide the next symbol's rows.
  createEffect(() => {
    void store.symbol;
    setDrawingQuery('');
  });

  const refreshTemplates = () => setTplTick((n) => n + 1);

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

  const onToggleDrawingVisible = (d: Drawing) => {
    const hidden = !d.meta?.hidden;
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
      !confirm(
        `Replace ${visible.length} drawing(s) for ${store.symbol} with "${tpl.name}"?`,
      )
    ) {
      return;
    }
    // Apply template against the active-symbol subset, then merge back so
    // other symbols keep their drawings.
    const applied = applyTemplateDrawings(visible, tpl, mode) as Drawing[];
    const stamped = tagDrawingsSymbol(applied, store.symbol) as Drawing[];
    const next = mergeLayerDrawingsForSymbol(
      store.drawings,
      store.symbol,
      stamped,
      { includeUntagged: true },
    ) as Drawing[];
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
        <div class="flex-1 overflow-y-auto min-h-0 text-[12px] flex flex-col gap-3">
          <LayerSection title="Panes" count={store.panes.length}>
            <For each={[...store.panes].sort((a, b) => a.order - b.order)}>
              {(pane) => (
                <LayerRow
                  label={pane.label || pane.id}
                  sub={pane.type}
                  visible={pane.visible}
                  onToggle={() => togglePane(pane.id, !pane.visible)}
                  locked={pane.id === 'price'}
                />
              )}
            </For>
          </LayerSection>

          <LayerSection title="Overlays">
            <LayerRow
              label="Volume profile"
              sub="OHLCV estimate · fixed range"
              visible={volumeProfileEnabled()}
              onToggle={() => toggleVolumeProfileEnabled()}
            />
          </LayerSection>

          <LayerSection title="On-chain" count={onchainCount()}>
            <div data-testid="axis-layers-onchain" class="flex flex-col gap-0.5">
              <Show
                when={
                  onchainManagerState.series.length > 0 ||
                  onchainManagerState.events.length > 0
                }
                fallback={<LayerEmpty>No on-chain series</LayerEmpty>}
              >
                <For each={onchainManagerState.series}>
                  {(s) => (
                    <LayerRow
                      label={s.label || s.key || s.id}
                      sub={onchainSeriesSub(s)}
                      visible={s.visible !== false}
                      onToggle={() =>
                        setOnchainSeriesVisible(s.id, s.visible === false)
                      }
                      onRemove={() => detachOnchainSeries(s.id)}
                      testId={`axis-layers-onchain-series-${s.id}`}
                      removeTitle="Detach series"
                    />
                  )}
                </For>
                <Show when={onchainManagerState.events.length > 0}>
                  <LayerRow
                    label="Event markers"
                    sub={
                      onchainManagerState.eventSourceLabel ||
                      `${onchainManagerState.events.length} event${
                        onchainManagerState.events.length === 1 ? '' : 's'
                      }`
                    }
                    visible={onchainManagerState.eventsVisible !== false}
                    onToggle={() =>
                      setOnchainEventsVisible(
                        onchainManagerState.eventsVisible === false,
                      )
                    }
                    testId="axis-layers-onchain-events"
                  />
                </Show>
              </Show>
            </div>
          </LayerSection>

          <LayerSection title="Scripts" count={store.scripts.length}>
            <Show
              when={store.scripts.length > 0}
              fallback={<LayerEmpty>No scripts on the chart</LayerEmpty>}
            >
              <ul class="flex flex-col gap-0.5 m-0 p-0 list-none" aria-label="Chart scripts">
                <For each={store.scripts}>
                  {(ind) => (
                    <li>
                      <LayerRow
                        label={ind.name}
                        sub={ind.paneId}
                        visible={ind.visible}
                        onToggle={() => onToggleIndicator(ind.id)}
                        onSettings={() => openScriptSettings(ind.id)}
                        onRemove={() => onRemoveIndicator(ind.id, ind.paneId)}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </LayerSection>

          <LayerSection title="Drawings" count={symbolDrawings().length}>
            <DrawingList
              symbol={store.symbol}
              drawings={symbolDrawings()}
              filtered={filteredDrawings()}
              totalCount={store.drawings.length}
              selectedId={store.selectedDrawingId}
              toolName={toolLabel(store.drawingTool)}
              toolActive={store.drawingTool !== 'cursor'}
              query={drawingQuery()}
              onQuery={setDrawingQuery}
              onDuplicate={onDuplicateDrawings}
              onKeepSymbol={onKeepThisSymbol}
              onTagSymbol={onTagWithSymbol}
              onClear={onClearDrawings}
              onSelect={onSelectDrawing}
              onToggleVisible={onToggleDrawingVisible}
              onRemove={onRemoveDrawing}
            />
            <DrawingTemplates
              symbol={store.symbol}
              templates={templates()}
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
      </FloatableShell>
    </Show>
  );
};
