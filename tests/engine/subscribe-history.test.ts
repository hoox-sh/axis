import { describe, expect, test } from 'bun:test';
import { subscribeHistoryBars } from '../../src/streams/stream-live';

describe('subscribeHistoryBars', () => {
  test('caps the live snapshot so a 5k painted window does not block /ws/live', () => {
    expect(subscribeHistoryBars(5003, 10_000)).toBe(500);
    expect(subscribeHistoryBars(0, 10_000)).toBe(500);
    expect(subscribeHistoryBars(20, 10_000)).toBe(500);
    expect(subscribeHistoryBars(200, 10_000)).toBe(200);
  });
});
