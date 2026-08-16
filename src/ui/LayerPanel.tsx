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
 * FloatableShell id `layers`. Script settings opens per applied indicator.
 */

import { Component, For, Show, createSignal, createMemo } from 'solid-js';
import {
  store,
  isPanelOpen,
  setPaneVisible,
  toggleIndicator,

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
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import {
  toolLabel,
  resolveDrawingStyle,
  type Drawing,
} from '../chart/drawing-types';
import {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  getTemplate,
  applyTemplateDrawings,
  exportTemplateJson,
  exportAllTemplatesJson,
  importTemplates,
  type DrawingTemplateSummary,
  type LoadTemplateMode,
} from '../chart/drawings/templates';
import {
  cloneDrawings,
  drawingsForSymbol,
  mergeDrawings,
  mergeLayerDrawingsForSymbol,
  tagDrawingsSymbol,
} from '../chart/drawings/sync';

/** Pane / indicator / drawing visibility and remove actions. */
export const LayerPanel: Component = () => {
  /** Bump to re-read localStorage template catalog. */
  const [tplTick, setTplTick] = createSignal(0);
  const templates = createMemo(() => {
    void tplTick();
    return listTemplates();
  });

  /** Drawings for the active chart symbol (plus untagged legacy). */
  const symbolDrawings = createMemo(() =>
    visibleDrawingsForActiveSymbol(store.symbol),
  );

  const refreshTemplates = () => setTplTick((n) => n + 1);

  const togglePane = (id: string, next: boolean) => {
    setPaneVisible(id, next);
    getManager()?.setVisible(id, next);
  };

  const onToggleIndicator = (id: string, paneId: string, currentlyVisible: boolean) => {
    toggleIndicator(id);
    const manager = getManager();
    if (!manager) return;
    if (currentlyVisible) {
      // Hide only this script’s series — keep siblings on the same pane
      try {
        if (typeof manager.removeOverlaysForOwner === 'function') {
          manager.removeOverlaysForOwner(paneId, id);
        } else {
          manager.removeOverlays(paneId);
        }
      } catch {
        /* ignore */
      }
    } else {
      // Turning back on — re-run to repaint
      const script = store.scripts.find((s) => s.id === id);
      if (script?.code?.trim()) {
        void import('../indicators/runner').then(({ runAndApply }) => {
          void runAndApply(script.code, id, {
            silent: true,
            openResults: false,
            inputs: script.inputValues,
            strategyProps: script.strategyProps,
          });
        });
      }
    }
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
    if (
      visible.length &&
      !confirm(`Clear drawings for ${store.symbol || 'this symbol'}?`)
    ) {
      return;
    }
    clearDrawingsForSymbol(store.symbol);
    setSelectedDrawingId(null);
    syncLayerDrawings([]);
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
  };

  const onDeleteTemplate = (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    deleteTemplate(id);
    refreshTemplates();
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
        <div class="flex-1 overflow-y-auto min-h-0 p-2 text-[0.85em] flex flex-col gap-2">
          <Section title="Panes">
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
          </Section>

          <Section title="Overlays">
            <LayerRow
              label="Volume profile"
              sub="OHLCV estimate · fixed range"
              visible={volumeProfileEnabled()}
              onToggle={() => toggleVolumeProfileEnabled()}
            />
          </Section>

          <Section title="On-Chain">
            <div data-testid="axis-layers-onchain" class="flex flex-col gap-0.5">
              <Show
                when={
                  onchainManagerState.series.length > 0 ||
                  onchainManagerState.events.length > 0
                }
                fallback={
                  <Empty>
                    No on-chain series. Attach TVL from the On-Chain panel.
                  </Empty>
                }
              >
                <For each={onchainManagerState.series}>
                  {(s) => (
                    <LayerRow
                      label={s.label || s.key || s.id}
                      sub={[
                        s.provider || s.providerId,
                        s.loading ? 'loading…' : null,
                        s.error ? 'error' : null,
                        s.lastTvl != null
                          ? `$${formatCompactUsd(s.lastTvl)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
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
          </Section>

          <Section title="Scripts">
            <Show
              when={store.scripts.length > 0}
              fallback={<Empty>No scripts on chart. Run Pine to add layers.</Empty>}
            >
              <For each={store.scripts}>
                {(ind) => (
                  <LayerRow
                    label={ind.name}
                    sub={ind.paneId}
                    visible={ind.visible}
                    onToggle={() => onToggleIndicator(ind.id, ind.paneId, ind.visible)}
                    onSettings={() => openScriptSettings(ind.id)}
                    onRemove={() => onRemoveIndicator(ind.id, ind.paneId)}
                  />
                )}
              </For>
            </Show>
          </Section>

          <Section title="Drawings">
            <div
              class="flex items-center gap-2 px-1.5 py-1.5 mb-1 bg-bg-elev border border-border-soft"
              data-testid="axis-layers-active-tool"
            >
              <span class="text-[0.78em] uppercase tracking-wider text-text-faint flex-shrink-0">
                Tool
              </span>
              <span
                class={`flex-1 truncate font-medium ${
                  store.drawingTool !== 'cursor' ? 'text-accent' : 'text-text-dim'
                }`}
              >
                {toolLabel(store.drawingTool)}
              </span>
              <Show when={store.selectedDrawingId}>
                <span class="text-[0.78em] font-mono text-accent flex-shrink-0">sel</span>
              </Show>
            </div>
            <div class="flex items-center justify-between gap-2 px-1 py-0.5 mb-0.5 flex-wrap">
              <span class="text-text-dim">
                {store.symbol || 'Symbol'}{' '}
                <span class="text-text-faint font-mono">
                  ({symbolDrawings().length}
                  {store.drawings.length !== symbolDrawings().length
                    ? ` / ${store.drawings.length}`
                    : ''}
                  )
                </span>
              </span>
              <div class="flex items-center gap-1 flex-wrap justify-end">
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
                  disabled={!symbolDrawings().length}
                  title={`Duplicate drawings for ${store.symbol} with new IDs`}
                  data-testid="axis-layers-duplicate-drawings"
                  onClick={onDuplicateDrawings}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
                  disabled={!store.drawings.length}
                  title={`Keep only drawings for ${store.symbol} (untagged kept; other symbols removed)`}
                  data-testid="axis-layers-keep-symbol"
                  onClick={onKeepThisSymbol}
                >
                  This symbol
                </button>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
                  disabled={!store.drawings.length}
                  title={`Tag all drawings with symbol ${store.symbol}`}
                  data-testid="axis-layers-tag-symbol"
                  onClick={onTagWithSymbol}
                >
                  Tag symbol
                </button>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
                  disabled={!symbolDrawings().length}
                  title={`Clear drawings for ${store.symbol}`}
                  onClick={onClearDrawings}
                >
                  Clear
                </button>
              </div>
            </div>
            <div class="px-1 pb-1 text-[0.75em] text-text-faint leading-snug">
              Drawings are anchored to the chart symbol ({store.symbol || '—'}).
              Other symbols keep their own drawings. Tag symbol migrates untagged
              legacy items onto the current ticker.
            </div>
            <Show
              when={symbolDrawings().length > 0}
              fallback={
                <Empty>
                  No drawings for {store.symbol || 'this symbol'}. Use the left
                  tool rail to place shapes.
                </Empty>
              }
            >
              <For each={symbolDrawings()}>
                {(d) => {
                  const selected = () => store.selectedDrawingId === d.id;
                  const visible = () => !d.meta?.hidden;
                  const st = () => resolveDrawingStyle(d);
                  return (
                    <div
                      class={`flex items-center gap-1.5 px-1 py-1 border cursor-pointer transition-colors ${
                        selected()
                          ? 'bg-accent/15 border-accent'
                          : 'bg-bg-elev border-border-soft hover:border-border'
                      }`}
                      data-drawing-id={d.id}
                      data-selected={selected() ? '1' : '0'}
                      role="button"
                      tabIndex={0}
                      title="Click to select on chart"
                      onClick={() => onSelectDrawing(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectDrawing(d.id);
                        }
                      }}
                    >
                      <button
                        type="button"
                        class={`w-5 h-5 text-[0.75em] flex items-center justify-center border-2 flex-shrink-0 ${
                          visible()
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-border bg-bg-hover text-text-dim'
                        }`}
                        title={visible() ? 'Hide' : 'Show'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleDrawingVisible(d);
                        }}
                      >
                        {visible() ? '●' : '○'}
                      </button>
                      <span
                        class="w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-border-soft"
                        style={{ background: st().color }}
                        title={st().color}
                      />
                      <div class="min-w-0 flex-1">
                        <div
                          class={`truncate font-medium leading-tight ${
                            selected() ? 'text-accent' : 'text-text'
                          }`}
                        >
                          {drawingListLabel(d)}
                        </div>
                        <div class="text-[0.78em] text-text-faint font-mono truncate">
                          {toolLabel(d.kind)}
                          {st().locked ? ' · locked' : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
                        title="Remove drawing"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveDrawing(d.id);
                        }}
                      >
                        <Icons.x />
                      </button>
                    </div>
                  );
                }}
              </For>
            </Show>
            <div class="px-1 mt-1 text-[0.78em] text-text-faint">
              Script drawings refresh on each run (not listed).
            </div>

            {/* Drawing templates (analysis packs) */}
            <div
              class="mt-2 pt-2 border-t border-border-soft"
              data-testid="axis-drawing-templates"
            >
              <div class="flex items-center justify-between gap-2 px-1 py-0.5 mb-0.5">
                <span class="text-text-dim">
                  Templates{' '}
                  <span class="text-text-faint font-mono">({templates().length})</span>
                </span>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
                    disabled={!symbolDrawings().length}
                    title={`Save drawings for ${store.symbol} as a named template`}
                    data-testid="axis-tpl-save"
                    onClick={onSaveTemplate}
                  >
                    Save
                  </button>
                  <label
                    class="sc-btn sc-btn-ghost px-1.5 text-[0.85em] cursor-pointer"
                    title="Import template JSON"
                  >
                    Import
                    <input
                      type="file"
                      accept="application/json,.json"
                      class="sr-only"
                      data-testid="axis-tpl-import"
                      onChange={onImportTemplatesFile}
                    />
                  </label>
                  <Show when={templates().length > 0}>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
                      title="Export all templates as JSON"
                      data-testid="axis-tpl-export-all"
                      onClick={onExportAllTemplates}
                    >
                      Export
                    </button>
                  </Show>
                </div>
              </div>
              <Show
                when={templates().length > 0}
                fallback={
                  <Empty>No templates yet. Save drawings as an analysis pack.</Empty>
                }
              >
                <For each={templates()}>
                  {(t: DrawingTemplateSummary) => (
                    <div
                      class="flex items-center gap-1.5 px-1 py-1 bg-bg-elev border border-border-soft hover:border-border"
                      data-template-id={t.id}
                    >
                      <div class="min-w-0 flex-1">
                        <div class="text-text truncate font-medium leading-tight">
                          {t.name}
                        </div>
                        <div class="text-[0.78em] text-text-faint font-mono truncate">
                          {t.drawingCount} drawing{t.drawingCount === 1 ? '' : 's'}
                          {t.meta?.symbol ? ` · ${t.meta.symbol}` : ''}
                          {t.meta?.interval ? ` ${t.meta.interval}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 text-[0.85em]"
                        title="Replace current drawings with this template"
                        onClick={() => onLoadTemplate(t.id, 'replace')}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 text-[0.85em]"
                        title="Merge template drawings into current set"
                        onClick={() => onLoadTemplate(t.id, 'merge')}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 text-[0.85em]"
                        title="Export this template as JSON"
                        onClick={() => onExportTemplate(t.id)}
                      >
                        <Icons.download />
                      </button>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
                        title="Delete template"
                        onClick={() => onDeleteTemplate(t.id, t.name)}
                      >
                        <Icons.x />
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Section>
        </div>
      </FloatableShell>
    </Show>
  );
};

/** Short human label for a drawing row. */
function drawingListLabel(d: Drawing): string {
  switch (d.kind) {
    case 'hline':
      return `H · ${Number(d.price).toFixed(2)}`;
    case 'vline':
      return `V · ${formatBarTime(d.time)}`;
    case 'text':
      return (d.text || d.meta?.text || 'Text').slice(0, 32);
    case 'measure': {
      const dp = d.p2.price - d.p1.price;
      return `Δ ${dp >= 0 ? '+' : ''}${dp.toFixed(2)}`;
    }
    case 'fib':
      return `Fib · ${Math.min(d.p1.price, d.p2.price).toFixed(0)}–${Math.max(d.p1.price, d.p2.price).toFixed(0)}`;
    case 'trend':
    case 'ray':
    case 'extend':
    case 'arrow':
      return `${toolLabel(d.kind)} · ${d.p1.price.toFixed(1)}→${d.p2.price.toFixed(1)}`;
    case 'rect':
    case 'ellipse':
      return toolLabel(d.kind);
    default:
      return toolLabel((d as Drawing).kind);
  }
}

function formatBarTime(t: number): string {
  if (!Number.isFinite(t)) return '—';
  // unix seconds vs ms
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(t);
  }
}

const Section: Component<{ title: string; children: any }> = (props) => (
  <div>
    <div class="text-[0.78em] uppercase tracking-wider text-text-faint font-semibold mb-1 px-0.5">
      {props.title}
    </div>
    <div class="flex flex-col gap-0.5">{props.children}</div>
  </div>
);

const Empty: Component<{ children: any }> = (props) => (
  <div class="text-text-faint italic px-1 py-1 text-[0.85em]">{props.children}</div>
);

/** Compact USD for on-chain last values (e.g. TVL). */
function formatCompactUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

const LayerRow: Component<{
  label: string;
  sub?: string;
  visible: boolean;
  locked?: boolean;
  onToggle: () => void;
  onSettings?: () => void;
  onRemove?: () => void;
  /** Optional root data-testid (e.g. axis-layers-onchain-*). */
  testId?: string;
  /** Tooltip for the remove/detach control. */
  removeTitle?: string;
}> = (props) => (
  <div
    class="flex items-center gap-1.5 px-1 py-1 bg-bg-elev border border-border-soft hover:border-border"
    data-testid={props.testId}
  >
    <button
      type="button"
      class={`w-5 h-5 text-[0.75em] flex items-center justify-center border-2 flex-shrink-0 ${
        props.visible
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-border bg-bg-hover text-text-dim'
      } ${props.locked ? 'opacity-50 cursor-not-allowed' : ''}`}
      disabled={props.locked}
      title={props.visible ? 'Hide' : 'Show'}
      onClick={() => !props.locked && props.onToggle()}
    >
      {props.visible ? '●' : '○'}
    </button>
    <div class="min-w-0 flex-1">
      <div class="text-text truncate font-medium leading-tight">{props.label}</div>
      <Show when={props.sub}>
        <div class="text-[0.78em] text-text-faint font-mono truncate">{props.sub}</div>
      </Show>
    </div>
    <Show when={props.onSettings}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1"
        title="Script settings"
        onClick={props.onSettings}
      >
        <Icons.settings />
      </button>
    </Show>
    <Show when={props.onRemove}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
        title={props.removeTitle || 'Remove'}
        data-testid={
          props.testId ? `${props.testId}-detach` : undefined
        }
        onClick={props.onRemove}
      >
        <Icons.x />
      </button>
    </Show>
  </div>
);
