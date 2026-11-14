/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { FeedDO } from '../src/durable-objects/feed';
import { handleFeedBars, handleFeedDelta } from '../src/feed/feed-http';
import { DELTA_RING_CAP } from '../src/feed/ingest';
import { partitionIdFromKey } from '../src/hash';
import type { Env } from '../src/index';

const USER_FEED = (hash: string) => `mexc|spot|BTC/USDT|1m|none|user:${hash}`;
const PUBLIC_FEED = 'mexc|spot|BTC/USDT|1m|none|public';
const API_KEY = `pn_${'a'.repeat(48)}`;

const bar = (time: number, over: Partial<Record<string, number>> = {}) => ({
  time,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 12.5,
  ...over,
});

function makeEnv(feedDo: FeedDO) {
  const stub = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: (req: Request) => feedDo.fetch(req) }),
  };
  return { FEED: stub } as unknown as Env;
}

function makeDO(): FeedDO {
  const ctx = {
    acceptWebSocket: () => {},
    getWebSockets: () => [],
    storage: { setAlarm: async () => {} },
  } as unknown as DurableObjectState;
  return new FeedDO(ctx, {} as unknown as Env);
}

function deltaReq(feed: string, after: string | null): Request {
  const url = new URL('https://do.test/delta');
  url.searchParams.set('feed', feed);
  if (after !== null) url.searchParams.set('after', after);
  return new Request(url);
}

async function postBars(dobj: FeedDO, feed: string, bars: unknown, key: string | null = API_KEY) {
  const req = new Request('https://worker.test/api/feed/bars', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify({ feed, bars }),
  });
  const env = makeEnv(dobj);
  return handleFeedBars({ req, env, origin: 'https://app.test', url: new URL(req.url) });
}

async function userFeedKey(): Promise<string> {
  return USER_FEED(await partitionIdFromKey(API_KEY));
}

describe('FeedDO delta route', () => {
  it('400 on missing/invalid after and missing feed', async () => {
    const d = makeDO();
    const noAfter = await d.fetch(deltaReq(PUBLIC_FEED, null));
    expect(noAfter.status).toBe(400);
    const badAfter = await d.fetch(deltaReq(PUBLIC_FEED, 'abc'));
    expect(badAfter.status).toBe(400);
    const negAfter = await d.fetch(deltaReq(PUBLIC_FEED, '-1'));
    expect(negAfter.status).toBe(400);
    const missingFeed = await d.fetch(new Request('https://do.test/delta?after=0'));
    expect(missingFeed.status).toBe(400);
  });

  it('400 feed_mismatch when the DO already serves a different feed', async () => {
    const d = makeDO();
    const first = await d.fetch(deltaReq(PUBLIC_FEED, '0'));
    expect(first.status).toBe(200);
    const other = 'mexc|spot|ETH/USDT|1m|none|public';
    const second = await d.fetch(deltaReq(other, '0'));
    expect(second.status).toBe(400);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('feed_mismatch');
  });

  it('200 with empty deltas right after a snapshot seq', async () => {
    const d = makeDO();
    const feed = await userFeedKey();
    // Seed a bar via the ingest path so a snapshot exists.
    const seed = await postBars(d, feed, [bar(1_700_000_000)]);
    expect(seed.status).toBe(202);
    const seeded = (await seed.json()) as { seq: number };
    const snapshot = await d.fetch(
      new Request(`https://do.test/?feed=${encodeURIComponent(feed)}`),
    );
    expect(snapshot.status).toBe(200);
    const snap = (await snapshot.json()) as { seq: number; bars: unknown[] };
    expect(snap.bars).toHaveLength(1);
    const res = await d.fetch(deltaReq(feed, String(snap.seq)));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { seq: number; deltas: unknown[] };
    expect(body.seq).toBe(seeded.seq);
    expect(body.deltas).toEqual([]);
  });

  it('200 with N deltas when after is in range', async () => {
    const d = makeDO();
    d.__pushDeltaForTests(5);
    const res = await d.fetch(deltaReq(PUBLIC_FEED, '2'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seq: number; deltas: Array<{ seq: number }> };
    expect(body.seq).toBe(5);
    expect(body.deltas.map((d) => d.seq)).toEqual([3, 4, 5]);
    // after = current seq → empty
    const empty = await d.fetch(deltaReq(PUBLIC_FEED, '5'));
    expect(((await empty.json()) as { deltas: unknown[] }).deltas).toEqual([]);
  });

  it('410 with delta_gone when after is older than the retained window', async () => {
    const d = makeDO();
    d.__pushDeltaForTests(DELTA_RING_CAP + 4); // 260 pushes, seq 1..260, ring keeps 5..260
    const res = await d.fetch(deltaReq(PUBLIC_FEED, '1'));
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string; code: string; hint: string };
    expect(body.error).toBe('delta_gone');
    expect(body.code).toBe('delta_gone');
    expect(body.hint).toContain('re-GET /api/feed');
    // after = oldest - 1 is still served (oldest retained = 260 - 256 + 1 = 5)
    const ok = await d.fetch(deltaReq(PUBLIC_FEED, '4'));
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { deltas: Array<{ seq: number }> };
    expect(okBody.deltas).toHaveLength(DELTA_RING_CAP);
    expect(okBody.deltas[0]?.seq).toBe(5);
    // one below that boundary trips the 410
    const gone = await d.fetch(deltaReq(PUBLIC_FEED, '3'));
    expect(gone.status).toBe(410);
  });
});

