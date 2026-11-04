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
 * Source plugin ids that are read at **module scope** by other modules.
 *
 * This is a leaf module on purpose: it imports nothing. `expand-cache` builds
 * its `OFFLINE_SOURCES` set while it evaluates, and `data-manager-source`
 * imports `expand-cache` (transitively). Reading the id from
 * `data-manager-source` there produced a temporal-dead-zone crash whenever
 * `data-manager-source` was the first module evaluated:
 *
 * ```
 * ReferenceError: Cannot access 'DATA_MANAGER_SOURCE_ID' before initialization
 * ```
 *
 * Keep module-scope constants here; keep behaviour (selection, resolution) in
 * `data/data-manager-source`.
 *
 * @module data/source-ids
 */

/** Source plugin id registered in the sources catalog (`data-manager`). */
export const DATA_MANAGER_SOURCE_ID = 'data-manager';
