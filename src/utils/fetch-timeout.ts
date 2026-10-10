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
 * Timeout helpers shared by alerts, on-chain adapters, and the workers probe.
 *
 * - {@link fetchWithTimeout}: one request, hard wall-clock cap, optional parent
 *   signal. The timeout stays armed through the body read (callers call
 *   `res.json()` / `res.text()` after this resolves).
 * - {@link linkedAbortBudget}: a shared budget for several requests (probe
 *   paths) with an explicit `dispose()` so timers never outlive the operation.
 *
 * @module utils/fetch-timeout
 */

/** Default wall-clock budget for a single HTTP request. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/** Normalize a caller timeout: finite positive ms, else the default. */
export function normalizeTimeoutMs(timeoutMs: number | undefined, fallback = DEFAULT_FETCH_TIMEOUT_MS): number {
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.max(1, Math.floor(timeoutMs))
    : fallback;
}

/**
 * Signal that aborts on timeout **or** when `parent` aborts.
 * Prefers `AbortSignal.timeout` + `AbortSignal.any` (the timer is runtime-managed
 * and does not hold the event loop); falls back to a manual controller.
 */
export function combineAbortSignals(timeoutMs: number, parent?: AbortSignal | null): AbortSignal {
  const ms = normalizeTimeoutMs(timeoutMs);
  const timeout = AbortSignal.timeout(ms);
  if (!parent) return timeout;
  if (parent.aborted) return AbortSignal.abort(parent.reason);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([parent, timeout]);

  const ctrl = new AbortController();
  const forward = (src: AbortSignal) => () => {
    try {
      ctrl.abort(src.reason);
    } catch {
      /* ignore */
    }
  };
  parent.addEventListener('abort', forward(parent), { once: true });
  timeout.addEventListener('abort', forward(timeout), { once: true });
  return ctrl.signal;
}

/** Options for {@link fetchWithTimeout}. */
export interface FetchWithTimeoutOpts {
  /** Hard cap in ms (default {@link DEFAULT_FETCH_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Override fetch (tests / injected clients). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * `fetch` with a default timeout. `init.signal` (if any) is honored as a parent:
 * aborting it cancels the request immediately.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  opts: FetchWithTimeoutOpts = {},
): Promise<Response> {
  const impl = opts.fetchImpl ?? globalThis.fetch;
  const signal = combineAbortSignals(normalizeTimeoutMs(opts.timeoutMs), init.signal);
  return impl(input, { ...init, signal });
}

/** A shared abort budget with explicit cleanup. */
export interface AbortBudget {
  signal: AbortSignal;
  /** Clear the timer and detach the parent listener. Safe to call repeatedly. */
  dispose: () => void;
}

/**
 * Controller that aborts after `timeoutMs` or when `parent` aborts. Call
 * `dispose()` once the guarded work finishes so the timer and listener are freed.
 */
export function linkedAbortBudget(timeoutMs: number, parent?: AbortSignal | null): AbortBudget {
  const ms = normalizeTimeoutMs(timeoutMs);
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let parentRef: AbortSignal | null = null;

  const onParentAbort = (): void => {
    dispose();
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  };

  const dispose = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (parentRef) {
      parentRef.removeEventListener?.('abort', onParentAbort);
      parentRef = null;
    }
  };

  if (parent) {
    if (parent.aborted) {
      onParentAbort();
      return { signal: ctrl.signal, dispose };
    }
    if (typeof parent.addEventListener === 'function') {
      parent.addEventListener('abort', onParentAbort, { once: true });
      parentRef = parent;
    }
  }

  timer = setTimeout(() => {
    timer = undefined;
    onParentAbort();
  }, ms);

  return { signal: ctrl.signal, dispose };
}
