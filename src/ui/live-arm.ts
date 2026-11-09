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
 * Live-chip snapshot from the store + engine wire.
 * HUD / Topbar / mobile share this so the word matches script cards.
 *
 * @module ui/live-arm
 */

import { store } from '../store';
import { streamRouteActive, streamWireState } from '../streams/stream-live';
import { worstFeedStatus, type LiveArmInput } from './hud-model';

/** Assemble {@link LiveArmInput} from live chrome (reactive when called in Solid). */
export function readLiveArm(now: number = Date.now()): LiveArmInput {
  const feeds = Object.values(store.live?.feeds || {});
  const scripts = Object.values(store.live?.scriptStatus || {});
  let wireOpen: boolean | null = null;
  try {
    const st = streamWireState();
    if (st) wireOpen = st.open;
  } catch {
    wireOpen = null;
  }
  let route = false;
  try {
    route = streamRouteActive();
  } catch {
    route = false;
  }
  return {
    liveActive: !!store.live?.active,
    streamStatus: store.stream?.status || 'disconnected',
    streamState: store.telemetry?.stream?.state,
    transport: store.telemetry?.stream?.transport,
    wireOpen,
    streamRouteActive: route,
    feedStatus: worstFeedStatus([
      ...feeds.map((f) => f.status),
      ...scripts.map((s) => s.status),
    ]),
    lastEventAt: store.telemetry?.stream?.lastEventAt,
    detail: store.telemetry?.stream?.detail,
    now,
  };
}
