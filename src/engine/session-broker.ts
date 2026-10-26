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
 * SCAFFOLD — NOT PRODUCTION.
 * In-memory broker for Redesign2 series sessions.
 *
 * This scaffold models open/create/full/delta/cache-miss behavior without
 * wiring it into the live evaluation pipeline. It is intended to be replaced
 * or backed by the real PYNE broker during Phase 3.
 *
 * WARNING: Do not use this broker in production; session isolation and
 * persistence depend on a real PYNE broker (see Phase 3 integration).
 *
 * @module engine/session-broker
 */

import type { MarketIdentity } from './market-identity';

export interface Redesign2Session {
  id: string;
  identity: MarketIdentity;
  cursor: number;
  fullSent: boolean;
}

export class Redesign2SessionBroker {
  private readonly sessions = new Map<string, Redesign2Session>();
  private nextId = 1;

  open(identity: MarketIdentity, existingId?: string): Redesign2Session {
    console.warn('[session-broker] SCAFFOLD USED — replace with real PYNE broker (Phase 3)');
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && sameIdentity(existing.identity, identity)) {
        return existing;
      }
    }
    const id = `rs_${this.nextId++}`;
    const session = { id, identity, cursor: 0, fullSent: false };
    this.sessions.set(id, session);
    return session;
  }

  markFullSent(sessionId: string): void {
    const session = this.require(sessionId);
    session.fullSent = true;
  }

  advanceCursor(sessionId: string, cursor: number): void {
    const session = this.require(sessionId);
    if (cursor < session.cursor) throw new Error('cursor moved backwards');
    session.cursor = cursor;
  }

  requiresFull(sessionId: string): boolean {
    return !this.require(sessionId).fullSent;
  }

  get(sessionId: string): Redesign2Session | undefined {
    return this.sessions.get(sessionId);
  }

  private require(sessionId: string): Redesign2Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }
}

function sameIdentity(a: MarketIdentity, b: MarketIdentity): boolean {
  return (
    a.exchange === b.exchange &&
    a.market === b.market &&
    a.symbol === b.symbol &&
    a.interval === b.interval
  );
}
