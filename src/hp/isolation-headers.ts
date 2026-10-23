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
 * Cross-origin isolation headers (HP PR 2).
 *
 * Isolating pair: COOP `same-origin` + COEP `credentialless` — Chromium
 * sets `crossOriginIsolated` (unlocking SharedArrayBuffer) only for this
 * combination. `credentialless` COEP avoids requiring CORP on every
 * third-party subresource (pyne-agent-worker script-src).
 *
 * COOP was `same-origin-allow-popups` (popup-safe, but Chromium never
 * isolates on it). No AXIS surface depends on a popup opener, so the
 * stricter policy costs nothing: the GitHub/GitLab device-flow popup is
 * opened `noopener,noreferrer` (ScriptLibraryPanel) and the token arrives
 * by Worker polling (`waitForDeviceToken`), never via `window.opener`;
 * the detachable editor and panel companion windows are same-origin
 * (BroadcastChannel / direct DOM wiring) and stay in the same
 * browsing-context group under `same-origin`. The capability probe is
 * the runtime source of truth — a tab that fails isolation keeps the
 * transferable copy (HP-1 / `copy+gpu`).
 *
 * Keep every static host in lockstep: `public/_headers`, nginx, Vite
 * `server.headers` / `preview.headers`, `axis-pwa-server.ts`,
 * `axis_pwa_server.py`, and the SW offline shell.
 *
 * @module hp/isolation-headers
 */

export const COOP_HEADER = 'Cross-Origin-Opener-Policy';
export const COEP_HEADER = 'Cross-Origin-Embedder-Policy';
export const CORP_HEADER = 'Cross-Origin-Resource-Policy';

export const COOP_VALUE = 'same-origin';
export const COEP_VALUE = 'credentialless';
export const CORP_VALUE = 'same-origin';

/** Header map for Vite / Bun.serve / SW Response. */
export const HP_ISOLATION_HEADERS: Record<string, string> = {
  [COOP_HEADER]: COOP_VALUE,
  [COEP_HEADER]: COEP_VALUE,
  [CORP_HEADER]: CORP_VALUE,
};

const HEADER_NAMES = [COOP_HEADER, COEP_HEADER, CORP_HEADER] as const;
const HEADER_VALUES = [COOP_VALUE, COEP_VALUE, CORP_VALUE] as const;

/** True when a config/source file mentions every isolation header name and value. */
export function sourceHasIsolationHeaders(source: string): boolean {
  const text = String(source);
  for (const name of HEADER_NAMES) {
    if (!text.includes(name)) return false;
  }
  for (const value of HEADER_VALUES) {
    if (!text.includes(value)) return false;
  }
  return true;
}
