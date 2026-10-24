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
 * Thin engine policy.
 *
 * Default levers for the thin engine plane. Supports two profiles:
 * thin-stream (multiplexed WSS delta envelopes) and calculator
 * (legacy JSON fallback).
 *
 * @module engine/policy
 */

/** Engine profile identifier. */
export type EngineProfile = 'thin-stream' | 'calculator';

/** Engine profile capabilities. */
export interface EngineProfileCaps {
  /** Thin delta envelope stream available. */
  stream?: boolean;
}

/**
 * Choose the engine profile from declared capabilities.
 *
 * Priority: thin-stream (delta envelopes) > calculator (legacy JSON path).
 */
export function profileForCapabilities(caps: EngineProfileCaps | null | undefined): EngineProfile {
  if (caps?.stream === true) return 'thin-stream';
  return 'calculator';
}

/** Default policy levers for the thin engine. */
export const THIN_DEFAULT_LEVERS = [
  'historyBars',
  'rollingWindowBars',
  'engine',
  'endpoint',
  'health features (data_session, live_modes, websocket)',
] as const;
