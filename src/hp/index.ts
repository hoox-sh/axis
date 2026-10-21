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
 * High-performance chart engine (HP PR 1–4).
 *
 * Codec, execution context, isolation headers, capability probe, ingest
 * worker, hot double-buffer memory, worker-safe Atomics, rAF generation
 * poll, and the LWC copy-out.
 *
 * @module hp
 */

export * from './axb1';
export * from './calc/execution-context';
export * from './isolation-headers';
export * from './feature-flag';
export * from './capabilities';
export * from './memory/layout';
export * from './memory/control-block';
export * from './memory/hot-buffer';
export * from './sync/atomics';
export * from './sync/is-main-thread';
export * from './sync/raf-poll';
export * from './paint/copy-out-lwc';
