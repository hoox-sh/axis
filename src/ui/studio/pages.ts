// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Copy, test ids, and rail grouping for studio pages.
 *
 * @module ui/studio/pages
 */

import type { StudioPageId } from './types';

/** Rail/nav metadata for one studio page: copy, grouping, and stable test ids. */
export type StudioPageMeta = {
  id: StudioPageId;
  label: string;
  kicker: string;
  title: string;
  purpose: string;
  group: 'primary' | 'catalog';
  testId: string;
  titleId: string;
  closeTestId: string;
  /** Extra test ids kept for existing e2e. */
  aliasTestIds?: string[];
};

/** Ordered rail entries — primary pages first, then the Workers/Plugins catalog. */
export const STUDIO_PAGES: StudioPageMeta[] = [
  {
    id: 'settings',
    label: 'Settings',
    kicker: 'Settings',
    title: 'Settings',
    purpose: 'Chart chrome, live data, storage, editor, theme, and notifications.',
    group: 'primary',
    testId: 'axis-settings',
    titleId: 'axis-settings-title',
    closeTestId: 'axis-settings-close',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    kicker: 'Runtime',
    title: 'Active calculation',
    purpose: 'Engine, endpoint, and health of what is computing Pine right now.',
    group: 'primary',
    testId: 'axis-runtimes-hub',
    titleId: 'axis-runtimes-title',
    closeTestId: 'axis-runtimes-close',
    aliasTestIds: ['axis-runtime-page'],
  },
  {
    id: 'wire',
    label: 'Wire',
    kicker: 'Wire',
    title: 'Compose the plan',
    purpose: 'Start from a recipe, then swap any source, stream, engine, storage, or dataset slot.',
    group: 'primary',
    testId: 'axis-architecture-modal',
    titleId: 'axis-architecture-title',
    closeTestId: 'axis-architecture-close',
  },
  {
    id: 'data',
    label: 'Data',
    kicker: 'Data',
    title: 'Data manager',
    purpose:
      'Cached dataset inventory and background OHLCV backfill — coverage, load, export, jobs.',
    group: 'primary',
    testId: 'axis-data-page',
    titleId: 'axis-data-page-title',
    closeTestId: 'axis-data-page-close',
  },
  {
    id: 'workers',
    label: 'Workers',
    kicker: 'Workers',
    title: 'Backend inventory',
    purpose: 'Probe and install calculation backends. Activate one to become the Runtime.',
    group: 'catalog',
    testId: 'axis-workers-manager',
    titleId: 'axis-workers-title',
    closeTestId: 'axis-workers-close',
  },
  {
    id: 'plugins',
    label: 'Plugins',
    kicker: 'Plugins',
    title: 'Contract catalog',
    purpose: 'Sources, streams, engines, storage, and libraries. Use a row or install from URL.',
    group: 'catalog',
    testId: 'axis-manager',
    titleId: 'axis-plugins-title',
    closeTestId: 'axis-plugins-close',
  },
  {
    id: 'debug',
    label: 'Debug',
    kicker: 'Debug',
    title: 'Logs & diagnostics',
    purpose:
      'Turn chart/engine logging on and read the rotating log ring live — no rebuild or .env edit.',
    group: 'catalog',
    testId: 'axis-debug-page',
    titleId: 'axis-debug-title',
    closeTestId: 'axis-debug-close',
  },
];

/** Index of {@link STUDIO_PAGES} keyed by id, so lookup cannot miss a page. */
export const STUDIO_PAGE_BY_ID: Record<StudioPageId, StudioPageMeta> = Object.fromEntries(
  STUDIO_PAGES.map((p) => [p.id, p]),
) as Record<StudioPageId, StudioPageMeta>;

/**
 * Metadata for a studio page id.
 *
 * @param id - Known page id (type-checked against {@link StudioPageId}).
 * @returns The matching entry; every id has one, so this never returns undefined.
 */
export function studioPageMeta(id: StudioPageId): StudioPageMeta {
  return STUDIO_PAGE_BY_ID[id];
}
