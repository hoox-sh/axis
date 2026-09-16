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
 * @module ui/shortcuts/palette-bridge
 *
 * Module-scoped command palette open state shared between the palette
 * component and the shortcut Hub. The Hub toggles it on `Mod-K` /
 * `Mod-Shift-P`; the palette renders from the same signal.
 */

import { createSignal } from 'solid-js';

export type PaletteIntent = 'commands' | 'builtins';

const [paletteOpen, setPaletteOpen] = createSignal(false);
const [paletteIntent, setPaletteIntent] = createSignal<PaletteIntent>('commands');

/** Reactive read of the palette open state (component render). */
export function isPaletteOpen(): boolean {
  return paletteOpen();
}

/** Why the palette opened — commands vs built-in script picker. */
export function getPaletteIntent(): PaletteIntent {
  return paletteIntent();
}

/** Open the command palette. */
export function openPalette(intent: PaletteIntent = 'commands'): void {
  setPaletteIntent(intent);
  setPaletteOpen(true);
}

/** Open the palette already on the built-in script picker. */
export function openBuiltinPicker(): void {
  openPalette('builtins');
}

/** Close the command palette. */
export function closePalette(): void {
  setPaletteOpen(false);
  setPaletteIntent('commands');
}

/** Toggle the command palette (Mod-K / Mod-Shift-P). */
export function togglePalette(): void {
  setPaletteIntent('commands');
  setPaletteOpen((v) => !v);
}