/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  SEND_BUFFER_STALE_BYTES,
  isFormingTipFrame,
  sendBufferHeld,
} from '../../src/engine/v1/backpressure';

describe('send buffer backpressure', () => {
  test('holds only past 1 MB', () => {
    expect(sendBufferHeld(0)).toBe(false);
    expect(sendBufferHeld(undefined)).toBe(false);
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES)).toBe(false);
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES + 1)).toBe(true);
  });

  test('a forming delta is a tip; a close and a snapshot are not', () => {
    expect(
      isFormingTipFrame({
        type: 'delta',
        id: 's',
        payload: { forming: true },
      }),
    ).toBe(true);
    expect(
      isFormingTipFrame({
        type: 'delta',
        id: 's',
        payload: { forming: false },
      }),
    ).toBe(false);
    expect(isFormingTipFrame({ type: 'full', id: 's', payload: { forming: true } })).toBe(false);
    expect(isFormingTipFrame({ type: 'close', id: 's' })).toBe(false);
    expect(isFormingTipFrame({ type: 'delta', payload: { forming: true } })).toBe(false);
  });
});
