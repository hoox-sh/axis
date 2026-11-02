// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import {
  PRO_API_KEY_RE,
  PRO_KEY_ERROR,
  WORKER_API_KEY_RE,
  WORKER_KEY_ERROR,
} from './slots';

/** Callers must not log secrets — ok carries no plaintext key. */
export type ValidateOk = { ok: true };
export type ValidateErr = { ok: false; error: string };
export type ValidateResult = ValidateOk | ValidateErr;

function asTrimmedString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return raw.trim();
}

/** Validate a Worker `pn_` + 48 hex key. Rejects `pn_oops`, empty, and non-strings. */
export function validateWorkerKey(raw: unknown): ValidateResult {
  const v = asTrimmedString(raw);
  if (v === null || !v || !WORKER_API_KEY_RE.test(v)) {
    return { ok: false, error: WORKER_KEY_ERROR };
  }
  return { ok: true };
}

/** Validate a Pro `pyn_` key (prefix + 20–508 safe chars). */
export function validateProKey(raw: unknown): ValidateResult {
  const v = asTrimmedString(raw);
  if (v === null || !v || !PRO_API_KEY_RE.test(v)) {
    return { ok: false, error: PRO_KEY_ERROR };
  }
  return { ok: true };
}

/**
 * Never echo a full secret. Always masks; never returns the raw string.
 * - empty / null → `(empty)`
 * - non-string → `(redacted)`
 * - length ≤ 8 → `****`
 * - longer → known prefix (`pn_` / `pyn_` / first 4) + `****…` + last 4
 */
export function redactSecret(value: unknown): string {
  if (value == null) return '(empty)';
  if (typeof value !== 'string') return '(redacted)';
  const v = value.trim();
  if (!v) return '(empty)';
  if (v.length <= 8) return '****';
  const prefix = v.startsWith('pyn_')
    ? 'pyn_'
    : v.startsWith('pn_')
      ? 'pn_'
      : v.slice(0, 4);
  return `${prefix}****…${v.slice(-4)}`;
}
