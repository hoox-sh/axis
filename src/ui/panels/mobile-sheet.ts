// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Active mobile sheet state — which panel fills the viewport on phones.
 *
 * On phones {@link FloatableShell} panels render as full-screen sheets; only
 * the *active* sheet is visible (one panel at a time). This is ephemeral UI
 * state — it never touches the persisted `store.panelChrome` desktop
 * geometry, so rotating/resizing between phone and desktop never clobbers
 * the user's docked layout.
 *
 * @module ui/panels/mobile-sheet
 */

import { createSignal } from 'solid-js';
import type { PanelId } from './types';

const [activeSheetId, setActiveSheetId] = createSignal<PanelId | null>(null);

/** Panel currently shown as the mobile sheet (null = chart focused). */
export const activeMobileSheet = activeSheetId;

/** Show `id` as the active mobile sheet. */
export function openMobileSheet(id: PanelId): void {
  setActiveSheetId(id);
}

/** Clear the active sheet if it is `id` (panel closed). */
export function closeMobileSheet(id: PanelId): void {
  if (activeSheetId() === id) setActiveSheetId(null);
}

/** Back to chart — hide any active sheet. */
export function closeAllMobileSheets(): void {
  setActiveSheetId(null);
}
