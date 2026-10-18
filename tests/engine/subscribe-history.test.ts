import { describe, expect, test } from 'bun:test';
import { subscribeHistoryBars } from '../../src/streams/stream-live';

describe('subscribeHistoryBars', () => {
  test('caps to the painted window so a 10k rolling target does not block snapshot', () => {
    expect(subscribeHistoryBars(5003, 10_000)).toBe(5003);
    expect(subscribeHistoryBars(0, 10_000)).toBe(10_000);
    expect(subscribeHistoryBars(20, 10_000)).toBe(10_000);
  });
});
