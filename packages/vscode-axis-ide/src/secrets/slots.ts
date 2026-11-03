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

/**
 * SecretStorage slot ids and key shape regexes.
 * Slots are SecretStorage keys only — never contributes.configuration properties
 * (do not ship axis.worker.apiKey / axis.pro.apiKey as settings).
 */

/** Same shape as src/engine/live-ticket.ts + src/mcp/bridge.ts (`pn_` + 48 hex). */
export const WORKER_API_KEY_RE = /^pn_[a-f0-9]{48}$/;

/**
 * Pro keys are minted as `pyn_…`. Until PYNE publishes a stricter regex,
 * require the prefix plus 20–508 `[A-Za-z0-9_-]` (total ≤512; rejects e.g. `pn_oops`).
 */
export const PRO_API_KEY_RE = /^pyn_[A-Za-z0-9_-]{20,508}$/;

/** SecretStorage key ids (not VS Code settings). */
export const SECRET_SLOTS = {
  /** Worker / cloud Bearer (`pn_…`) ↔ vault CLOUD_API_KEY_SLOT. */
  cloudApiKey: 'axis.secret.cloud.apiKey',
  /** Pro engine `server` key (`pyn_…`) ↔ vault ENGINE_SERVER_API_KEY_SLOT. */
  engineServerApiKey: 'axis.secret.engine.server.apiKey',
  /** Optional pyne-worker engine key. */
  enginePyneWorkerApiKey: 'axis.secret.engine.pyne-worker.apiKey',
  /** Library git PAT. */
  gitPat: 'axis.secret.git.pat',
} as const;

export type SecretSlot = (typeof SECRET_SLOTS)[keyof typeof SECRET_SLOTS];

export const WORKER_KEY_ERROR =
  'AXIS Worker keys must match /^pn_[a-f0-9]{48}$/';

export const PRO_KEY_ERROR =
  'PYNE Pro keys must start with pyn_ and meet length limits (20–508 after prefix)';

/** Generic store failure message — never includes key material. */
export const SECRET_STORE_ERROR = 'AXIS SecretStorage operation failed';
