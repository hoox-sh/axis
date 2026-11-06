// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Script Settings modal preferences — which Pine `group=` sections the user
 * collapsed.
 *
 * A small string list in `localStorage` (group names are arbitrary); read
 * helpers never throw (unavailable storage → empty list), so SSR / private
 * mode boots stay quiet. Shared across indicators — a collapsed section stays
 * collapsed for the next script that declares the same group.
 *
 * @module ui/script-settings/prefs
 */

import { getJson, setJson } from '../../utils/storage';

/** Collapsed Pine `group=` names. */
export const SCRIPT_SETTINGS_COLLAPSED_KEY = 'axis.settings.collapsed';

const MAX_IDS = 64;
const MAX_ID_LEN = 128;

function sanitize(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.slice(0, MAX_ID_LEN);
    if (!id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

/** Collapsed Pine `group=` ids read from localStorage; empty when unavailable. */
export function readCollapsedGroups(): string[] {
  const raw = getJson<unknown>(SCRIPT_SETTINGS_COLLAPSED_KEY);
  return Array.isArray(raw) ? sanitize(raw) : [];
}

/** Persist collapsed group ids; returns the list that was written. */
export function writeCollapsedGroups(ids: readonly string[]): string[] {
  const next = sanitize(ids);
  setJson(SCRIPT_SETTINGS_COLLAPSED_KEY, next);
  return next;
}

/** Flip one group and persist. Returns the next collapsed list. */
export function toggleCollapsedGroup(id: string, current?: readonly string[]): string[] {
  const base = current ? [...current] : readCollapsedGroups();
  const at = base.indexOf(id);
  if (at >= 0) base.splice(at, 1);
  else base.push(id);
  return writeCollapsedGroups(base);
}
