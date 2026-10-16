import { describe, expect, test } from 'bun:test';
import {
  isErrorFrame,
  isFullFrame,
  isStatusFrame,
  validateRedesign2Frame,
} from '../../src/engine/frames';

describe('redesign2 frames', () => {
  test('accepts a valid status frame', () => {
    const frame = {
      type: 'status',
      sessionId: 's1',
      payload: { code: 'live', detail: 'ok' },
    };
    expect(isStatusFrame(frame)).toBe(true);
    expect(validateRedesign2Frame(frame)).toBe(true);
  });

  test('rejects malformed frames', () => {
    expect(validateRedesign2Frame({ type: 'status', payload: {} })).toBe(false);
    expect(validateRedesign2Frame(null)).toBe(false);
    expect(isFullFrame({ type: 'full', payload: { seriesKey: 'x' } })).toBe(false);
    expect(isErrorFrame({ type: 'error', payload: { code: 'x' } })).toBe(false);
  });
});