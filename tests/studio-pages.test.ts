// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio page registry — every page id is registered, unique, and typed.
 * The Data page (Data Source Manager) joined the primary rail.
 */

import { describe, expect, it } from 'bun:test';
import { STUDIO_PAGES, studioPageMeta } from '../src/ui/studio/pages';
import { isStudioPageId } from '../src/ui/studio/types';

describe('studio pages registry', () => {
  it('registers the Data page on the primary rail', () => {
    const meta = studioPageMeta('data');
    expect(meta.label).toBe('Data');
    expect(meta.group).toBe('primary');
    expect(meta.testId).toBe('axis-data-page');
  });

  it('accepts every registered id in isStudioPageId', () => {
    for (const page of STUDIO_PAGES) {
      expect(isStudioPageId(page.id)).toBe(true);
    }
  });

  it('keeps ids and test ids unique', () => {
    const ids = STUDIO_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const testIds = STUDIO_PAGES.map((p) => p.testId);
    expect(new Set(testIds).size).toBe(testIds.length);
  });

  it('rejects unknown page ids', () => {
    expect(isStudioPageId('nope')).toBe(false);
    expect(isStudioPageId(null)).toBe(false);
  });
});
