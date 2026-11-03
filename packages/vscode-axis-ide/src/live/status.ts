// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live StatusBar helpers — `live` / `degraded` / `off` only (no secrets).
 */

/** Compact HUD states for StatusBar (acceptance: live/degraded/off). */
export type LiveHudState = 'live' | 'degraded' | 'off';

export type LiveStatusLabel = {
  /** Compact StatusBar text. */
  text: string;
  /** Tooltip without key material. */
  tooltip: string;
};

/** Wire status strings from StreamLiveWire-compat frames. */
export type LiveWireStatus =
  | 'datafeed-loading'
  | 'calculating'
  | 'live'
  | 'error'
  | 'idle'
  | string;

export type LiveHudInput = {
  /** `axis.live.enabled` — when false, always off. */
  enabled: boolean;
  /** Socket open and authenticated path ready. */
  connected: boolean;
  /** Minting / connecting / reconnecting. */
  connecting?: boolean;
  /** Last hard error (mint fail, WS error). */
  errored?: boolean;
  /** Last `status` frame from the wire (optional). */
  wireStatus?: LiveWireStatus | null;
};

/**
 * Map bridge + wire state → StatusBar HUD.
 * - off: disabled, stopped, or never started
 * - degraded: connecting, loading, calculating, or errored while wanting live
 * - live: connected and wire reports live (or connected with no wire status yet)
 */
export function resolveLiveHud(input: LiveHudInput): LiveHudState {
  try {
    if (!input.enabled) return 'off';
    if (input.connecting) return 'degraded';
    if (input.errored && !input.connected) return 'degraded';
    if (!input.connected) return 'off';
    const wire = String(input.wireStatus || '')
      .trim()
      .toLowerCase();
    if (!wire || wire === 'live') return 'live';
    if (
      wire === 'datafeed-loading' ||
      wire === 'calculating' ||
      wire === 'error' ||
      wire === 'idle'
    ) {
      return 'degraded';
    }
    // Unknown wire status while connected — treat as live (socket up).
    return 'live';
  } catch {
    return 'off';
  }
}

/** Pure StatusBar label helper — unit-tested; never embeds secrets. */
export function formatLiveStatus(state: LiveHudState): LiveStatusLabel {
  switch (state) {
    case 'live':
      return {
        text: '$(radio-tower) AXIS Live',
        tooltip: 'AXIS live stream connected',
      };
    case 'degraded':
      return {
        text: '$(warning) AXIS Live…',
        tooltip: 'AXIS live stream connecting or degraded',
      };
    case 'off':
    default:
      return {
        text: '$(circle-slash) AXIS Live off',
        tooltip: 'AXIS live stream off',
      };
  }
}
