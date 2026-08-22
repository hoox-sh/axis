// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Copy, test ids, and rail grouping for studio pages.
 *
 * @module ui/studio/pages
 */

import type { StudioPageId } from './types';

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

export const STUDIO_PAGES: StudioPageMeta[] = [
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
    id: 'settings',
    label: 'Settings',
    kicker: 'Settings',
    title: 'Settings',
    purpose: 'Appearance, chart labels, live prefs, keys, editor intelligence, and theme.',
    group: 'primary',
    testId: 'axis-settings',
    titleId: 'axis-settings-title',
    closeTestId: 'axis-settings-close',
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
];

export const STUDIO_PAGE_BY_ID: Record<StudioPageId, StudioPageMeta> = Object.fromEntries(
  STUDIO_PAGES.map((p) => [p.id, p]),
) as Record<StudioPageId, StudioPageMeta>;

export function studioPageMeta(id: StudioPageId): StudioPageMeta {
  return STUDIO_PAGE_BY_ID[id];
}
