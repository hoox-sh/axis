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
 * Engine routing for AXB1-HP.
 *
 * Decides per evaluation whether the HP engine path may run. Both gates must
 * pass: the local feature flag AND a capability profile. Anything else — flag
 * off, unresolved capabilities, no stream — takes the legacy path untouched.
 *
 * This module only *decides*; it never evaluates.
 *
 * @module engine/router
 */

import { isHpEngineDisabled } from './feature-flag';
import { profileForCapabilities, type EngineProfileCaps } from './policy';

export interface RouteDecision {
  useStream: boolean;
  reason: 'flag-off' | 'calculator' | 'hp-sab' | 'hp-zero-sab';
}

/**
 * Route an evaluation: the HP engine path is the default when the engine
 * advertises AXB1 WS stream capability. The local tab can only opt OUT
 * (`axis.engine.hp.disabled`) — there is no opt-in. Anything else takes the
 * legacy path untouched.
 */
export function routeEngineRun(caps: EngineProfileCaps | null | undefined): RouteDecision {
  if (isHpEngineDisabled()) return { useStream: false, reason: 'flag-off' };
  const profile = profileForCapabilities(caps);
  if (profile === 'calculator') return { useStream: false, reason: 'calculator' };
  return { useStream: true, reason: profile };
}
