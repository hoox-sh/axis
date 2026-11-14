// Copyright (c) 2026 HOOX - AXIS - hoox-sh (jango_blockchained)
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
 * Feature flag for the engine-owned shared feed (shared-data-plane, P2).
 *
 * Opt-in rollout for the engine-owned shared feed: off by default, and while
 * it is off the legacy venue-fetch path is used, unchanged. The flag is a
 * runtime localStorage toggle (`axis.engine.feed.enabled === '1'`) so a
 * build can carry both paths during the rollout; flipping it needs no
 * rebuild. Set `axis.engine.feed.disabled = '1'` to force the legacy path
 * even when the opt-in key is set (kill switch wins).
 *
 * @module engine/feed-flag
 */

import { createFlagPair } from '../utils/flags';

const FLAG_KEY = 'axis.engine.feed.enabled';
const DISABLE_KEY = 'axis.engine.feed.disabled';

const feedFlag = createFlagPair({ enabledKey: FLAG_KEY, disabledKey: DISABLE_KEY });

/** True when the engine-owned feed path is enabled for this tab. */
export function isFeedEnabled(): boolean {
  return feedFlag.isEnabled();
}

/** Enable or disable the feed path for this tab. */
export function setFeedEnabled(on: boolean): void {
  feedFlag.setEnabled(on);
}

/**
 * True when the feed path is explicitly opted out for this tab.
 * Opt-out wins over everything (kill switch).
 */
export function isFeedDisabled(): boolean {
  return feedFlag.isDisabled();
}

/** localStorage key of the per-tab feed opt-in, exported for settings/debug tooling. */
export const FEED_FLAG_KEY = FLAG_KEY;
/** localStorage key of the per-tab feed kill switch. */
export const FEED_DISABLE_KEY = DISABLE_KEY;
