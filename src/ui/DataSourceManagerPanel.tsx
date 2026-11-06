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
 * Data Source Manager panel — the floatable DSM surface.
 *
 * The composer and job list live in {@link module:ui/dsm/DsmComposer} and
 * {@link module:ui/dsm/DsmJobsList}; the studio Data page
 * (`src/ui/dsm/DsmPage.tsx`) renders the same features full-page. This panel
 * stays dockable / floatable for quick access — open it from the command
 * palette or Settings → Data → Open DSM.
 *
 * @module ui/DataSourceManagerPanel
 */

import { type Component, Show, createMemo, createSignal } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { dataSourceManagerState } from '../data/data-source-manager';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import { openCachedDatasets } from './datasets-open';
import { DsmComposer } from './dsm/DsmComposer';
import { DsmJobsList } from './dsm/DsmJobsList';
import { jobTotals } from './dsm/jobs';

/** Dockable / floatable Data Source Manager. */
export const DataSourceManagerPanel: Component = () : JSX.Element => {
  const [formOpen, setFormOpen] = createSignal(dataSourceManagerState.jobs.length === 0);
  const [formMsg, setFormMsg] = createSignal('');

  const totals = createMemo(() => jobTotals(dataSourceManagerState.jobs));

  const openDatasets = (e?: Event) => {
    e?.stopPropagation();
    openCachedDatasets();
  };

  const onStarted = () => {
    setFormOpen(false);
  };

  return (
    <Show when={isPanelOpen('datasource')}>
      <FloatableShell
        id="datasource"
        testId="axis-datasource"
        headerEnd={
          <button
            type="button"
            class="ax-dsm-icon"
            onClick={openDatasets}
            onPointerDown={(e) => e.stopPropagation()}
            title="Dataset manager — browse cached OHLCV"
            aria-label="Open dataset manager"
          >
            <Icons.datasets size={12} />
          </button>
        }
      >
        <div class="ax-dsm">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div class="ax-dsm-head">
            <div class="ax-dsm-head-row">
              <span class="ax-dsm-kicker">Backfill</span>
              <span class="ax-dsm-summary" data-testid="axis-datasource-summary">
                <Show when={totals().active > 0}>
                  <span class="is-active">{totals().active} active</span>
                </Show>
                <span>{totals().done} done</span>
                <Show when={totals().issues > 0}>
                  <span class="is-issue">{totals().issues} issues</span>
                </Show>
              </span>
              <span class="ax-dsm-spacer" />
              <button
                type="button"
                class="ax-dsm-new"
                classList={{ 'is-on': formOpen() }}
                title={formOpen() ? 'Close the new-job form' : 'Start a new backfill job'}
                aria-expanded={formOpen()}
                data-testid="axis-datasource-new"
                onClick={() => {
                  if (!formOpen()) setFormMsg('');
                  setFormOpen((v) => !v);
                }}
              >
                <Icons.plus size={11} /> New job
              </button>
            </div>
            <div class="ax-dsm-stats">
              <span title="Bars fetched across all jobs">
                {totals().bars.toLocaleString()} bar{totals().bars === 1 ? '' : 's'}
              </span>
              <span title="Venue pages fetched across all jobs">
                {totals().pages.toLocaleString()} page{totals().pages === 1 ? '' : 's'}
              </span>
              <span class="ax-dsm-source" title="Chart source">
                {store.source || '—'}
              </span>
            </div>
            <button
              type="button"
              class="ax-dsm-browse"
              onClick={openDatasets}
              data-testid="axis-datasource-open-datasets"
              title="Browse cached OHLCV, filter the table, load date range or max bars"
            >
              <Icons.datasets size={11} />
              <span>Browse datasets</span>
              <Icons.arrowRight size={10} class="ax-dsm-browse-arrow" />
            </button>
          </div>

          {/* ── Composer ───────────────────────────────────────────── */}
          <Show when={formOpen()}>
            <DsmComposer
              onStarted={onStarted}
              onCloseRequest={() => setFormOpen(false)}
              onNotify={setFormMsg}
            />
          </Show>

          <Show when={!formOpen() && formMsg()}>
            <div class="ax-dsm-msg" role="status" aria-live="polite">
              {formMsg()}
            </div>
          </Show>

          {/* ── Jobs ───────────────────────────────────────────────── */}
          <DsmJobsList onNotify={setFormMsg} />
        </div>
      </FloatableShell>
    </Show>
  );
};
