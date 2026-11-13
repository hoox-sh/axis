// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The destructive-action gate.
 *
 * Every call site used to hand-roll
 * `typeof window === 'undefined' ? true : window.confirm(...)`, so the
 * "no DOM ⇒ allow" rule for tests and SSR was restated eight times and could
 * drift. This pins it in one place.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { confirmDestructive } from '../src/ui/confirm-destructive';

const cleanups: (() => void)[] = [];

function withWindow(value: unknown): void {
  (globalThis as { window?: unknown }).window = value;
  cleanups.push(() => {
    delete (globalThis as { window?: unknown }).window;
  });
}

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

describe('confirmDestructive', () => {
  it('allows the action when there is no DOM to ask with', () => {
    expect(confirmDestructive('Delete everything?')).toBe(true);
  });

  it('allows when window exists but has no confirm', () => {
    withWindow({});
    expect(confirmDestructive('Delete everything?')).toBe(true);
  });

  it('returns what the user answered', () => {
    const asked: string[] = [];
    withWindow({
      confirm: (message: string) => {
        asked.push(message);
        return false;
      },
    });
    expect(confirmDestructive('Delete run r1?')).toBe(false);
    expect(asked).toEqual(['Delete run r1?']);
  });

  it('passes the message through unchanged', () => {
    let seen = '';
    withWindow({
      confirm: (message: string) => {
        seen = message;
        return true;
      },
    });
    const message = 'Flush the dataset manager?\n\nThis cannot be undone.';
    expect(confirmDestructive(message)).toBe(true);
    expect(seen).toBe(message);
  });
});
