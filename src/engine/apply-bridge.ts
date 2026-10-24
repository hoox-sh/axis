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
 * AXB1-HP engine apply-bridge module.
 *
 * Placeholder module for apply-bridge functionality used by stream-live.ts.
 * The AXB1-HP engine uses binary frames over WebSocket.
 */

export function applyStreamPayload(): void {
  // No-op — AXB1-HP uses binary frames directly
}

/** @deprecated Use AXB1-HP binary frame path instead */
export const StreamVia = 'ws';

/** @deprecated Use AXB1-HP binary frame path instead */
export function streamFullToPrecomputed(): void {
  // No-op for WS profile
}
