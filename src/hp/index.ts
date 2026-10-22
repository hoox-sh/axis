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
 * High-performance chart engine (HP PR 1–8).
 *
 * Codec, execution context, isolation headers, capability probe, ingest
 * worker, hot double-buffer memory, worker-safe Atomics, rAF generation
 * poll, the LWC copy-out, viewport paging over a columnar cold store, and
 * the calc scratch-vs-commit state machine with its bar-state contexts
 * (§10.1–§10.2: tips evaluate on scratch, only closed bars commit).
 *
 * The GPU paint plane (PR 8): `paint/visual-attr` stages visible candles as
 * 32-byte NDC records, `render/*` selects and drives a painter — WebGL2
 * instanced quads today, WebGPU later, LWC when neither exists.
 *
 * @module hp
 */

export * from './axb1';
export * from './calc/barstate';
export * from './calc/execution-context';
export * from './isolation-headers';
export * from './feature-flag';
export * from './capabilities';
export * from './memory/layout';
export * from './memory/control-block';
export * from './memory/hot-buffer';
export * from './memory/cold-store';
export * from './memory/page-buffer';
export * from './sync/atomics';
export * from './sync/is-main-thread';
export * from './sync/raf-poll';
export * from './paint/copy-out-lwc';
export * from './paint/visual-attr';
export * from './render/types';
export * from './render/select-renderer';
export * from './render/webgl2-renderer';
export * from './workers/calc-core';
