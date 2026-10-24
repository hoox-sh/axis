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
 * Thin engine module barrel.
 *
 * Ultra-fast lightweight charting engine: TradingView LWC + PYNE backend,
 * PYNE Incremental State Machine ($S_{t-1}$ hot state, O(1) tip evaluation),
 * multiplexed WSS streaming packed binary Delta Envelopes (OHLCV + indicators
 * in one frame), SequenceID gap detection, LWC series.update() hot path.
 *
 * Uses its own Delta Envelope protocol (NOT AXB1).
 *
 * @module engine
 */

export * from './policy';
export * from './router';
export * from './sessions';
export * from './delta-client';
export * from './runner';
export * from './health';
export * from './feature-flag';
export * from './live-wire';
export * from './ws-client';
export * from './wire-bookkeeping';
export * from './delta-frames';
export * from './apply-bridge';
export * from './market-identity';
