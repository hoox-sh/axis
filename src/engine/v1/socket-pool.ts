/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Tab socket cap (concept §4.1).
 *
 * One live client per fingerprint (endpoint + token). A second client
 * opens only for a different fingerprint. A third waits until a slot
 * is released. The same fingerprint never opens a second socket.
 *
 * @module engine/v1/socket-pool
 */

/** Live sockets this tab may hold at once. */
export const TAB_SOCKET_CAP = 2;

export function socketFingerprint(endpoint: string, token = ''): string {
  return `${endpoint}\0${token}`;
}

export type SocketPoolLive<T> = {
  status: 'live';
  value: T;
  fingerprint: string;
};

export type SocketPoolQueued<T> = {
  status: 'queued';
  fingerprint: string;
  wait: Promise<T>;
};

export type SocketPoolAcquire<T> = SocketPoolLive<T> | SocketPoolQueued<T>;

type Slot<T> = { value: T; refs: number };

type Pending<T> = {
  fingerprint: string;
  create: () => T;
  wait: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  waiters: number;
};

export class SocketPool<T> {
  readonly cap: number;
  private readonly live = new Map<string, Slot<T>>();
  private readonly pending = new Map<string, Pending<T>>();

  constructor(cap = TAB_SOCKET_CAP) {
    this.cap = cap;
  }

  get(fingerprint: string): T | undefined {
    return this.live.get(fingerprint)?.value;
  }

  size(): number {
    return this.live.size;
  }

  queued(): number {
    return this.pending.size;
  }

  acquire(fingerprint: string, create: () => T): SocketPoolAcquire<T> {
    const slot = this.live.get(fingerprint);
    if (slot) {
      slot.refs += 1;
      return { status: 'live', value: slot.value, fingerprint };
    }
    const queued = this.pending.get(fingerprint);
    if (queued) {
      queued.waiters += 1;
      return { status: 'queued', fingerprint, wait: queued.wait };
    }
    if (this.live.size < this.cap) {
      const value = create();
      this.live.set(fingerprint, { value, refs: 1 });
      return { status: 'live', value, fingerprint };
    }
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const wait = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.pending.set(fingerprint, {
      fingerprint,
      create,
      wait,
      resolve,
      reject,
      waiters: 1,
    });
    return { status: 'queued', fingerprint, wait };
  }

  /**
   * Drop one holder. When the last ref is gone the socket leaves the
   * pool and the next waiter is created. The caller disconnects `T`.
   */
  release(fingerprint: string): T | undefined {
    const slot = this.live.get(fingerprint);
    if (!slot) {
      const queued = this.pending.get(fingerprint);
      if (queued) {
        this.pending.delete(fingerprint);
        queued.reject(new Error('socket-pool-released'));
      }
      return undefined;
    }
    slot.refs -= 1;
    if (slot.refs > 0) return undefined;
    this.live.delete(fingerprint);
    this.promote();
    return slot.value;
  }

  /** Remove every live socket and reject waiters. */
  drain(): T[] {
    const values = [...this.live.values()].map((s) => s.value);
    this.live.clear();
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiters) w.reject(new Error('socket-pool-reset'));
    return values;
  }

  private promote(): void {
    if (this.live.size >= this.cap) return;
    const next = this.pending.values().next().value as Pending<T> | undefined;
    if (!next) return;
    this.pending.delete(next.fingerprint);
    const existing = this.live.get(next.fingerprint);
    if (existing) {
      existing.refs += next.waiters;
      next.resolve(existing.value);
      this.promote();
      return;
    }
    try {
      const value = next.create();
      this.live.set(next.fingerprint, { value, refs: next.waiters });
      next.resolve(value);
    } catch (err) {
      next.reject(err);
    }
    this.promote();
  }
}
