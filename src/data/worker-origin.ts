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
 * Leaf Worker origin helpers — no store import (avoids TDZ cycles with
 * `store` → HTTP clients → market-worker → on-chain proxy → store).
 *
 * @module data/worker-origin
 */

/**
 * Default production AXIS Worker (market + on-chain proxy + scripts/run).
 * Keep in sync with `worker/wrangler.toml` name / workers.dev URL.
 */
export const DEFAULT_AXIS_WORKER_BASE =
  'https://pynescript-axis.cryptolinx.workers.dev';

/**
 * Normalize an origin/base URL (no trailing slash).
 * Returns empty string if unusable.
 */
export function normalizeEndpointBase(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  let base = s.replace(/\/+$/, '');
  base = base.replace(/\/api\/run\/?$/i, '');
  base = base.replace(/\/api\/?$/i, '');
  if (!/^https?:\/\//i.test(base)) return '';
  return base;
}

/**
 * True when `endpoint` is likely an AXIS Cloudflare Worker
 * (`*.workers.dev`, `pynescript-axis`, wrangler `:8787`, `/api/onchain`).
 */
export function looksLikeOnchainWorkerEndpoint(
  endpoint: string | undefined | null,
): boolean {
  const raw = String(endpoint || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.includes('/api/onchain')) return true;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('.workers.dev')) return true;
    if (host.includes('pynescript-axis')) return true;
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if ((host === 'localhost' || host === '127.0.0.1') && port === '8787') {
      return true;
    }
  } catch {
    if (/\.workers\.dev/i.test(raw)) return true;
    if (/pynescript-axis/i.test(raw)) return true;
    if (/:8787\b/.test(raw) && /localhost|127\.0\.0\.1/i.test(raw)) return true;
  }
  return false;
}
