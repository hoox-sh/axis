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
 * Release-segment compare only: strip leading `v`, then cut at first `-` or `+`
 * (prerelease/build ignored). Enough for PYNE recommended-floor warnings.
 */
function parseReleaseParts(version: string): number[] {
  const release = version.replace(/^v/i, '').split(/[-+]/, 2)[0] ?? '';
  if (!release.trim()) return [];
  return release.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** True when `version` is strictly older than `min` on release segments. */
export function isVersionOlderThan(version: string, min: string): boolean {
  const a = parseReleaseParts(version);
  const b = parseReleaseParts(min);
  if (a.length === 0 && b.length === 0) return false;
  if (a.length === 0) return true;
  if (b.length === 0) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
