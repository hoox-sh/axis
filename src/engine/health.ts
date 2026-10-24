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
 * AXB1-Light WS engine health probe.
 *
 * Checks the backend health and reports engine feature availability.
 * The AXB1-Light WS engine supports both stream and calculator profiles.
 *
 * @module engine/health
 */

import type { EngineProfileCaps } from './policy';

/** Backend health status returned from /health. */
export interface BackendHealth {
  /** whether the backend is up */
  status: 'ok' | 'error';
  /** featured capabilities */
  features: {
    /** script runner availability */
    scriptRunner: boolean;
    /** data session support */
    dataSession: boolean;
    /** live modes (WebSocket) */
    liveModes: boolean;
  };
  /** Engine profile advertised by the backend. */
  engine: EngineProfileCaps;
}

/**
 * Check if the AXB1-Light WS stream engine is available.
 *
 * The AXB1-Light WS engine is available when the backend responds with
 * a healthy status and advertises liveStream capability.
 */
export function isStreamEngineAvailable(health: BackendHealth): boolean {
  return health.status === 'ok' && health.features.liveModes === true;
}

/**
 * Check if the calculator profile is available.
 *
 * The calculator profile is always available as fallback when stream is not
 * advertised or enabled.
 */
export function isCalculatorEngineAvailable(health: BackendHealth): boolean {
  return health.status === 'ok';
}

/**
 * Get the engine profile for the AXB1-Light WS engine.
 *
 * Returns the capabilities based on backend health.
 */
export function getEngineProfile(health: BackendHealth): EngineProfileCaps {
  if (health.status !== 'ok') {
    return { calculator: true }; // fallback
  }
  if (health.features.liveModes === true) {
    return { liveStream: true };
  }
  return { calculator: true };
}
