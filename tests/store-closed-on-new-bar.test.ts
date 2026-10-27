import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { setStore, store } from '../src/store';
import { appendBar } from '../src/store';
import type { Bar } from '../src/store/types';

function bar(t: number, closed = false): Bar {
  return { time: t, open: 100, high: 101, low: 99, close: 100, volume: 1, closed };
}

beforeEach(() => {
  setStore('bars', []);
  setStore('rollingWindowBars', 1000);
});

describe('appendBar marks previous tip closed on new bar', () => {
  it('closes the forming tip when a later bar arrives', () => {
    appendBar(bar(60, false));
    expect(store.bars[0]!.closed).toBe(false);
    appendBar(bar(120, false));
    expect(store.bars[0]!.closed).toBe(true);
    expect(store.bars[1]!.closed).toBe(false);
  });

  it('keeps an already-closed tip closed', () => {
    appendBar(bar(60, true));
    appendBar(bar(120, false));
    expect(store.bars[0]!.closed).toBe(true);
  });

  it('returns appended for a new bar with room', () => {
    appendBar(bar(60, false));
    const r = appendBar(bar(120, false));
    expect(r).toBe('appended');
  });
});
