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
 * Engine routing for Thin engine.
 *
 * Decides per evaluation whether the thin stream path may run.
 *
 * @module engine/router
 */

import { isThinStreamDisabled } from './feature-flag';
import { profileForCapabilities, type EngineProfileCaps } from './policy';

export interface RouteDecision {
  useStream: boolean;
  reason: 'flag-off' | 'calculator' | 'thin-stream';
}

/**
 * Route an evaluation: the thin stream path is the default when the engine
 * advertises thin-stream capability. The local tab can only opt OUT
 * (`axis.engine.thin.disabled`).
 */
export function routeEngineRun(caps: EngineProfileCaps | null | undefined): RouteDecision {
  if (isThinStreamDisabled()) return { useStream: false, reason: 'flag-off' };
  if (profileForCapabilities(caps) !== 'thin-stream')
    return { useStream: false, reason: 'calculator' };
  return { useStream: true, reason: 'thin-stream' };
}
