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

export interface Redesign2RestRequest {
  endpoint: string;
  body: unknown;
  signal?: AbortSignal;
}

export async function requestRedesign2RestFrame(
  req: Redesign2RestRequest,
): Promise<unknown> {
  const res = await fetch(req.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req.body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Redesign2 REST fallback failed: ${res.status}`);
  return res.json();
}

export interface Redesign2TailRequest {
  endpoint: string;
  sessionId: string;
  sinceCount: number;
  signal?: AbortSignal;
}

export interface Redesign2TailEnvelope {
  status: string;
  count: number;
  closed_upto: number;
  tail: unknown;
}

/** Build the degraded tail-poll URL for a session cursor. */
export function buildSessionTailUrl(endpoint: string, sessionId: string, sinceCount: number): string {
  const base = endpoint.replace(/\/$/, '');
  return `${base}/session/${encodeURIComponent(sessionId)}/tail?since_count=${Math.max(0, Math.floor(sinceCount))}`;
}

export async function requestSessionTail(req: Redesign2TailRequest): Promise<Redesign2TailEnvelope> {
  const url = buildSessionTailUrl(req.endpoint, req.sessionId, req.sinceCount);
  const res = await fetch(url, { signal: req.signal });
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