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
 * Push the persisted price-scale / last-value label preferences onto the chart.
 *
 * The three toggles (`priceScaleLabelsVisible`, `lastValueLabelsVisible`,
 * `lastValueNamesVisible`) live in the store, but Lightweight Charts only sees
 * them through `PaneManager` setters. Before this module each surface applied
 * them itself and only at mount:
 *
 * - `ChartHost` applied them when panes were (re)created,
 * - `ChartScaleControls` applied them in `onMount`,
 * - `ChartSettingsPanel` and the scale buttons applied them live.
 *
 * Settings → General → Chart labels wrote the store and nothing else, so the
 * chart kept the old gutter until a pane was rebuilt. One function, called from
 * every surface, removes that asymmetry.
 *
 * @module chart/label-prefs
 */

import { store } from '../store';
import { getManager } from './manager-access';
import type { PaneManager } from './pane-manager';

/**
 * Apply the stored label preferences to the live chart.
 *
 * Safe to call when no chart exists (boot, headless tests) and when a setter
 * throws on a disposed chart — label prefs are never worth an error path.
 */
export function applyLabelPrefsToChart(
  manager: PaneManager | null | undefined = getManager(),
): void {
  if (!manager) return;
  try {
    manager.setPriceScaleLabelsVisible(store.priceScaleLabelsVisible !== false);
    manager.setLastValueLabelsVisible(store.lastValueLabelsVisible !== false);
    manager.setLastValueNamesVisible(store.lastValueNamesVisible !== false);
  } catch {
    /* label prefs optional */
  }
}
