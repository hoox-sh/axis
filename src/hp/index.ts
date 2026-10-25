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
 * What remains of the old HP tree: the AXB1 codec and the Pine execution
 * context. The shared-memory ring and the GPU candle overlay are gone.
 * Lightweight Charts paints the chart. The ingest worker still decodes
 * `/ws/live`.
 *
 * @module hp
 */

export * from './axb1';
export * from './calc/execution-context';
export * from './isolation-headers';
