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
 * Session multiplexer for Redesign2.
 *
 * Keeps session handlers isolated by session id so concurrent sessions do not
 * leak frames into one another. The websocket client routes through this.
 *
 * @module engine/session-multiplexer
 */

export type Redesign2SessionHandler = (payload: unknown) => void;

export class Redesign2SessionMultiplexer {
  private readonly handlers = new Map<string, Redesign2SessionHandler>();

  register(sessionId: string, handler: Redesign2SessionHandler): void {
    if (this.handlers.has(sessionId)) {
      throw new Error(`Session already registered: ${sessionId}`);
    }
    this.handlers.set(sessionId, handler);
  }

  unregister(sessionId: string): void {
    this.handlers.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.handlers.has(sessionId);
  }

  dispatch(sessionId: string, payload: unknown): boolean {
    const handler = this.handlers.get(sessionId);
    if (!handler) return false;
    handler(payload);
    return true;
  }

  clear(): void {
    this.handlers.clear();
  }

  get size(): number {
    return this.handlers.size;
  }
}