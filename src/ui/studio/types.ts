// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio page identifiers and shared overlay props.
 *
 * Runtime / Wire / Settings / Data are primary studio pages (topbar
 * **Studio**, then the overlay rail). Workers / Plugins are catalog pages on
 * the same rail, command palette, or Runtime cards. They are not tabs inside
 * Runtime.
 *
 * @module ui/studio/types
 */

export type StudioPageId =
  'runtime' | 'wire' | 'settings' | 'data' | 'workers' | 'plugins' | 'debug';

export type SettingsTabId =
  'general' | 'data' | 'editor' | 'theme' | 'topbar' | 'keyboard' | 'notifications';

export function isStudioPageId(v: unknown): v is StudioPageId {
  return (
    v === 'runtime' ||
    v === 'wire' ||
    v === 'settings' ||
    v === 'data' ||
    v === 'workers' ||
    v === 'plugins' ||
    v === 'debug'
  );
}

export function isSettingsTabId(v: unknown): v is SettingsTabId {
  return (
    v === 'general' ||
    v === 'data' ||
    v === 'editor' ||
    v === 'theme' ||
    v === 'topbar' ||
    v === 'keyboard' ||
    v === 'notifications'
  );
}

export type AppPageProps = {
  open: boolean;
  page: StudioPageId;
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
  settingsTab?: SettingsTabId;
};
