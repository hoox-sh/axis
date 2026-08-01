/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Smoke checks for the integrated-label topbar field export.
 */

import { describe, expect, it } from 'bun:test';
import { TopbarField } from '../src/ui/TopbarField';
import type { TopbarFieldVariant } from '../src/ui/TopbarField';

describe('TopbarField', () => {
  it('exports a component function', () => {
    expect(typeof TopbarField).toBe('function');
  });

  it('accepts documented variant tokens', () => {
    const variants: TopbarFieldVariant[] = ['input', 'select', 'static'];
    expect(variants).toHaveLength(3);
  });
});
