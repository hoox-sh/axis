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
 * AXB1-HP engine health probe.
 *
 * Checks the backend health and reports engine feature availability.
 * The AXB1-HP engine supports hp-sab, hp-zero-sab, and calculator
 * profiles.
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
    /** SharedArrayBuffer support */
    sab: boolean;
    /** GPU painter available */
    gpu: boolean;
  };
  /** Engine profile advertised by the backend. */
  engine: EngineProfileCaps;
}

/**
 * Check if the HP-SAB engine is available.
 */
export function isHpSabEngineAvailable(health: BackendHealth): boolean {
  return health.status === 'ok' && health.features.sab === true;
}

/**
 * Check if the HP zero-SAB engine is available.
 * Works without COOP/COEP headers (standard PWA, mobile Safari, embedded).
 */
export function isHpZeroSabEngineAvailable(health: BackendHealth): boolean {
  return health.status === 'ok' && health.features.liveModes === true;
}

/**
 * Check if the calculator profile is available.
 */
export function isCalculatorEngineAvailable(health: BackendHealth): boolean {
  return health.status === 'ok';
}

/**
 * Get the engine profile for the AXB1-HP engine.
 */
export function getEngineProfile(health: BackendHealth): EngineProfileCaps {
  if (health.status !== 'ok') {
    return {};
  }
  const caps: EngineProfileCaps = {};
  if (health.features.sab === true) caps.sab = true;
  if (health.features.gpu === true) caps.gpu = true;
  if (health.features.liveModes === true) caps.stream = true;
  return caps;
}
