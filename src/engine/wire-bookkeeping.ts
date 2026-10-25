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
 * Shared connection bookkeeping for the live wire clients.
 *
 * `Redesign2WsClient` (direct WebSocket) and `IngestHostClient` (HP ingest
 * worker) are different transports over the same lifecycle: request/response
 * waiters keyed by frame id, resubscribe handlers fired on reconnect, and a
 * diagnostic stats snapshot for MCP `stream.get`. This module owns that layer
 * so a fix to waiter cleanup or teardown semantics lands in both clients.
 *
 * The wire must be **discarded, not just disconnected**: a superseded socket's
 * late events must never reach the client, and a failing resubscribe must
 * never break the socket — both invariants live here, not in comments.
 *
 * @module engine/wire-bookkeeping
 */

/** Connection counters for MCP `stream.get` — never the auth token. */
export interface WireStats {
  open: boolean;
  openedOnce: boolean;
  reconnectAttempts: number;
  stopped: boolean;
}

/** Snapshot the counters into a fresh object (callers pass their fields). */
export function wireStats(s: WireStats): WireStats {
  return {
    open: s.open,
    openedOnce: s.openedOnce,
    reconnectAttempts: s.reconnectAttempts,
    stopped: s.stopped,
  };
}

/**
 * Request/response waiters keyed by frame id.
 *
 * `awaitFrame` rejects on timeout; `dropAll` rejects every waiter (socket
 * close / disconnect) so a dead connection cannot leak waiters or timers.
 */
export class PendingRequests<TFrame> {
  private readonly waiters = new Map<
    string,
    {
      resolve: (frame: TFrame) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  get size(): number {
    return this.waiters.size;
  }

  /**
   * Await the next inbound frame carrying `id`. The waiter also resolves
   * through the normal `onFrame` dispatch (see `resolveFrame`).
   */
  awaitFrame(id: string, timeoutMs = 10_000): Promise<TFrame> {
    return new Promise<TFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`Redesign2 frame wait timed out for id: ${id}`));
      }, timeoutMs);
      this.waiters.set(id, {
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  /**
   * Resolve (and remove) the waiter for `id`. Returns true when a waiter
   * existed — the caller still dispatches the frame through `onFrame`.
   */
  resolveFrame(id: string, frame: TFrame): boolean {
    const waiter = this.waiters.get(id);
    if (!waiter) return false;
    this.waiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(frame);
    return true;
  }

  /** Reject every waiter (socket closed / client stopped). Never throws. */
  dropAll(err: Error): void {
    for (const [id, waiter] of this.waiters) {
      this.waiters.delete(id);
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }
}

/**
 * Resubscribe handlers fired on every successful (re)connect.
 *
 * The caller re-issues `subscribe`/`resume` here. A failing handler must not
 * break the socket, so faults are swallowed per-listener. Iteration runs over
 * a snapshot so a handler that subscribes/unsubscribes mid-fire cannot skip
 * or double-fire its peers.
 */
export class ReconnectHandlers {
  private readonly handlers = new Set<() => void>();

  /** Register a handler. Returns an unsubscribe function. */
  add(fn: () => void): () => void {
    this.handlers.add(fn);
    return () => {
      this.handlers.delete(fn);
    };
  }

  /** Fire every handler; a throwing handler never reaches its peers. */
  fire(): void {
    for (const fn of [...this.handlers]) {
      try {
        fn();
      } catch {
        /* a failing resubscribe must not break the socket */
      }
    }
  }

  get size(): number {
    return this.handlers.size;
  }
}
