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
 * Thin engine wire-bookkeeping module.
 *
 * Pending requests for WS frame tracking, reconnect handlers, and wire stats.
 *
 * @module engine/wire-bookkeeping
 */

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class PendingRequests {
  private pending = new Map<string, PendingEntry>();

  async awaitFrame(id: string, timeoutMs = 10_000): Promise<unknown> {
    const entry = this.pending.get(id);
    if (entry) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(entry.resolve);
          this.pending.delete(id);
        }, timeoutMs);
      });
    }
    return Promise.resolve(null);
  }

  resolveFrame(id: string, frame: unknown): void {
    const entry = this.pending.get(id);
    if (entry) {
      entry.resolve(frame);
      this.pending.delete(id);
    }
  }

  dropAll(_err: Error): void {
    this.pending.clear();
  }
}

export class ReconnectHandlers {
  private handlers: Array<() => void> = [];

  add(fn: () => void): () => void {
    this.handlers.push(fn);
    return () => {
      const idx = this.handlers.indexOf(fn);
      if (idx > -1) this.handlers.splice(idx, 1);
    };
  }

  fire(): void {
    this.handlers.forEach((fn) => {
      fn();
    });
  }
}

export function wireStats(_opts: unknown): {
  open: boolean;
  openedOnce: boolean;
  reconnectAttempts: number;
  stopped: boolean;
} {
  return {
    open: false,
    openedOnce: false,
    reconnectAttempts: 0,
    stopped: false,
  };
}
