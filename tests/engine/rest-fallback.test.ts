import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildSessionTailUrl,
  requestRedesign2RestFrame,
} from '../../src/engine/rest-fallback';

describe('redesign2 rest fallback', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'status', payload: { code: 'live' } }),
    })) as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('uses POST and returns parsed JSON', async () => {
    const result = await requestRedesign2RestFrame({
      endpoint: 'https://example.test/run',
      body: { hello: 'world' },
    });
    expect((result as { type: string }).type).toBe('status');
  });

  test('builds the degraded tail-poll URL for a session cursor', () => {
    expect(buildSessionTailUrl('https://example.test/', 's id', 42)).toBe(
      'https://example.test/session/s%20id/tail?since_count=42',
    );
    expect(buildSessionTailUrl('https://example.test', 's1', -5)).toBe(
      'https://example.test/session/s1/tail?since_count=0',
    );
  });
});