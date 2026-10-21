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
 * Shared error helpers.
 *
 * The point of these helpers is that the *decision* (is this a cancellation?)
 * and the *wording* (what do we tell the user?) are two different questions:
 *
 * - {@link isAbortError} answers the first — it is name-based only, so a
 *   network error whose text happens to mention a timeout is still a network
 *   error.
 * - {@link isAbortLike} / {@link isTimeoutLike} answer the second.
 */

import { describe, expect, it } from 'bun:test';
import { errMessage, isAbortError, isAbortLike, isTimeoutLike } from '../src/utils/errors';

describe('errMessage', () => {
  it('prefers the Error message', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });

  it('accepts a plain string', () => {
    expect(errMessage('boom')).toBe('boom');
  });

  it('falls back for a value with no message', () => {
    expect(errMessage(new Error(''))).toBe('Unknown error');
    expect(errMessage(null)).toBe('Unknown error');
    expect(errMessage(undefined)).toBe('Unknown error');
    expect(errMessage(42)).toBe('Unknown error');
  });

  it('honours a caller-supplied fallback', () => {
    expect(errMessage(null, 'Expand failed')).toBe('Expand failed');
    expect(errMessage(new Error('boom'), 'Expand failed')).toBe('boom');
  });
});

describe('isAbortError', () => {
  it('recognises AbortError and TimeoutError by name', () => {
    const abort = new Error('x');
    abort.name = 'AbortError';
    const timeout = new Error('x');
    timeout.name = 'TimeoutError';
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(timeout)).toBe(true);
  });

  it('does not match on message text alone', () => {
    // The authoritative check stays name-based: a network error that mentions
    // a timeout must not be treated as a cancellation.
    expect(isAbortError(new Error('request timed out'))).toBe(false);
    expect(isAbortError('The operation was aborted')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('isAbortLike', () => {
  it('matches the name-based cases', () => {
    const abort = new Error('x');
    abort.name = 'AbortError';
    expect(isAbortLike(abort)).toBe(true);
  });

  it('matches abort and timeout text', () => {
    expect(isAbortLike(new Error('The operation was aborted due to timeout'))).toBe(true);
    expect(isAbortLike(new Error('signal timed out'))).toBe(true);
    expect(isAbortLike('Request aborted')).toBe(true);
  });

  it('does not match an unrelated error', () => {
    expect(isAbortLike(new Error('failed to fetch'))).toBe(false);
    expect(isAbortLike(null)).toBe(false);
  });
});

describe('isTimeoutLike', () => {
  it('matches TimeoutError by name', () => {
    const timeout = new Error('x');
    timeout.name = 'TimeoutError';
    expect(isTimeoutLike(timeout)).toBe(true);
  });

  it('matches timeout text', () => {
    expect(isTimeoutLike(new Error('The operation was aborted due to timeout'))).toBe(true);
    expect(isTimeoutLike(new Error('signal timed out'))).toBe(true);
  });

  it('does not match a plain abort', () => {
    const abort = new Error('x');
    abort.name = 'AbortError';
    expect(isTimeoutLike(abort)).toBe(false);
    expect(isTimeoutLike(new Error('The operation was aborted'))).toBe(false);
  });
});
