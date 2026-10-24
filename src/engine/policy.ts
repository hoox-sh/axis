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
 * AXB1-Light WS engine policy.
 *
 * This module documents the default levers for the AXB1-Light stream engine.
 * The engine can operate in two profiles: 'stream' (when live_stream is advertised)
 * and 'calculator' (default fallback).
 *
 * @module engine/policy
 */

/** Engine profile identifier. */
export type EngineProfile = 'stream' | 'calculator';

/** Engine profile capabilities for the stream profile. */
export interface EngineProfileCapsStream {
  /** Engine advertises live_stream capability. */
  liveStream: true;
}

/** Engine profile capabilities for the calculator profile. */
export interface EngineProfileCapsCalc {
  /** Calculator profile — no live stream. */
  calculator: true;
}

/**
 * Union of all engine profile capabilities.
 */
export type EngineProfileCaps = EngineProfileCapsStream | EngineProfileCapsCalc;

/**
 * Choose the engine profile from declared capabilities.
 *
 * If the engine advertises `live_stream === true`, select the `stream` profile.
 * Otherwise, fall back to `calculator` (bars-in / REST sessions).
 * This ensures the chart never strands without data — the fallback can never
 * strand the chart without data since calculator always resolves.
 */
export function profileForCapabilities(caps: EngineProfileCaps | null | undefined): EngineProfile {
  if (caps?.liveStream === true) return 'stream';
  return 'calculator';
}

/** Default policy levers for the AXB1-Light engine. */
export const AXB1_LIGHT_DEFAULT_LEVERS = [
  'historyBars',
  'engine',
  'datasetPersistence',
  'endpoint',
  'health features (data_session, live_modes, websocket)',
] as const;
