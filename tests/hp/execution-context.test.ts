/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { Axb1Opcode } from '../../src/hp/axb1/constants';
import {
  executionContextFromDelta,
  executionContextFromJsonFrame,
  executionContextFromOpcode,
} from '../../src/hp/calc/execution-context';

describe('execution context', () => {
  test('forming: true is a tip', () => {
    expect(executionContextFromDelta({ forming: true, count: 3 }, 3)).toBe('tip');
    expect(executionContextFromJsonFrame({ type: 'delta', payload: { forming: true } })).toBe(
      'tip',
    );
  });

  test('forming: false is an append', () => {
    expect(executionContextFromDelta({ forming: false, count: 3 }, 3)).toBe('append');
  });

  test('omitted forming grows count → append, same count → tip', () => {
    expect(executionContextFromDelta({ count: 4 }, 3)).toBe('append');
    expect(executionContextFromDelta({ count: 3 }, 3)).toBe('tip');
  });

  test('JSON full is snapshot and close is append', () => {
    expect(executionContextFromJsonFrame({ type: 'full' })).toBe('snapshot');
    expect(executionContextFromJsonFrame({ type: 'close' })).toBe('append');
  });

  test('opcodes map tip vs append vs snapshot', () => {
    expect(executionContextFromOpcode(Axb1Opcode.TIP_UPDATE)).toBe('tip');
    expect(executionContextFromOpcode(Axb1Opcode.PLOT_TIP)).toBe('tip');
    expect(executionContextFromOpcode(Axb1Opcode.APPEND_BAR)).toBe('append');
    expect(executionContextFromOpcode(Axb1Opcode.CLOSE_VERIFY)).toBe('append');
    expect(executionContextFromOpcode(Axb1Opcode.SNAPSHOT_OHLCV)).toBe('snapshot');
  });
});
