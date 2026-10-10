/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Shared 1 Hz wall-clock (E18) — one signal for all status-chrome subscribers.
 */

import { describe, expect, it } from 'bun:test';
import { createRoot } from 'solid-js';
import { useNow } from '../src/ui/clock';

describe('useNow', () => {
  it('returns a numeric clock accessor', () => {
    createRoot((dispose) => {
      const now = useNow();
      expect(typeof now()).toBe('number');
      dispose();
    });
  });

  it('shares one signal across subscribers (no per-component intervals)', () => {
    createRoot((dispose) => {
      const a = useNow();
      const b = useNow();
      expect(a).toBe(b);
      dispose();
    });
  });
});
