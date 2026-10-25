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
 * Stream-vs-legacy routing (F-09).
 *
 * Decides per evaluation whether the new engine-owned stream path may run.
 * Both gates must pass: the local feature flag AND a `stream` capability
 * profile. Anything else — flag off, unresolved capabilities, calculator
 * engine — takes the legacy `serverEngine` path untouched.
 *
 * This module only *decides*; it never evaluates. No runtime wiring leaks
 * into the default path until the flag is on.
 *
 * @module engine/router
 */

import { isStreamEngineDisabled } from './feature-flag';
import { profileForCapabilities, type EngineProfileCaps } from './policy';

export interface RouteDecision {
  useStream: boolean;
  reason: 'flag-off' | 'calculator' | 'stream';
}

/**
 * Route an evaluation (F-19 flip): the stream path is the default when the
 * engine advertises `live_stream`. The local tab can only opt OUT
 * (`axis.engine.stream.disabled`) — there is no opt-in anymore. Anything
 * else takes the legacy `serverEngine` path untouched.
 */
export function routeEngineRun(caps: EngineProfileCaps | null | undefined): RouteDecision {
  if (isStreamEngineDisabled()) return { useStream: false, reason: 'flag-off' };
  if (profileForCapabilities(caps) !== 'stream') return { useStream: false, reason: 'calculator' };
  return { useStream: true, reason: 'stream' };
}
