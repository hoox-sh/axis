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
 * PYNE hosted-script runner (`/scripts`, `/cron/jobs`, `/cron/run`).
 *
 * The runner is an **optional** backend feature: the routes 404 with
 * `RUNNER_DISABLED` unless `PYNE_RUNNER=1`, and `/health` only advertises them
 * when `features.script_runner` is true. AXIS therefore gates every call on
 * {@link runnerAvailable} (which reads the cached `/health`) and treats a 404 as
 * "not offered" rather than an error.
 *
 * Writes need the admin token (`X-Admin-Token`) or a Pro key, depending on the
 * host; the token is never logged.
 *
 * @module engines/runner
 */

import { getActiveEngineConfig } from '../plugins/active';
import { confirmEngineApiKeyTarget, getCachedEngineHealth } from './catalog';

const DEFAULT_TIMEOUT_MS = 20_000;

/** A hosted script record as the backend lists it (`GET /scripts`). */
export interface HostedScript {
  id: string;
  name?: string;
  symbol?: string;
  timeframe?: string;
  mode?: string;
  enabled?: boolean;
  data_source?: string;
  webhook_url?: string;
  [k: string]: unknown;
}

/** Cron state attached to a job by `GET /cron/jobs`. */
export interface HostedJobCronState {
  enabled?: boolean;
  last_run?: number | null;
  next_run?: number | null;
  last_status?: string | null;
  last_error?: string | null;
  [k: string]: unknown;
}

export interface HostedJob extends HostedScript {
  cron?: HostedJobCronState | null;
}

export interface RunnerCallOptions {
  endpoint?: string;
  /** Pro API key (`X-API-Key` + Bearer). */
  apiKey?: string;
  /** Runner admin token (`X-Admin-Token`) for write routes. */
  adminToken?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunnerResult<T> {
  ok: boolean;
  data: T | null;
  /** True when the host does not offer the runner (404 / RUNNER_DISABLED). */
  unavailable: boolean;
  error: string | null;
}

/**
 * Whether the selected engine advertises the runner.
 *
 * Reads the cached `/health` (`features.script_runner`); false while health is
 * unknown, so the UI hides runner surfaces instead of probing a 404 route.
 */
export function runnerAvailable(): boolean {
  return getCachedEngineHealth()?.features?.scriptRunner === true;
}

function target(opts: RunnerCallOptions): { endpoint: string; headers: Record<string, string> } | string {
  const cfg = getActiveEngineConfig() || {};
  const endpoint = String(opts.endpoint ?? cfg.endpoint ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!endpoint) return 'No backend endpoint — select the server engine and set a URL';
  const apiKey = String(opts.apiKey ?? cfg.apiKey ?? '').trim();
  const adminToken = String(opts.adminToken ?? '').trim();
  if (apiKey && !confirmEngineApiKeyTarget(endpoint, apiKey)) {
    return 'API key withheld for unconfirmed engine origin';
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  return { endpoint, headers };
}

async function call<T>(
  path: string,
  method: string,
  body: unknown,
  opts: RunnerCallOptions,
  pick: (payload: Record<string, unknown>) => T | null,
): Promise<RunnerResult<T>> {
  const t = target(opts);
  if (typeof t === 'string') return { ok: false, data: null, unavailable: false, error: t };
  try {
    const res = await fetch(`${t.endpoint}${path}`, {
      method,
      headers: t.headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    let payload: Record<string, unknown> | null = null;
    try {
      const text = await res.text();
      const parsed: unknown = text.trim() ? JSON.parse(text) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
    if (res.status === 404 || res.status === 501) {
      return {
        ok: false,
        data: null,
        unavailable: true,
        error:
          typeof payload?.message === 'string' && payload.message
            ? payload.message
            : 'Hosted runner is not enabled on this backend',
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, data: null, unavailable: false, error: 'Runner access denied' };
    }
    if (!res.ok || payload?.status === 'error') {
      const message =
        typeof payload?.message === 'string' && payload.message
          ? payload.message
          : `Runner request failed (HTTP ${res.status})`;
      return { ok: false, data: null, unavailable: false, error: message };
    }
    if (!payload) {
      return { ok: false, data: null, unavailable: false, error: 'Runner returned no JSON' };
    }
    return { ok: true, data: pick(payload), unavailable: false, error: null };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, data: null, unavailable: false, error: raw };
  }
}

/** `GET /cron/jobs` — hosted scripts with their cron state. */
export async function listHostedJobs(opts: RunnerCallOptions = {}): Promise<RunnerResult<HostedJob[]>> {
  return call('/cron/jobs', 'GET', undefined, opts, (payload) => {
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return jobs.filter((j): j is HostedJob => !!j && typeof j === 'object') as HostedJob[];
  });
}

/** `PUT /cron/jobs` — enable/disable one job. */
export async function setHostedJobEnabled(
  scriptId: string,
  enabled: boolean,
  opts: RunnerCallOptions = {},
): Promise<RunnerResult<number>> {
  return call(
    '/cron/jobs',
    'PUT',
    { jobs: [{ script_id: scriptId, enabled }] },
    opts,
    (payload) => (typeof payload.count === 'number' ? payload.count : 0),
  );
}

/** `POST /cron/run` — tick one script (or every due script) now. */
export async function runHostedJobNow(
  scriptId?: string,
  opts: RunnerCallOptions & { force?: boolean } = {},
): Promise<RunnerResult<Record<string, unknown>>> {
  return call(
    '/cron/run',
    'POST',
    { ...(scriptId ? { script_id: scriptId } : {}), ...(opts.force ? { force: true } : {}) },
    opts,
    (payload) => payload,
  );
}

/** Fields accepted by `POST /scripts` (`SCRIPT_PUT_SCHEMA`). */
export interface DeployHostedScriptInput {
  /** Stable job id — reused on redeploy (upsert). */
  id: string;
  script: string;
  name?: string;
  symbol?: string;
  timeframe?: string;
  mode?: string;
  enabled?: boolean;
  /** `mock` (backend-generated) or a venue id the host can fetch. */
  dataSource?: string;
  webhookUrl?: string;
  inputs?: Record<string, unknown>;
}

/**
 * `POST /scripts` — deploy (or redeploy) a hosted job.
 *
 * Requires the host's `ADMIN_TOKEN` when one is configured, same as the other
 * runner writes; AXIS never stores that secret, so a 403 surfaces as guidance.
 */
export async function deployHostedScript(
  input: DeployHostedScriptInput,
  opts: RunnerCallOptions = {},
): Promise<RunnerResult<HostedScript>> {
  if (!String(input.id || '').trim() || !String(input.script || '').trim()) {
    return { ok: false, data: null, unavailable: false, error: 'id and script are required' };
  }
  const body: Record<string, unknown> = { id: input.id, script: input.script };
  if (input.name) body.name = input.name;
  if (input.symbol) body.symbol = input.symbol;
  if (input.timeframe) body.timeframe = input.timeframe;
  if (input.mode) body.mode = input.mode;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (input.dataSource) body.data_source = input.dataSource;
  if (input.webhookUrl) body.webhook_url = input.webhookUrl;
  if (input.inputs && Object.keys(input.inputs).length) body.inputs = input.inputs;

  return call('/scripts', 'POST', body, opts, (payload) => {
    const script = payload.script;
    return script && typeof script === 'object' ? (script as HostedScript) : null;
  });
}
