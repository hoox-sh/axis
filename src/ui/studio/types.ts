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

/** Ids of the full-screen studio pages reachable from the topbar Studio rail. */
export type StudioPageId =
  'runtime' | 'wire' | 'settings' | 'data' | 'workers' | 'plugins' | 'debug';

/** Tab ids inside the Settings page; drives `initialTab` and deep links. */
export type SettingsTabId =
  'general' | 'data' | 'editor' | 'theme' | 'topbar' | 'keyboard' | 'notifications';

/**
 * Narrow an untrusted value (URL hash, persisted state) to {@link StudioPageId}.
 *
 * @param v - Candidate page id.
 * @returns `true` when `v` is one of the known studio page ids.
 */
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

/**
 * Narrow an untrusted value to a Settings tab id so a stale or hand-edited tab
 * cannot leave the Settings page blank.
 *
 * @param v - Candidate tab id.
 * @returns `true` when `v` is one of the known Settings tabs.
 */
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

/** Props the app shell passes to every studio page wrapper (navigation + close). */
export type AppPageProps = {
  open: boolean;
  page: StudioPageId;
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
  settingsTab?: SettingsTabId;
};
