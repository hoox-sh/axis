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
 * AXB1-HP engine policy.
 *
 * Default levers for the high-performance engine plane. Supports three
 * profiles: hp-sab (SharedArrayBuffer hot ring, cross-origin isolated),
 * hp-zero-sab (AXB1 WS without SAB, no COOP/COEP), and calculator
 * (legacy JSON fallback).
 *
 * @module engine/policy
 */

/** Engine profile identifier. */
export type EngineProfile = 'hp-sab' | 'hp-zero-sab' | 'calculator';

/** Engine profile capabilities. */
export interface EngineProfileCaps {
  /** SAB hot ring available (cross-origin isolated). */
  sab?: boolean;
  /** GPU painter available (WebGL2 / WebGPU). */
  gpu?: boolean;
  /** AXB1 WS stream available. */
  stream?: boolean;
}

/**
 * Choose the engine profile from declared capabilities.
 *
 * Priority: hp-sab (SAB + GPU) > hp-zero-sab (AXB1 WS, no SAB) >
 * calculator (legacy JSON path). Falls back to calculator when nothing
 * is available — the chart never strands without data.
 */
export function profileForCapabilities(caps: EngineProfileCaps | null | undefined): EngineProfile {
  if (caps?.sab === true) return 'hp-sab';
  if (caps?.stream === true) return 'hp-zero-sab';
  return 'calculator';
}

/** Default policy levers for the AXB1-HP engine. */
export const AXB1_HP_DEFAULT_LEVERS = [
  'historyBars',
  'rollingWindowBars',
  'engine',
  'datasetPersistence',
  'endpoint',
  'health features (data_session, live_modes, websocket, sab, gpu)',
] as const;

/** Rung selection thresholds. */
export const HP_RUNG_THRESHOLDS = {
  /** Minimum bars for SAB hot ring allocation. */
  MIN_SAB_BARS: 500,
  /** Minimum bars for GPU painter. */
  MIN_GPU_BARS: 1000,
} as const;
