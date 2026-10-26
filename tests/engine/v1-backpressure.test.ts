/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  SEND_BUFFER_CLEAR_BYTES,
  SEND_BUFFER_STALE_BYTES,
  _resetSendBufferHeldForTests,
  isFormingTipFrame,
  sendBufferHeld,
} from '../../src/engine/v1/backpressure';

describe('send buffer backpressure', () => {
  beforeEach(() => {
    _resetSendBufferHeldForTests();
  });

  test('holds only past 1 MB', () => {
    expect(sendBufferHeld(0)).toBe(false);
    expect(sendBufferHeld(undefined)).toBe(false);
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES)).toBe(false);
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES + 1)).toBe(true);
  });

  test('stays held until the clear watermark', () => {
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES + 1)).toBe(true);
    // Still above the clear watermark — do not resume yet.
    expect(sendBufferHeld(SEND_BUFFER_CLEAR_BYTES + 1)).toBe(true);
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES)).toBe(true);
    // Drain below the clear watermark — resume once.
    expect(sendBufferHeld(SEND_BUFFER_CLEAR_BYTES)).toBe(false);
    expect(sendBufferHeld(0)).toBe(false);
  });

  test('wasHeld overrides the module latch', () => {
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES + 1, false)).toBe(true);
    // Explicit clear path even if the module latch was set true above.
    expect(sendBufferHeld(SEND_BUFFER_CLEAR_BYTES + 1, true)).toBe(true);
    expect(sendBufferHeld(SEND_BUFFER_CLEAR_BYTES, true)).toBe(false);
    expect(sendBufferHeld(SEND_BUFFER_STALE_BYTES + 1, false)).toBe(true);
  });

  test('a forming delta is a tip; a close, snapshot, and UNCHANGED are not', () => {
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
    // Keepalives must reach TipCoalescer under send hold so their seq is acked.
    expect(
      isFormingTipFrame({
        type: 'delta',
        id: 's',
        payload: { forming: true, unchanged: true },
      }),
    ).toBe(false);
    expect(
      isFormingTipFrame({
        type: 'delta',
        id: 's',
        payload: { forming: true, unchanged: true, bars: [{ close: 1 }] },
      }),
    ).toBe(true);
  });
});
