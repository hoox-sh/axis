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
 * Feature flag for the engine-owned data plane (F-09).
 *
 * The new stream engine is strictly opt-in: unless this flag is on, every
 * evaluation takes the legacy `serverEngine` path byte-for-byte. The flag is
 * a runtime localStorage toggle (`axis.engine.stream.enabled === '1'`) so a
 * build can carry both paths during the rollout; flipping it needs no rebuild.
 *
 * @module engine/feature-flag
 */

import { createFlagPair } from '../utils/flags';

const FLAG_KEY = 'axis.engine.stream.enabled';
const DISABLE_KEY = 'axis.engine.stream.disabled';

const streamFlag = createFlagPair({ enabledKey: FLAG_KEY, disabledKey: DISABLE_KEY });

/** True when the new stream engine path is enabled for this tab. */
export function isStreamEngineEnabled(): boolean {
  return streamFlag.isEnabled();
}

/** Enable or disable the stream engine path for this tab. */
export function setStreamEngineEnabled(on: boolean): void {
  streamFlag.setEnabled(on);
}

/**
 * True when the stream path is explicitly opted out for this tab.
 * Opt-out wins over everything (kill switch).
 */
export function isStreamEngineDisabled(): boolean {
  return streamFlag.isDisabled();
}

export const STREAM_ENGINE_FLAG_KEY = FLAG_KEY;
