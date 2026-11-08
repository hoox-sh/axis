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
 * REST fallback for Redesign2 frames.
 *
 * When the websocket transport is unavailable, the same frame shapes can be
 * exchanged through the existing REST evaluation surface. This helper keeps
 * fallback isolated and does not replace the websocket path.
 *
 * Degraded live fallback is `GET /session/{id}/tail?since_count=` — same frame
 * shapes as the WS (`full` when the cursor cannot continue, else `delta`),
 * polling semantics instead of push (final/plan.mdx §6).
 *
 * @module engine/rest-fallback
 */

import { engineHeaders } from '../engines/request-headers';

/**
 * One REST fallback POST (used when the live socket cannot serve the request): endpoint plus
 * the JSON body the WS path would have sent.
 */
export interface Redesign2RestRequest {
  endpoint: string;
  body: unknown;
  signal?: AbortSignal;
}

/**
 * POST a frame-shaped body over REST when `/ws/live` is unavailable; the reply has the same
 * `full`/`delta` shape the socket would have pushed.
 *
 * @param req Endpoint, body and abort signal for the request.
 * @returns The parsed JSON reply (unvalidated — callers apply the frame guards).
 * @throws {Error} On a non-2xx status or an unparseable body.
 */
export async function requestRedesign2RestFrame(req: Redesign2RestRequest): Promise<unknown> {
  const res = await fetch(req.endpoint, {
    method: 'POST',
    headers: engineHeaders(),
    body: JSON.stringify(req.body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Redesign2 REST fallback failed: ${res.status}`);
  return res.json();
}

/**
 * Degraded tail poll for a session cursor: which session to read and the count the client
 * already has, so the reply can be a delta.
 */
export interface Redesign2TailRequest {
  endpoint: string;
  sessionId: string;
  sinceCount: number;
  signal?: AbortSignal;
}

/**
 * Validated tail reply: session `status`, the new `count`, the last closed bar time, and the
 * opaque `tail` the delta applier merges.
 */
export interface Redesign2TailEnvelope {
  status: string;
  count: number;
  closed_upto: number;
  tail: unknown;
}

/** Build the degraded tail-poll URL for a session cursor. */
export function buildSessionTailUrl(
  endpoint: string,
  sessionId: string,
  sinceCount: number,
): string {
  const base = endpoint.replace(/\/$/, '');
  return `${base}/session/${encodeURIComponent(sessionId)}/tail?since_count=${Math.max(0, Math.floor(sinceCount))}`;
}

/**
 * Polls `GET /session/{id}/tail` and validates the envelope before the applier sees it.
 *
 * @param req Endpoint, session id, the `since_count` cursor, and an abort signal.
 * @returns The normalized tail envelope.
 * @throws {Error} On a non-2xx status, a non-object body, or a missing `count` /
 * `closed_upto`.
 */
export async function requestSessionTail(
  req: Redesign2TailRequest,
): Promise<Redesign2TailEnvelope> {
  const url = buildSessionTailUrl(req.endpoint, req.sessionId, req.sinceCount);
  const res = await fetch(url, {
    headers: engineHeaders(undefined, false),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Redesign2 session tail failed: ${res.status}`);
  const body = (await res.json()) as Partial<Redesign2TailEnvelope>;
  if (typeof body !== 'object' || body === null) {
    throw new Error('Redesign2 session tail returned a non-object envelope');
  }
  if (typeof body.count !== 'number' || typeof body.closed_upto !== 'number') {
    throw new Error('Redesign2 session tail envelope is missing count/closed_upto');
  }
  return {
    status: typeof body.status === 'string' ? body.status : 'success',
    count: body.count,
    closed_upto: body.closed_upto,
    tail: body.tail,
  };
}
