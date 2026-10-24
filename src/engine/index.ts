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
 * AXB1-HP engine module barrel.
 *
 * High-performance engine adapter: SAB double-buffer, off-thread workers
 * (ingest/calc/render), AXB1 binary delta protocol, viewport paging,
 * bar-state parity, GPU fallbacks (HP-0..HP-4). Default off.
 *
 * @module engine
 */

export * from './policy';
export * from './router';
export * from './sessions';
export * from './axb1-client';
export * from './runner';
export * from './health';
export * from './feature-flag';
export * from './live-wire';
export * from './ws-client';
export * from './wire-bookkeeping';
export * from './frames';
export * from './apply-bridge';
export * from './bar-close-verify';
export * from './market-identity';
