import { describe, expect, test } from 'bun:test';
import { Redesign2SessionMultiplexer } from '../../src/engine/session-multiplexer';

describe('redesign2 session multiplexer', () => {
  test('isolates sessions by id', () => {
    const mux = new Redesign2SessionMultiplexer();
    const seen: string[] = [];
    mux.register('a', (p) => seen.push(`a:${String(p)}`));
    mux.register('b', (p) => seen.push(`b:${String(p)}`));

    expect(mux.dispatch('a', 'x')).toBe(true);
    expect(mux.dispatch('b', 'y')).toBe(true);
    expect(seen).toEqual(['a:x', 'b:y']);
    expect(mux.size).toBe(2);

    mux.unregister('a');
    expect(mux.dispatch('a', 'z')).toBe(false);
    expect(mux.dispatch('b', 'z')).toBe(true);
  });
});