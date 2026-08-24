// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio kit — full-page overlay primitives for Runtime, Wire, Settings.
 *
 * @module ui/studio
 */

export type { StudioPageId, SettingsTabId, AppPageProps } from './types';
export { isStudioPageId, isSettingsTabId } from './types';
export { STUDIO_PAGES, STUDIO_PAGE_BY_ID, studioPageMeta } from './pages';
export type { StudioPageMeta } from './pages';
export { AppPage } from './AppPage';
export { AppPageHeader } from './AppPageHeader';
export { StudioButton } from './StudioButton';
export type { StudioButtonVariant } from './StudioButton';
export {
  StudioField,
  StudioInput,
  StudioSelect,
  StudioToggle,
  StudioHint,
} from './StudioField';
export { StudioSection } from './StudioSection';
export {
  StudioCard,
  StudioStat,
  StudioChip,
  StudioStatus,
  StudioEmpty,
  StudioCode,
  StudioList,
  StudioRow,
  studioHealthLabel,
} from './StudioDisplay';
export type { StudioHealth } from './StudioDisplay';
export { StudioTabs } from './StudioTabs';
export { StudioFooter } from './StudioFooter';
