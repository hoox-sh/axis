// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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
  <div class="ax-layers-templates" data-testid="axis-drawing-templates">
    <div class="ax-layers-templates-bar">
      <span class="ax-layers-templates-hint" title="Reusable drawing packs stored in this browser">
        Saved packs
      </span>
      <span class="ax-layers-spacer" />
      <button
        type="button"
        class="ax-layers-icon"
        disabled={!props.canSave}
        title={`Save drawings for ${props.symbol || 'this symbol'} as a named template`}
        aria-label="Save drawings as template"
        data-testid="axis-tpl-save"
        onClick={props.onSave}
      >
        <Icons.save size={11} />
      </button>
      <label class="ax-layers-icon" title="Import template JSON" aria-label="Import template JSON">
        <Icons.upload size={11} />
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
          class="ax-layers-icon"
          title="Export all templates as JSON"
          aria-label="Export all templates"
          data-testid="axis-tpl-export-all"
          onClick={props.onExportAll}
        >
          <Icons.download size={11} />
        </button>
      </Show>
    </div>
    <Show when={props.templates.length > 0} fallback={<LayerEmpty>No saved templates</LayerEmpty>}>
      <ul class="ax-layers-list" aria-label="Drawing templates">
        <For each={props.templates}>
          {(t) => (
            <li class="ax-layers-template" data-template-id={t.id}>
              <div class="ax-layers-template-main">
                <div class="ax-layers-row-label" title={t.name}>
                  {t.name}
                </div>
                <div class="ax-layers-row-sub">
                  {t.drawingCount} drawing{t.drawingCount === 1 ? '' : 's'}
                  {t.meta?.symbol ? ` · ${t.meta.symbol}` : ''}
                  {t.meta?.interval ? ` ${t.meta.interval}` : ''}
                </div>
              </div>
              <div class="ax-layers-template-actions">
                <button
                  type="button"
                  class="ax-layers-mini-btn"
                  title="Replace current drawings with this template"
                  aria-label={`Load template ${t.name}`}
                  onClick={() => props.onLoad(t.id, 'replace')}
                >
                  Load
                </button>
                <button
                  type="button"
                  class="ax-layers-mini-btn"
                  title="Merge template drawings into current set"
                  aria-label={`Merge template ${t.name}`}
                  onClick={() => props.onLoad(t.id, 'merge')}
                >
                  Merge
                </button>
                <button
                  type="button"
                  class="ax-layers-icon"
                  title="Export this template as JSON"
                  aria-label={`Export template ${t.name}`}
                  onClick={() => props.onExport(t.id)}
                >
                  <Icons.download size={10} />
                </button>
                <button
                  type="button"
                  class="ax-layers-icon is-danger"
                  title="Delete template"
                  aria-label={`Delete template ${t.name}`}
                  onClick={() => props.onDelete(t.id, t.name)}
                >
                  <Icons.x size={10} />
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </div>
);
