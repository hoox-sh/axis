// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * HTTP handlers for the feed routes that are not the bare `/api/feed`
 * snapshot/WS (that one lives in `index.ts`):
 *
 * - `GET /api/feed/delta?feed=<key>&after=<seq>` — public, same read posture
 *   as the snapshot. Forwarded to the FeedDO; the DO owns the delta ring.
 * - `POST /api/feed/bars` — authenticated writer for user-fed feeds. Requires
 *   an API key whose partition id matches the `user:<hash>` scope of the feed
 *   key; the DO enforces the bar contract and the single-seq batch emit.
 *
 * @module worker/feed/feed-http
 */

import { requireApiKey } from '../auth';
import { MARKET_CORS, WRITE_CORS } from '../http';
import { feedKeyToString, parseFeedKeyAllowUserScope } from './feed-key';
import { userScopeForApiKey } from './ingest';
import type { Env } from '../index';

/** Context shape shared with the route table (mirrors `RouteContext`). */
export interface FeedRouteContext {
  req: Request;
  env: Env;
  origin: string;
  url: URL;
}

type CorsFn = (origin: string) => Record<string, string>;

function err(
  status: number,
  error: string,
  origin: string,
  cors: CorsFn,
  extra?: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify({ error, code: error, ...(extra ?? {}) }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cors(origin),
    },
  });
}

function noFeedBinding(origin: string, cors: CorsFn): Response {
  return err(503, 'no_feed', origin, cors, {
    reason: 'FEED Durable Object not bound. Add the binding in wrangler.toml and deploy.',
  });
}

/** Copy a DO response, stamping this route's CORS policy on it. */
function relay(res: Response, origin: string, cors: CorsFn): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export async function handleFeedDelta(ctx: FeedRouteContext): Promise<Response> {
  const { env, origin, url } = ctx;
  if (!env.FEED) return noFeedBinding(origin, MARKET_CORS);
  const parsed = parseFeedKeyAllowUserScope(url.searchParams.get('feed') ?? '');
  if (!parsed) {
    return err(400, 'invalid_feed', origin, MARKET_CORS, {
      reason: 'feed must be a valid feed key',
    });
  }
  const after = url.searchParams.get('after');
  if (after === null || !/^\d+$/.test(after)) {
    return err(400, 'invalid_after', origin, MARKET_CORS, {
      reason: 'after must be a non-negative integer (unix sequence number)',
    });
  }
  const key = feedKeyToString(parsed);
  const id = env.FEED.idFromName(key);
  const stub = env.FEED.get(id);
  const target = new URL('/delta', url.origin);
  target.searchParams.set('feed', key);
  target.searchParams.set('after', after);
  const res = await stub.fetch(new Request(target, { method: 'GET' }));
  return relay(res, origin, MARKET_CORS);
}

export async function handleFeedBars(ctx: FeedRouteContext): Promise<Response> {
  const { req, env, origin, url } = ctx;
  if (!env.FEED) return noFeedBinding(origin, WRITE_CORS);

  const auth = await requireApiKey(req, env);
  if (!auth.ok) {
    return err(auth.status, auth.code.toLowerCase(), origin, WRITE_CORS, {
      reason: auth.message,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err(400, 'invalid_json', origin, WRITE_CORS, { reason: 'body must be JSON' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return err(400, 'invalid_body', origin, WRITE_CORS, {
      reason: 'body must be an object {feed, bars}',
    });
  }
  const record = body as Record<string, unknown>;
  const feedRaw = record['feed'];
  const parsed = typeof feedRaw === 'string' ? parseFeedKeyAllowUserScope(feedRaw) : null;
  if (!parsed) {
    return err(400, 'invalid_feed', origin, WRITE_CORS, {
      reason: 'feed must be a valid feed key',
    });
  }
  if (parsed.authScope === 'public') {
    return err(403, 'public_feed_readonly', origin, WRITE_CORS);
  }
  const expected = await userScopeForApiKey(auth.ctx.key);
  if (parsed.authScope !== expected) {
    return err(403, 'feed_scope_mismatch', origin, WRITE_CORS, {
      reason: 'feed auth scope does not match the API key',
    });
  }

  // Forward the validated body verbatim; the DO re-checks the bar contract.
  const key = feedKeyToString(parsed);
  const id = env.FEED.idFromName(key);
  const stub = env.FEED.get(id);
  const target = new URL('/bars', url.origin);
  target.searchParams.set('feed', key);
  const res = await stub.fetch(
    new Request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return relay(res, origin, WRITE_CORS);
}
