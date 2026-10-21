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
 * Cached-datasets modal visibility.
 *
 * The modal is reachable from the Topbar, the StatusBar and the Data Source
 * Manager panel. Each of them used to own its own `datasetsOpen` signal, so
 * the three copies could drift: opening it from one surface left the others
 * showing their own closed state.
 *
 * One module-scope signal, like {@link module:ui/panels/mobile-sheet}.
 *
 * @module ui/datasets-open
 */

import { createSignal } from 'solid-js';

const [datasetsOpen, setDatasetsOpen] = createSignal(false);

/** Whether the cached-datasets modal is open. */
export const cachedDatasetsOpen = datasetsOpen;

/** Open the cached-datasets modal. */
export function openCachedDatasets(): void {
  setDatasetsOpen(true);
}

/** Close the cached-datasets modal. */
export function closeCachedDatasets(): void {
  setDatasetsOpen(false);
}