describe('POST /api/feed/bars', () => {
  it('401 without Authorization', async () => {
    const d = makeDO();
    const feed = await userFeedKey();
    const res = await postBars(d, feed, [bar(1_700_000_000)], null);
    expect(res.status).toBe(401);
  });

  it('403 public_feed_readonly for a public feed key', async () => {
    const d = makeDO();
    const res = await postBars(d, PUBLIC_FEED, [bar(1_700_000_000)]);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('public_feed_readonly');
  });

  it('403 feed_scope_mismatch when the scope hash does not match the key', async () => {
    const d = makeDO();
    const feed = USER_FEED('0'.repeat(32));
    const res = await postBars(d, feed, [bar(1_700_000_000)]);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('feed_scope_mismatch');
  });

  it('400 on negative volume', async () => {
    const d = makeDO();
    const feed = await userFeedKey();
    const res = await postBars(d, feed, [bar(1_700_000_000, { volume: -1 })]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toContain('volume');
  });

  it('400 on unsorted times', async () => {
    const d = makeDO();
    const feed = await userFeedKey();
    const res = await postBars(d, feed, [bar(1_700_000_100), bar(1_700_000_000)]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toContain('strictly increasing');
  });

  it('400 on inverted OHLC (high < low)', async () => {
    const d = makeDO();
    const feed = await userFeedKey();
    const res = await postBars(d, feed, [bar(1_700_000_000, { high: 80, low: 95 })]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toContain('high');
  });

  it('400 when close is above high', async () => {
    const d = makeDO();
    const feed = await userFeedKey();
    const res = await postBars(d, feed, [bar(1_700_000_000, { close: 120, high: 110 })]);
    expect(res.status).toBe(400);
  });

  it('202: one seq bump, delta visible via /delta, bars visible in snapshot', async () => {
    const d = makeDO();
    const feed = await userFeedKey();
    const t0 = 1_700_000_000;
    const res = await postBars(d, feed, [bar(t0), bar(t0 + 60, { close: 108 })]);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { seq: number; accepted: boolean; bars: number };
    expect(body.seq).toBe(1);
    expect(body.accepted).toBe(true);
    expect(body.bars).toBe(2);

    // The injected delta is served by the delta route.
    const env = makeEnv(d);
    const deltaRes = await handleFeedDelta({
      req: new Request(
        `https://worker.test/api/feed/delta?feed=${encodeURIComponent(feed)}&after=0`,
      ),
      env,
      origin: 'https://app.test',
      url: new URL(`https://worker.test/api/feed/delta?feed=${encodeURIComponent(feed)}&after=0`),
    });
    expect(deltaRes.status).toBe(200);
    const deltaBody = (await deltaRes.json()) as {
      seq: number;
      deltas: Array<{ seq: number; forming: boolean; feed: string; times: number[] }>;
    };
    expect(deltaBody.seq).toBe(1);
    expect(deltaBody.deltas).toHaveLength(1);
    expect(deltaBody.deltas[0]?.seq).toBe(1);
    expect(deltaBody.deltas[0]?.forming).toBe(false);
    expect(deltaBody.deltas[0]?.feed).toBe(feed);
    expect(deltaBody.deltas[0]?.times).toEqual([t0, t0 + 60]);

    // Bars are visible in a subsequent snapshot.
    const snapshot = await d.fetch(
      new Request(`https://do.test/?feed=${encodeURIComponent(feed)}`),
    );
    expect(snapshot.status).toBe(200);
    const snap = (await snapshot.json()) as { bars: Array<{ time: number; closed: boolean }> };
    expect(snap.bars.map((b) => b.time)).toEqual([t0, t0 + 60]);
    expect(snap.bars.every((b) => b.closed)).toBe(true);
  });

  it('409 feed_has_builtin_source when POSTing to a public (polled) feed DO', async () => {
    const d = makeDO();
    const url = new URL('https://do.test/bars');
    url.searchParams.set('feed', PUBLIC_FEED);
    const res = await d.fetch(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feed: PUBLIC_FEED, bars: [bar(1_700_000_000)] }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('feed_has_builtin_source');
  });
});
