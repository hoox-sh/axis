// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio page identifiers and shared overlay props.
 *
 * Runtime / Wire / Settings are primary (topbar). Workers / Plugins are
 * sibling pages — opened from the rail, command palette, or Runtime cards.
 * They are not tabs inside Runtime.
 *
 * @module ui/studio/types
 */

export type StudioPageId = 'runtime' | 'wire' | 'settings' | 'workers' | 'plugins';

export type SettingsTabId = 'general' | 'data' | 'editor' | 'theme';

export function isStudioPageId(v: unknown): v is StudioPageId {
  return (
    v === 'runtime' ||
    v === 'wire' ||
    v === 'settings' ||
    v === 'workers' ||
    v === 'plugins'
  );
}

export function isSettingsTabId(v: unknown): v is SettingsTabId {
  return v === 'general' || v === 'data' || v === 'editor' || v === 'theme';
}

export type AppPageProps = {
  open: boolean;
  page: StudioPageId;
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
  settingsTab?: SettingsTabId;
};
