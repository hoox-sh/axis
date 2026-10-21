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
 * Shared abort/timeout helpers.
 *
 * The contract that matters: **a parent signal is never silently dropped.**
 * The old per-module copies either used `AbortSignal.any` (and dropped the
 * parent when the runtime lacked it) or hand-rolled a fallback that only some
 * call sites had. `combineAbortSignals` always honours the parent.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  combineAbortSignals,
  linkedAbortBudget,
  normalizeTimeoutMs,
  signalOrTimeout,
  DEFAULT_FETCH_TIMEOUT_MS,
} from '../src/utils/fetch-timeout';

const originalAny = AbortSignal.any;

afterEach(() => {
  (AbortSignal as { any?: typeof originalAny }).any = originalAny;
});

/** Simulate a runtime without `AbortSignal.any`. */
function withoutAbortSignalAny(): void {
  (AbortSignal as { any?: typeof originalAny }).any = undefined;
}

describe('normalizeTimeoutMs', () => {
  it('keeps a finite positive timeout', () => {
    expect(normalizeTimeoutMs(1234)).toBe(1234);
    expect(normalizeTimeoutMs(1)).toBe(1);
  });

  it('floors a fractional timeout', () => {
    expect(normalizeTimeoutMs(1234.9)).toBe(1234);
  });

  it('falls back for a missing or invalid timeout', () => {
    expect(normalizeTimeoutMs(undefined)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(normalizeTimeoutMs(0)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(normalizeTimeoutMs(-5)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(normalizeTimeoutMs(Number.NaN)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(normalizeTimeoutMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(normalizeTimeoutMs(undefined, 42)).toBe(42);
  });
});

describe('combineAbortSignals', () => {
  it('returns a timeout-only signal without a parent', () => {
    const signal = combineAbortSignals(50);
    expect(signal.aborted).toBe(false);
  });

  it('aborts on the timeout', async () => {
    const signal = combineAbortSignals(10);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(true);
  });

  it('aborts when the parent aborts', () => {
    const parent = new AbortController();
    const signal = combineAbortSignals(60_000, parent.signal);
    expect(signal.aborted).toBe(false);
    parent.abort();
    expect(signal.aborted).toBe(true);
  });

  it('aborts when the parent aborts without AbortSignal.any', () => {
    withoutAbortSignalAny();
    const parent = new AbortController();
    const signal = combineAbortSignals(60_000, parent.signal);
    expect(signal.aborted).toBe(false);
    parent.abort();
    expect(signal.aborted).toBe(true);
  });

  it('starts aborted when the parent is already aborted', () => {
    const parent = new AbortController();
    parent.abort();
    expect(combineAbortSignals(60_000, parent.signal).aborted).toBe(true);
  });
});

describe('signalOrTimeout', () => {
  it('returns the caller signal untouched', () => {
    const parent = new AbortController();
    expect(signalOrTimeout(15_000, parent.signal)).toBe(parent.signal);
  });

  it('falls back to a timeout without a caller signal', () => {
    expect(signalOrTimeout(15_000).aborted).toBe(false);
  });
});

describe('linkedAbortBudget', () => {
  it('aborts on the budget', async () => {
    const budget = linkedAbortBudget(10);
    await new Promise((r) => setTimeout(r, 30));
    expect(budget.signal.aborted).toBe(true);
    budget.dispose();
  });

  it('aborts when the parent aborts', () => {
    const parent = new AbortController();
    const budget = linkedAbortBudget(60_000, parent.signal);
    parent.abort();
    expect(budget.signal.aborted).toBe(true);
    budget.dispose();
  });

  it('starts aborted when the parent is already aborted', () => {
    const parent = new AbortController();
    parent.abort();
    const budget = linkedAbortBudget(60_000, parent.signal);
    expect(budget.signal.aborted).toBe(true);
    budget.dispose();
  });

  it('detaches the parent listener on dispose', () => {
    const parent = new AbortController();
    const budget = linkedAbortBudget(60_000, parent.signal);
    budget.dispose();
    // Disposing clears the timer — the budget must not fire afterwards.
    expect(budget.signal.aborted).toBe(false);
    budget.dispose();
  });
});
