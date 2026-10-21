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
 * The route table and the MCP allowlist must agree.
 *
 * The route knowledge used to be written down three times — the entry
 * dispatcher's `switch`, the MCP proxy's own dispatcher, and the MCP
 * allowlist's method+path pairs — and the three drifted. The table is now
 * the single place the routes are declared; the allowlist stays the
 * authority on *whether* a path may be reached over MCP.
 *
 * This test is what keeps the two from drifting apart again.
 */

import { describe, expect, it } from 'bun:test';
import { ROUTES, matchRoute, mcpRoutes } from '../src/routes';
import { ALLOWLIST_EXACT, ALLOWLIST_PREFIX_GET, allowWorkerRequest } from '../src/mcp/allowlist';

describe('route table and MCP allowlist', () => {
  it('every allowlisted path resolves to an MCP-reachable route', () => {
    for (const [method, path] of ALLOWLIST_EXACT) {
      const match = matchRoute(ROUTES, method, path);
      expect(match, `${method} ${path} matches no route`).not.toBeNull();
      expect(match?.route.mcp, `${method} ${path} is not MCP-reachable`).toBe(true);
      expect(match?.route.kind).toBe('http');
    }
  });

  it('every allowlisted prefix resolves to an MCP-reachable route', () => {
    for (const prefix of ALLOWLIST_PREFIX_GET) {
      // Probe the prefix itself and one path under it.
      const probe = `${prefix.replace(/\/$/, '')}/probe`;
      const match = matchRoute(ROUTES, 'GET', probe);
      expect(match, `GET ${probe} matches no route`).not.toBeNull();
      expect(match?.route.mcp).toBe(true);
    }
  });

  it('every MCP-reachable route is allowed by the allowlist', () => {
    for (const route of mcpRoutes()) {
      const paths = route.paths ?? [route.startsWith ?? ''];
      const allowed = paths.some((p) => {
        if (!p) return false;
        const methods = route.methods ?? ['GET', 'POST', 'PUT', 'DELETE'];
        return methods.some((m) => allowWorkerRequest(m, p).ok);
      });
      expect(
        allowed,
        `no allowlisted method for ${route.paths?.join(',') ?? route.startsWith}`,
      ).toBe(true);
    }
  });

  it('never marks the MCP transport or an upgrade route as MCP-reachable', () => {
    for (const route of ROUTES) {
      if (route.kind === 'http') continue;
      expect(route.mcp, `${route.name ?? route.kind} must not be MCP-reachable`).toBeUndefined();
    }
  });

  it('keeps the interactive and recursive paths blocked', () => {
    expect(allowWorkerRequest('GET', '/mcp').ok).toBe(false);
    expect(allowWorkerRequest('GET', '/api/mcp/bridge').ok).toBe(false);
    expect(allowWorkerRequest('GET', '/api/stream').ok).toBe(false);
    expect(allowWorkerRequest('POST', '/api/git/oauth/github/start').ok).toBe(false);
  });
});

describe('matchRoute', () => {
  it('matches an exact path', () => {
    const match = matchRoute(ROUTES, 'GET', '/health');
    expect(match?.route.kind).toBe('http');
    expect(match?.methodMismatch).toBe(false);
  });

  it('matches a prefix route', () => {
    const match = matchRoute(ROUTES, 'GET', '/api/scripts/s_abc');
    expect(match?.route.kind).toBe('http');
    expect(match?.methodMismatch).toBe(false);
  });

  it('reports a method mismatch instead of "no route"', () => {
    const match = matchRoute(ROUTES, 'GET', '/api/run');
    expect(match).not.toBeNull();
    expect(match?.methodMismatch).toBe(true);
  });

  it('reports no match for an unknown path', () => {
    expect(matchRoute(ROUTES, 'GET', '/nope')).toBeNull();
  });

  it('finds the MCP transport and the upgrade routes', () => {
    expect(matchRoute(ROUTES, 'POST', '/mcp')?.route.kind).toBe('mcp');
    expect(matchRoute(ROUTES, 'GET', '/mcp/bridge')?.route.kind).toBe('mcp');
    expect(matchRoute(ROUTES, 'GET', '/api/mcp/bridge')?.route.kind).toBe('upgrade');
    expect(matchRoute(ROUTES, 'GET', '/api/stream')?.route.kind).toBe('upgrade');
  });
});
