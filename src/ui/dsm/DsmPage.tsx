// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio **Data** page — the primary Data Source Manager surface.
 *
 * Combines the two DSM planes in one full-page view: the backfill job
 * composer + job list ({@link module:ui/dsm/DsmComposer},
 * {@link module:ui/dsm/DsmJobsList}) and the cached dataset inventory
 * ({@link module:ui/dsm/DatasetsBrowser}, which renders the coverage map for
 * the selected series). The floatable panel and the cached-datasets modal
 * stay available; they reuse the same components.
 *
 * @module ui/dsm/DsmPage
 */

import { type Component, Show, createMemo, createSignal, onMount } from 'solid-js';
import type { BarsCacheMeta } from '../../data/bars-cache';
import { dataSourceManagerState } from '../../data/data-source-manager';
import { store } from '../../store';
import { AppButton, StudioSection, StudioStat, StudioTabs } from '../studio';
import { Icons } from '../icons';
import { DsmComposer } from './DsmComposer';
import { DsmJobsList } from './DsmJobsList';
import { DatasetsBrowser } from './DatasetsBrowser';
import { jobTotals } from './jobs';
import { fmtBytes } from './format';
import { listAllDatasetMetas, totalBarsCached } from './datasets-list';

/** Rough in-memory size of one bar — must match DatasetsBrowser's estimate. */
const BAR_BYTES_EST = 48;

type DataTab = 'jobs' | 'datasets';

const DATA_TABS: readonly { id: DataTab; label: string; hint: string }[] = [
  { id: 'jobs', label: 'Backfill jobs', hint: 'Compose and monitor background OHLCV backfill' },
  { id: 'datasets', label: 'Datasets', hint: 'Browse cached series, coverage, load, export' },
];

/** Studio Data page: backfill jobs + cached dataset inventory. */
export const DsmPage: Component<{ onClose?: () => void }> = () => {
  const [tab, setTab] = createSignal<DataTab>('jobs');
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [datasetRows, setDatasetRows] = createSignal<BarsCacheMeta[]>([]);

  // Seed the summary row immediately; the browser refreshes it when the
  // Datasets tab is open and after every inventory change.
  onMount(() => {
    void listAllDatasetMetas()
      .then(setDatasetRows)
      .catch(() => undefined);
  });

  const totals = createMemo(() => jobTotals(dataSourceManagerState.jobs));
  const datasetStats = createMemo(() => {
    const rows = datasetRows();
    const bars = totalBarsCached(rows);
    return {
      count: rows.length,
      bars,
      storage: fmtBytes(bars * BAR_BYTES_EST),
    };
  });

  return (
    <div class="ax-page-stack">
      <StudioSection
        title="Summary"
        lead="Live counters across every backfill job and every cached dataset. Open the composer to enqueue new work; the walk never blocks the chart."
        testId="axis-data-summary"
        headerEnd={
          <AppButton
            design="soft"
            tone={composerOpen() ? 'ghost' : 'primary'}
            size="sm"
            testId="axis-data-new"
            icon={<Icons.plus />}
            title={composerOpen() ? 'Close the new-job form' : 'Start a new backfill job'}
            onClick={() => {
              setComposerOpen((v) => !v);
            }}
          >
            {composerOpen() ? 'Close form' : 'New job'}
          </AppButton>
        }
      >
        <div class="ax-grid ax-grid--3">
          <StudioStat label="Active jobs" value={totals().active} testId="axis-data-stat-active" />
          <StudioStat
            label="Bars fetched"
            value={totals().bars.toLocaleString()}
            testId="axis-data-stat-bars"
          />
          <StudioStat
            label="Pages fetched"
            value={totals().pages.toLocaleString()}
            testId="axis-data-stat-pages"
          />
          <StudioStat
            label="Datasets cached"
            value={datasetStats().count}
            testId="axis-data-stat-datasets"
          />
          <StudioStat
            label="Bars cached"
            value={datasetStats().bars.toLocaleString()}
            testId="axis-data-stat-cached"
          />
          <StudioStat
            label="Storage estimate"
            value={`≈${datasetStats().storage}`}
            testId="axis-data-stat-storage"
          />
        </div>
        <Show when={totals().issues > 0}>
          <p class="ax-section-lead" data-testid="axis-data-issues-note">
            {totals().issues} job{totals().issues === 1 ? ' has' : 's have'} issues — retry failed
            jobs from the Backfill jobs tab.
          </p>
        </Show>
      </StudioSection>

      <StudioTabs
        tabs={[...DATA_TABS]}
        value={tab()}
        onChange={setTab}
        ariaLabel="Data page sections"
        idPrefix="axis-data-page"
        testId="axis-data-tabs"
      />

      <div class="ax-page-canvas">
        <Show when={tab() === 'jobs'}>
          <StudioSection
            title="Backfill jobs"
            lead={`Enqueue a venue walk from ${store.source || '—'} to cache deeper history, then pause / resume / cancel in bulk.`}
            testId="axis-data-jobs-section"
          >
            <Show when={composerOpen()}>
              <DsmComposer
                testIdPrefix="axis-data"
                onStarted={() => setComposerOpen(false)}
                onCloseRequest={() => setComposerOpen(false)}
              />
            </Show>
            <DsmJobsList testIdPrefix="axis-data" batch />
          </StudioSection>
        </Show>

        <Show when={tab() === 'datasets'}>
          <StudioSection
            title="Dataset inventory"
            lead="Cached OHLCV series across IndexedDB and the session mirror. Select a dataset to inspect its coverage map, load a window to the chart, export CSV, or delete."
            testId="axis-data-datasets-section"
          >
            <DatasetsBrowser
              testIdPrefix="axis-data-datasets"
              onRows={(rows) => setDatasetRows(rows)}
            />
          </StudioSection>
        </Show>
      </div>
    </div>
  );
};
