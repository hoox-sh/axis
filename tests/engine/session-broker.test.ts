import { describe, expect, test } from 'bun:test';
import { Redesign2SessionBroker } from '../../src/engine/session-broker';

describe('redesign2 session broker', () => {
  test('reuses a session for the same identity', () => {
    const broker = new Redesign2SessionBroker();
    const identity = { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', interval: '1m' };
    const first = broker.open(identity);
    const second = broker.open(identity, first.id);
    expect(second.id).toBe(first.id);
    expect(broker.requiresFull(first.id)).toBe(true);
    broker.markFullSent(first.id);
    expect(broker.requiresFull(first.id)).toBe(false);
    broker.advanceCursor(first.id, 5);
    expect(broker.get(first.id)?.cursor).toBe(5);
  });

  test('rejects backwards cursor movement', () => {
    const broker = new Redesign2SessionBroker();
    const identity = { exchange: 'binance', market: 'spot', symbol: 'ETHUSDT', interval: '5m' };
    const session = broker.open(identity);
    broker.advanceCursor(session.id, 3);
    expect(() => broker.advanceCursor(session.id, 2)).toThrow();
  });
});