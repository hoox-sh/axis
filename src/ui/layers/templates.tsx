// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drawing template list (save / import / export / load / merge / delete).
 *
 * @module ui/layers/templates
 */

import { type Component, For, Show } from 'solid-js';
import type { DrawingTemplateSummary, LoadTemplateMode } from '../../chart/drawings/templates';
import { Icons } from '../icons';
import { LayerEmpty } from './rows';

export const DrawingTemplates: Component<{
  symbol: string;
  templates: DrawingTemplateSummary[];
  canSave: boolean;
  onSave: () => void;
  onImport: (e: Event) => void;
  onExportAll: () => void;
  onLoad: (id: string, mode: LoadTemplateMode) => void;
  onExport: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}> = (props) => (
  <div class="mt-1 pt-2 border-t border-border-soft" data-testid="axis-drawing-templates">
    <div class="flex items-center justify-between gap-2 px-1 py-0.5 mb-0.5">
      <span class="text-text-dim">
        Templates{' '}
        <span class="text-text-faint font-mono tabular-nums">({props.templates.length})</span>
      </span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
          disabled={!props.canSave}
          title={`Save drawings for ${props.symbol || 'this symbol'} as a named template`}
          data-testid="axis-tpl-save"
          onClick={props.onSave}
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
            aria-label="Import template JSON"
            data-testid="axis-tpl-import"
            onChange={(e) => props.onImport(e)}
          />
        </label>
        <Show when={props.templates.length > 0}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 text-[0.85em]"
            title="Export all templates as JSON"
            data-testid="axis-tpl-export-all"
            onClick={props.onExportAll}
          >
            Export
          </button>
        </Show>
      </div>
    </div>
    <Show
      when={props.templates.length > 0}
      fallback={<LayerEmpty>No templates</LayerEmpty>}
    >
      <ul class="flex flex-col gap-0.5 m-0 p-0 list-none" aria-label="Drawing templates">
        <For each={props.templates}>
          {(t) => (
            <li
              class="flex items-center gap-1.5 px-1 py-1 bg-bg-elev border border-border-soft"
              data-template-id={t.id}
            >
              <div class="min-w-0 flex-1">
                <div class="text-text truncate font-medium leading-tight">{t.name}</div>
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
                aria-label={`Load template ${t.name}`}
                onClick={() => props.onLoad(t.id, 'replace')}
              >
                Load
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-1 text-[0.85em]"
                title="Merge template drawings into current set"
                aria-label={`Merge template ${t.name}`}
                onClick={() => props.onLoad(t.id, 'merge')}
              >
                Merge
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-1 text-[0.85em]"
                title="Export this template as JSON"
                aria-label={`Export template ${t.name}`}
                onClick={() => props.onExport(t.id)}
              >
                <Icons.download />
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
                title="Delete template"
                aria-label={`Delete template ${t.name}`}
                onClick={() => props.onDelete(t.id, t.name)}
              >
                <Icons.x />
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </div>
);
