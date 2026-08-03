// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GitHub / GitLab **device authorization** proxy for the AXIS PWA.
 *
 * Browser SPAs cannot call `github.com/login/*` or `gitlab.com/oauth/*`
 * (no CORS). The Worker relays device-code start + poll so the PWA can
 * offer "Connect with GitHub / GitLab" without pasting a PAT.
 *
 * Env (optional — body may supply clientId for self-hosted OAuth apps):
 * - `GITHUB_OAUTH_CLIENT_ID`
 * - `GITLAB_OAUTH_CLIENT_ID`
 *
 * Routes (mounted by index):
 * - `POST /api/git/oauth/device/start`  `{ provider, clientId?, scope? }`
 * - `POST /api/git/oauth/device/poll`   `{ provider, clientId?, device_code }`
 */

/** Minimal env slice used by OAuth (avoids circular import with index). */
export type GitOAuthEnv = {
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITLAB_OAUTH_CLIENT_ID?: string;
};

export type GitOAuthProvider = 'github' | 'gitlab';

const GITHUB_SCOPE = 'repo read:user';
const GITLAB_SCOPE = 'api';

function json(
  body: unknown,
  init: ResponseInit,
  origin: string,
  cors: (origin: string) => Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'Content-Type': 'application/json',
      ...cors(origin),
    },
  });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await req.json();
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function resolveClientId(
  provider: GitOAuthProvider,
  body: Record<string, unknown>,
  env: GitOAuthEnv,
): string {
  const fromBody = String(body.clientId || body.client_id || '').trim();
  if (fromBody) return fromBody;
  if (provider === 'github') return String(env.GITHUB_OAUTH_CLIENT_ID || '').trim();
  return String(env.GITLAB_OAUTH_CLIENT_ID || '').trim();
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** Start device flow — returns user_code + verification_uri for the UI. */
async function startDevice(
  provider: GitOAuthProvider,
  clientId: string,
  scope: string,
): Promise<Record<string, unknown>> {
  if (provider === 'github') {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({ client_id: clientId, scope }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.error) {
      const msg = String(data.error_description || data.error || `HTTP ${res.status}`);
      throw new Error(`GitHub device start failed: ${msg}`);
    }
    return {
      provider: 'github',
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || 'https://github.com/login/device',
      verification_uri_complete: data.verification_uri_complete,
      expires_in: data.expires_in ?? 900,
      interval: data.interval ?? 5,
    };
  }

  // GitLab device authorization grant
  const res = await fetch('https://gitlab.com/oauth/authorize_device', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody({ client_id: clientId, scope }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) {
    const msg = String(data.error_description || data.error || `HTTP ${res.status}`);
    throw new Error(`GitLab device start failed: ${msg}`);
  }
  return {
    provider: 'gitlab',
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri || 'https://gitlab.com/-/profile/device',
    verification_uri_complete: data.verification_uri_complete,
    expires_in: data.expires_in ?? 300,
    interval: data.interval ?? 5,
  };
}

/** Poll until the user approves (or pending / expired / denied). */
async function pollDevice(
  provider: GitOAuthProvider,
  clientId: string,
  deviceCode: string,
): Promise<Record<string, unknown>> {
  if (provider === 'github') {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // Pending is not HTTP error — GitHub returns 200 with error field
    if (data.error) {
      return {
        status: 'pending',
        error: String(data.error),
        error_description: data.error_description ? String(data.error_description) : undefined,
        interval: data.interval,
      };
    }
    if (!data.access_token) {
      throw new Error(`GitHub token poll failed: HTTP ${res.status}`);
    }
    return {
      status: 'success',
      access_token: data.access_token,
      token_type: data.token_type || 'bearer',
      scope: data.scope,
      provider: 'github',
    };
  }

  const res = await fetch('https://gitlab.com/oauth/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (data.error) {
    return {
      status: 'pending',
      error: String(data.error),
      error_description: data.error_description ? String(data.error_description) : undefined,
    };
  }
  if (!res.ok || !data.access_token) {
    throw new Error(
      `GitLab token poll failed: ${String(data.error_description || data.error || res.status)}`,
    );
  }
  return {
    status: 'success',
    access_token: data.access_token,
    token_type: data.token_type || 'bearer',
    scope: data.scope,
    refresh_token: data.refresh_token,
    provider: 'gitlab',
  };
}

/**
 * Handle `/api/git/oauth/device/start` and `/api/git/oauth/device/poll`.
 */
export async function handleGitOAuth(
  req: Request,
  env: GitOAuthEnv,
  origin: string,
  pathname: string,
  cors: (origin: string) => Record<string, string>,
): Promise<Response> {
  if (req.method !== 'POST') {
    return json(
      { status: 'error', code: 'METHOD', message: 'POST required' },
      { status: 405 },
      origin,
      cors,
    );
  }

  const body = await readJsonBody(req);
  const providerRaw = String(body.provider || 'github').toLowerCase();
  const provider: GitOAuthProvider = providerRaw === 'gitlab' ? 'gitlab' : 'github';
  const clientId = resolveClientId(provider, body, env);

  if (!clientId) {
    return json(
      {
        status: 'error',
        code: 'NO_CLIENT_ID',
        message:
          provider === 'github'
            ? 'GitHub OAuth client id missing. Set Worker env GITHUB_OAUTH_CLIENT_ID or pass clientId (public OAuth App id with Device Flow enabled).'
            : 'GitLab OAuth application id missing. Set Worker env GITLAB_OAUTH_CLIENT_ID or pass clientId.',
      },
      { status: 400 },
      origin,
      cors,
    );
  }

  try {
    if (pathname.endsWith('/start')) {
      const scope =
        String(body.scope || '').trim() ||
        (provider === 'gitlab' ? GITLAB_SCOPE : GITHUB_SCOPE);
      const started = await startDevice(provider, clientId, scope);
      return json({ status: 'success', ...started }, { status: 200 }, origin, cors);
    }

    if (pathname.endsWith('/poll')) {
      const deviceCode = String(body.device_code || body.deviceCode || '').trim();
      if (!deviceCode) {
        return json(
          { status: 'error', code: 'BAD_REQUEST', message: 'device_code required' },
          { status: 400 },
          origin,
          cors,
        );
      }
      const polled = await pollDevice(provider, clientId, deviceCode);
      return json(polled, { status: 200 }, origin, cors);
    }

    return json(
      { status: 'error', code: 'NOT_FOUND', message: `Unknown oauth path ${pathname}` },
      { status: 404 },
      origin,
      cors,
    );
  } catch (err) {
    return json(
      {
        status: 'error',
        code: 'OAUTH_UPSTREAM',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
      origin,
      cors,
    );
  }
}
