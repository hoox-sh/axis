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
 * Redesign2 data-plane policy.
 *
 * This module documents the default levers for the backend-owned, exchange-truth
 * data plane. It is intentionally inert in Phase 1: importing or reading these
 * values does not change runtime behavior. The purpose is to remove implicit
 * default decisions from scattered call sites before wiring Redesign2 transport.
 *
 * @module engines/data-plane-policy
 */

/** How the client may use a venue stream under Redesign2. */
export type ClientVenueStreamMode = 'disabled' | 'verification';

/** Documented default levers for the Redesign2 data plane. */
export interface DataPlanePolicy {
  /** Backend exchange feed is the canonical price source. */
  backendTruthDefault: true;
  /** Client venue streams are not eval input by default. */
  clientVenueStreamMode: ClientVenueStreamMode;
  /** Server-owned stream persists metadata only, not a competing dataset. */
  serverOwnedPersistence: 'metadata-only';
  /** Bar-close values are re-verified against backend truth. */
  barCloseVerification: 'enabled';
  /** New script sessions use a websocket connection when available. */
  webSocketPreferred: true;
  /** Full run/apply happens once per useful session. */
  fullRunOnce: true;
  /** Live updates are delta-only after the full result. */
  liveDeltaOnly: true;
}

/** Phase 1 default policy. No runtime code consumes this yet. */
export const DEFAULT_DATA_PLANE_POLICY: Readonly<DataPlanePolicy> = {
  backendTruthDefault: true,
  clientVenueStreamMode: 'verification',
  serverOwnedPersistence: 'metadata-only',
  barCloseVerification: 'enabled',
  webSocketPreferred: true,
  fullRunOnce: true,
  liveDeltaOnly: true,
};

/** How an engine participates in the data plane (final/plan.mdx §5). */
export type EngineProfile = 'stream' | 'calculator';

export interface EngineProfileCaps {
  liveStream?: boolean;
}

/**
 * Choose the engine profile from declared capabilities (F-08).
 *
 * Strictly opt-in: only `liveStream === true` (from `features.live_stream`)
 * selects `stream`. Anything else — including `null`/unresolved capabilities
 * while health is still loading — fails open to `calculator` (bars-in), so the
 * default flip can never strand the chart without data.
 */
export function profileForCapabilities(
  caps: EngineProfileCaps | null | undefined,
): EngineProfile {
  return caps?.liveStream === true ? 'stream' : 'calculator';
}

/**
 * Policy levers that can materially change picture/runtime behavior.
 * Keep this list synchronized with redesign2-plan.mdx.
 */
export const DATA_PLANE_DEFAULT_LEVERS = [
  'live.rerunOn',
  'rollingWindowBars',
  'historyBars',
  'autoload',
  'engine',
  'datasetPersistence',
  'endpoint',
  'health features (data_session, live_modes, websocket)',
] as const;