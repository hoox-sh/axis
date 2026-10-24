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
 * Thin engine apply-bridge module.
 *
 * Placeholder module for apply-bridge functionality used by stream-live.ts.
 * The thin engine uses binary delta frames over WebSocket.
 */

export function applyStreamPayload(): void {
  // No-op — thin uses binary delta frames directly
}

/** @deprecated Use thin delta frame path instead */
export const StreamVia = 'ws';

/** @deprecated Use thin delta frame path instead */
export function streamFullToPrecomputed(): void {
  // No-op for WS profile
}
