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
 * UI density presets for Settings (maps to store.uiScale).
 */

export const UI_SCALE_PRESETS: { label: string; value: number; hint: string }[] = [
  { label: 'Compact', value: 0.85, hint: 'Denser chrome' },
  { label: 'Default', value: 1, hint: 'Balanced' },
  { label: 'Comfort', value: 1.1, hint: 'Roomier controls' },
  { label: 'Large', value: 1.2, hint: 'Larger type & hits' },
];

export function formatUiScalePct(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
