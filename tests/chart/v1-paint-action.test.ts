/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { paintAction, type PaintAction } from '../../src/chart/v1/paint-action';
import type { BarAppendResult } from '../../src/store';

describe('paintAction (concept §5.2 / §11)', () => {
  const rows: Array<{
    name: string;
    verdict: BarAppendResult;
    windowLength: number;
    action: PaintAction;
  }> = [
    { name: 'ignored', verdict: 'ignored', windowLength: 0, action: 'none' },
    { name: 'ignored (window already has bars)', verdict: 'ignored', windowLength: 10, action: 'none' },
    { name: 'updated (forming tick)', verdict: 'updated', windowLength: 1, action: 'update' },
    { name: 'appended-first', verdict: 'appended', windowLength: 1, action: 'setData' },
    { name: 'appended-later', verdict: 'appended', windowLength: 2, action: 'update' },
    // Slide stays setData: update can append a tip but cannot drop the head.
    // live-append may defer that replace to rAF; the action kind is unchanged.
    { name: 'slid', verdict: 'slid', windowLength: 10_000, action: 'setData' },
  ];

  for (const row of rows) {
    test(`${row.name} → ${row.action}`, () => {
      expect(paintAction(row.verdict, row.windowLength)).toBe(row.action);
    });
  }
});
