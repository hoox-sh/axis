// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared HTTP client primitives.
 *
 * The scan found the same three steps written into every network call: read
 * the body, decide what a non-2xx means, and give the failure a status code
 * the caller can branch on. Each wrote its own version, and the status was
 * usually flattened into the error *text* — so a caller could not tell a 404
 * from a 429 without parsing a string.
 *
 * These primitives own those three steps. What stays with each caller is
 * what genuinely differs: the base URL, the auth header, the timeout, and
 * whether a failure is thrown at all.
 *
 * ## Which planes do not use this
 *
 * - **The engine plane** (`src/engines/*`) returns a *verdict* — a failed
 *   request is data, not an exception, because the apply path has to
 *   distinguish "the backend said no" from "the network died".
 * - **The probe plane** (`src/workers/probe.ts`) answers with a health
 *   verdict and a latency, never an error.
 * - **The git adapters** (`src/storage/git-*.ts`) carry per-provider error
 *   wording and status handling (a 409 is a conflict to retry, a 403 is a
 *   rate limit to report).
 * - **The editor LSP client** (`src/editor/pyne-lsp-client.ts`) treats a
 *   404/501 as "this host has no LSP" and cools the feature down.
 *
 * Those keep their own contracts on purpose; they use {@link readJsonBody}
 * where the body read is the repeated part.
 *
 * @module api/client
 */

import { combineAbortSignals } from '../utils/fetch-timeout';

/** An HTTP failure that carries the status code. */
export class HttpError extends Error {
  /** The HTTP status code. */
  readonly status: number;
  /** A machine-readable code, when the response body carried one. */
  readonly code: string;
  /** The parsed response body, when there was one. */
  readonly body: unknown;

  constructor(status: number, message: string, opts?: { code?: string; body?: unknown }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = opts?.code ?? '';
    this.body = opts?.body;
  }
}

/**
 * Read a JSON body, tolerating an empty or non-JSON response.
 *
 * A venue that answers an error with HTML must not crash the parser — the
 * status is what matters, and the body is best-effort context.
 */
export async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Build an {@link HttpError} from a failed response.
 *
 * The message follows the venue convention (`"<label> HTTP <status>"`) and
 * prefers the body's own `message` / `error` when it has one.
 */
export async function httpError(res: Response, opts?: { label?: string }): Promise<HttpError> {
  const json = await readJsonBody(res);
  const bodyMessage = String(json.message ?? json.error ?? '');
  const label = opts?.label ? `${opts.label} ` : '';
  const message = bodyMessage ? `${label}${bodyMessage}` : `${label}HTTP ${res.status}`;
  return new HttpError(res.status, message, {
    code: typeof json.code === 'string' ? json.code : '',
    body: json,
  });
}

/** Options for {@link fetchJson}. */
export interface FetchJsonOptions {
  /** Hard wall-clock cap for the request, in ms. */
  timeoutMs?: number;
  /** A caller-owned abort signal. */
  signal?: AbortSignal;
  /** A prefix for the error message, e.g. `Cloud storage`. */
  label?: string;
}

/**
 * Fetch a URL and read its JSON body.
 *
 * Throws an {@link HttpError} on a non-2xx response — the status code is
 * carried on the error, so a caller can branch on it instead of parsing the
 * message.
 */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  opts: FetchJsonOptions = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const signal = combineAbortSignals(opts.timeoutMs ?? 30_000, opts.signal ?? init.signal ?? null);
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) throw await httpError(res, { label: opts.label });
  return { status: res.status, json: await readJsonBody(res) };
}
