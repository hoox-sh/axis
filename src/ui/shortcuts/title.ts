// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Prose control titles plus the registry display chord.
 *
 * Chords come only from {@link getDisplay}. An empty display (unknown id or
 * a cleared override) leaves the label unchanged, and a label that already
 * contains the display string is not appended again.
 */

import type { Platform } from './keys';
import { getDisplay } from './registry';
import type { ShortcutId, ShortcutOverrides } from './types';

export function shortcutTitle(
  label: string,
  id: ShortcutId,
  overrides: ShortcutOverrides = {},
  platform?: Platform,
): string {
  const display = getDisplay(id, overrides, platform);
  if (display === '') return label;
  if (label.includes(display)) return label;
  return `${label} · ${display}`;
}
