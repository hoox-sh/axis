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
 * Client for Worker-proxied GitHub / GitLab **device OAuth**.
 *
 * Forges block browser CORS on token endpoints; the AXIS Worker relays
 * `/api/git/oauth/device/start` and `/poll`. Token is stored only in the
 * browser (`pluginsConfig` git storage) — never on the Worker.
 *
 * @module storage/git-oauth
 */

import type { GitProvider } from './git-config';

export type DeviceStartResult = {
  provider: GitProvider;
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type DevicePollResult =
  | {
      status: 'success';
      access_token: string;
      token_type?: string;
      scope?: string;
      provider?: GitProvider;
    }
  | {
      status: 'pending';
      error: string;
      error_description?: string;
      interval?: number;
    };

export type GitUserInfo = {
  login: string;
  name?: string;
  htmlUrl?: string;
};

function workerBase(endpoint?: string): string {
  const raw = (endpoint || '').trim().replace(/\/$/, '');
  if (raw) return raw;
  // Fall back to same origin (Pages + Worker route) or local wrangler
  if (typeof window !== 'undefined' && window.location?.origin) {
    const o = window.location.origin;
    if (/localhost|127\.0\.0\.1/.test(o)) return 'http://127.0.0.1:8787';
    return o;
  }
  return 'http://127.0.0.1:8787';
}

async function postJson<T>(
  base: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${base.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.status === 'error') {
    throw new Error(
      String(data.message || data.error_description || data.error || `HTTP ${res.status}`),
    );
  }
  return data as T;
}

/** Begin device authorization via the Worker proxy. */
export async function startDeviceFlow(opts: {
  provider: GitProvider;
  /** Worker / API base (e.g. http://127.0.0.1:8787) */
  workerEndpoint?: string;
  /** Public OAuth App client id when not set on the Worker */
  clientId?: string;
  scope?: string;
}): Promise<DeviceStartResult> {
  const base = workerBase(opts.workerEndpoint);
  const data = await postJson<DeviceStartResult & { status?: string }>(
    base,
    '/api/git/oauth/device/start',
    {
      provider: opts.provider,
      clientId: opts.clientId,
      scope: opts.scope,
    },
  );
  if (!data.device_code || !data.user_code) {
    throw new Error('Device flow start returned incomplete payload');
  }
  return {
    provider: opts.provider,
    device_code: String(data.device_code),
    user_code: String(data.user_code),
    verification_uri: String(data.verification_uri || ''),
    verification_uri_complete: data.verification_uri_complete
      ? String(data.verification_uri_complete)
      : undefined,
    expires_in: Number(data.expires_in) || 900,
    interval: Math.max(1, Number(data.interval) || 5),
  };
}

/** One poll tick (caller loops until success / terminal error). */
export async function pollDeviceFlow(opts: {
  provider: GitProvider;
  deviceCode: string;
  workerEndpoint?: string;
  clientId?: string;
}): Promise<DevicePollResult> {
  const base = workerBase(opts.workerEndpoint);
  const data = await postJson<DevicePollResult & { access_token?: string; status?: string }>(
    base,
    '/api/git/oauth/device/poll',
    {
      provider: opts.provider,
      device_code: opts.deviceCode,
      clientId: opts.clientId,
    },
  );
  if (data.access_token || data.status === 'success') {
    return {
      status: 'success',
      access_token: String((data as { access_token?: string }).access_token || ''),
      token_type: (data as { token_type?: string }).token_type,
      scope: (data as { scope?: string }).scope,
      provider: opts.provider,
    };
  }
  return {
    status: 'pending',
    error: String((data as { error?: string }).error || 'authorization_pending'),
    error_description: (data as { error_description?: string }).error_description,
    interval: (data as { interval?: number }).interval,
  };
}

const TERMINAL_ERRORS = new Set([
  'access_denied',
  'expired_token',
  'unsupported_grant_type',
  'incorrect_device_code',
  'incorrect_client_credentials',
  'invalid_grant',
]);

/**
 * Poll until token, terminal error, timeout, or abort.
 * Returns the access token string.
 */
export async function waitForDeviceToken(opts: {
  provider: GitProvider;
  deviceCode: string;
  intervalSec: number;
  expiresInSec: number;
  workerEndpoint?: string;
  clientId?: string;
  signal?: AbortSignal;
  onTick?: (info: { error: string; description?: string }) => void;
}): Promise<string> {
  const deadline = Date.now() + Math.max(30, opts.expiresInSec) * 1000;
  let intervalMs = Math.max(1000, opts.intervalSec * 1000);

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error('Connect cancelled');
    await new Promise((r) => setTimeout(r, intervalMs));
    if (opts.signal?.aborted) throw new Error('Connect cancelled');

    const polled = await pollDeviceFlow({
      provider: opts.provider,
      deviceCode: opts.deviceCode,
      workerEndpoint: opts.workerEndpoint,
      clientId: opts.clientId,
    });

    if (polled.status === 'success' && polled.access_token) {
      return polled.access_token;
    }

    const err = polled.status === 'pending' ? polled.error : 'unknown';
    opts.onTick?.({
      error: err,
      description: polled.status === 'pending' ? polled.error_description : undefined,
    });

    if (err === 'slow_down') {
      intervalMs += 2000;
      continue;
    }
    if (TERMINAL_ERRORS.has(err)) {
      throw new Error(polled.status === 'pending' && polled.error_description
        ? polled.error_description
        : `Authorization failed: ${err}`);
    }
    // authorization_pending — keep polling
  }
  throw new Error('Authorization timed out — try Connect again');
}

/** Resolve the authenticated login after device flow succeeds. */
export async function fetchGitUser(
  provider: GitProvider,
  token: string,
  apiBaseUrl?: string,
): Promise<GitUserInfo> {
  if (provider === 'github') {
    const base = (apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
    const res = await fetch(`${base}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub /user failed: HTTP ${res.status}`);
    const u = (await res.json()) as { login?: string; name?: string; html_url?: string };
    return {
      login: String(u.login || ''),
      name: u.name ? String(u.name) : undefined,
      htmlUrl: u.html_url ? String(u.html_url) : undefined,
    };
  }

  const base = (apiBaseUrl || 'https://gitlab.com/api/v4').replace(/\/$/, '');
  const res = await fetch(`${base}/user`, {
    headers: {
      'PRIVATE-TOKEN': token,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`GitLab /user failed: HTTP ${res.status}`);
  const u = (await res.json()) as { username?: string; name?: string; web_url?: string };
  return {
    login: String(u.username || ''),
    name: u.name ? String(u.name) : undefined,
    htmlUrl: u.web_url ? String(u.web_url) : undefined,
  };
}

/** Deep links for creating a classic PAT when OAuth is not configured. */
export function manualTokenCreateUrl(provider: GitProvider): string {
  if (provider === 'github') {
    return 'https://github.com/settings/tokens/new?scopes=repo,read:user&description=AXIS%20Pine%20library';
  }
  return 'https://gitlab.com/-/user_settings/personal_access_tokens?name=AXIS&scopes=api';
}
