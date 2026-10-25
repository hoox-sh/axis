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
 * Optional `holder` (chart slot id / primary) is one pin: re-acquire of
 * the same fingerprint is a no-op, and a holder that moves to a new
 * fingerprint drops the old pin first so a single chart cannot occupy
 * two live sockets.
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
  /** holder id → fingerprint currently pinned by that holder. */
  private readonly holders = new Map<string, string>();
  private readonly onEvict: ((value: T) => void) | undefined;

  constructor(cap = TAB_SOCKET_CAP, onEvict?: (value: T) => void) {
    this.cap = cap;
    this.onEvict = onEvict;
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

  /** Live holders of this fingerprint (0 if queued or unknown). */
  refs(fingerprint: string): number {
    return this.live.get(fingerprint)?.refs ?? 0;
  }

  /**
   * Pin `fingerprint`. Pass `holder` (slot id) so a re-acquire of the
   * same pin does not bump refs, and a holder that moves drops the old
   * pin before opening the new one.
   */
  acquire(fingerprint: string, create: () => T, holder?: string): SocketPoolAcquire<T> {
    if (holder) {
      const prev = this.holders.get(holder);
      if (prev === fingerprint) {
        const live = this.live.get(fingerprint);
        if (live) return { status: 'live', value: live.value, fingerprint };
        const queued = this.pending.get(fingerprint);
        if (queued) return { status: 'queued', fingerprint, wait: queued.wait };
      } else if (prev !== undefined) {
        this.release(prev, holder);
      }
    }
    const got = this.take(fingerprint, create);
    if (holder) this.holders.set(holder, fingerprint);
    return got;
  }

  /**
   * Drop one holder. When the last ref is gone the socket leaves the
   * pool, `onEvict` runs, and the next waiter is created.
   */
  release(fingerprint: string, holder?: string): T | undefined {
    if (holder) {
      if (this.holders.get(holder) !== fingerprint) return undefined;
      this.holders.delete(holder);
    }
    const slot = this.live.get(fingerprint);
    if (!slot) {
      const queued = this.pending.get(fingerprint);
      if (queued) {
        queued.waiters -= 1;
        if (queued.waiters <= 0) {
          this.pending.delete(fingerprint);
          queued.reject(new Error('socket-pool-released'));
        }
      }
      return undefined;
    }
    slot.refs -= 1;
    if (slot.refs > 0) return undefined;
    this.live.delete(fingerprint);
    this.promote();
    this.onEvict?.(slot.value);
    return slot.value;
  }

  /** Remove every live socket and reject waiters. Does not call onEvict. */
  drain(): T[] {
    const values = [...this.live.values()].map((s) => s.value);
    this.live.clear();
    this.holders.clear();
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiters) w.reject(new Error('socket-pool-reset'));
    return values;
  }

  private take(fingerprint: string, create: () => T): SocketPoolAcquire<T> {
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
